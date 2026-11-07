import { fileURLToPath } from 'node:url';
import { CustomResource, Duration, Names, RemovalPolicy, Stack } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as cr from 'aws-cdk-lib/custom-resources';
import { NodejsFunction, OutputFormat, type NodejsFunctionProps } from 'aws-cdk-lib/aws-lambda-nodejs';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { CorsHttpMethod, HttpApi, HttpMethod } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpJwtAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import type { IUserPool, IUserPoolClient } from 'aws-cdk-lib/aws-cognito';
import { tableSchema } from '../core/adapters/dynamo-repository';

const NOVA_LITE = 'amazon.nova-lite-v1:0';
const PROCESSOR_TIMEOUT = Duration.minutes(5);
const TAGGER_TIMEOUT = Duration.seconds(60);
/** Failed or abandoned originals stay this long for recovery. Open decision; see the spec. */
const STAGING_RETENTION = Duration.days(30);

export interface ArchiveResourcesProps {
  userPool: IUserPool;
  userPoolClient: IUserPoolClient;
}

export class ArchiveResources extends Construct {
  readonly apiUrl: string;

  constructor(scope: Construct, id: string, props: ArchiveResourcesProps) {
    super(scope, id);
    const stack = Stack.of(this);
    const appTag = `family-archive-${Names.uniqueId(this).slice(-12).toLowerCase()}`;

    // ---- storage ----
    // Family media is retained even if the stack is deleted.
    const staging = new s3.Bucket(this, 'Staging', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: false, // so deleting a staged original really removes its bytes
      removalPolicy: RemovalPolicy.RETAIN,
      lifecycleRules: [
        { abortIncompleteMultipartUploadAfter: Duration.days(1) },
        { expiration: STAGING_RETENTION },
      ],
      cors: [
        {
          allowedMethods: [s3.HttpMethods.PUT],
          allowedOrigins: ['*'],
          allowedHeaders: ['*'],
          exposedHeaders: ['ETag'],
          maxAge: 3000,
        },
      ],
    });

    const media = new s3.Bucket(this, 'Media', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.RETAIN,
      cors: [
        {
          allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.HEAD],
          allowedOrigins: ['*'],
          allowedHeaders: ['Range'],
          exposedHeaders: ['Content-Range', 'Accept-Ranges', 'Content-Length'],
          maxAge: 3000,
        },
      ],
    });

    const table = new dynamodb.TableV2(this, 'Table', {
      partitionKey: { name: tableSchema.partitionKey, type: dynamodb.AttributeType.STRING },
      sortKey: { name: tableSchema.sortKey, type: dynamodb.AttributeType.STRING },
      billing: dynamodb.Billing.onDemand(),
      removalPolicy: RemovalPolicy.RETAIN,
      globalSecondaryIndexes: [
        {
          indexName: tableSchema.gsi1.name,
          partitionKey: { name: tableSchema.gsi1.partitionKey, type: dynamodb.AttributeType.STRING },
          sortKey: { name: tableSchema.gsi1.sortKey, type: dynamodb.AttributeType.STRING },
        },
      ],
    });

    // ---- queues ----
    const processingDlq = new sqs.Queue(this, 'ProcessingDlq', { retentionPeriod: Duration.days(14), enforceSSL: true });
    const processingQueue = new sqs.Queue(this, 'ProcessingQueue', {
      visibilityTimeout: PROCESSOR_TIMEOUT.plus(Duration.minutes(25)),
      enforceSSL: true,
      deadLetterQueue: { queue: processingDlq, maxReceiveCount: 5 },
    });
    const taggingDlq = new sqs.Queue(this, 'TaggingDlq', { retentionPeriod: Duration.days(14), enforceSSL: true });
    const taggingQueue = new sqs.Queue(this, 'TaggingQueue', {
      visibilityTimeout: Duration.minutes(6),
      enforceSSL: true,
      deadLetterQueue: { queue: taggingDlq, maxReceiveCount: 5 },
    });

    // ---- video conversion ----
    const mediaConvertRole = new iam.Role(this, 'MediaConvertRole', {
      assumedBy: new iam.ServicePrincipal('mediaconvert.amazonaws.com'),
    });
    staging.grantRead(mediaConvertRole);
    media.grantWrite(mediaConvertRole);

    new events.Rule(this, 'MediaConvertEvents', {
      description: 'MediaConvert job results for this Archive go back to the processing queue',
      eventPattern: {
        source: ['aws.mediaconvert'],
        detailType: ['MediaConvert Job State Change'],
        detail: { status: ['COMPLETE', 'ERROR', 'CANCELED'], userMetadata: { app: [appTag] } },
      },
      targets: [new targets.SqsQueue(processingQueue)],
    });

    // ---- photo and video delivery ----
    // CloudFront serves media from a location near each viewer. Only links signed with our key are accepted;
    // the private key is created at deploy and kept as an encrypted SSM parameter.
    const keyParameterName = `/${appTag}/media-cdn-signing-key`;
    const keyParameterArn = stack.formatArn({ service: 'ssm', resource: 'parameter', resourceName: keyParameterName.slice(1) });
    const keyFn = new NodejsFunction(this, 'CdnKeyFn', {
      entry: fileURLToPath(new URL('./functions/cdn-key.ts', import.meta.url)),
      depsLockFilePath: fileURLToPath(new URL('../package-lock.json', import.meta.url)),
      runtime: lambda.Runtime.NODEJS_22_X,
      timeout: Duration.seconds(30),
      logGroup: new logs.LogGroup(this, 'CdnKeyFnLogs', { retention: logs.RetentionDays.ONE_MONTH }),
      bundling: { format: OutputFormat.ESM, target: 'node22', externalModules: ['@aws-sdk/*'] },
    });
    keyFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ssm:GetParameter', 'ssm:PutParameter', 'ssm:DeleteParameter'],
        resources: [keyParameterArn],
      }),
    );
    const signingKey = new CustomResource(this, 'CdnSigningKey', {
      serviceToken: new cr.Provider(this, 'CdnKeyProvider', {
        onEventHandler: keyFn,
        logGroup: new logs.LogGroup(this, 'CdnKeyProviderLogs', { retention: logs.RetentionDays.ONE_MONTH }),
      }).serviceToken,
      properties: { ParameterName: keyParameterName },
    });
    const publicKey = new cloudfront.PublicKey(this, 'CdnPublicKey', {
      encodedKey: signingKey.getAttString('PublicKey'),
      comment: 'Family Archive media links',
    });
    const cdn = new cloudfront.Distribution(this, 'MediaCdn', {
      comment: 'Family Archive photos and videos',
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(media),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        trustedKeyGroups: [new cloudfront.KeyGroup(this, 'CdnKeyGroup', { items: [publicKey] })],
        // Lets the app fetch a file to hand to the phone's share sheet. Links are still signed.
        responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.CORS_ALLOW_ALL_ORIGINS,
      },
    });

    // ---- functions ----
    const environment = {
      TABLE_NAME: table.tableName,
      STAGING_BUCKET: staging.bucketName,
      MEDIA_BUCKET: media.bucketName,
      MEDIA_CDN_DOMAIN: cdn.distributionDomainName,
      MEDIA_CDN_KEY_ID: publicKey.publicKeyId,
      MEDIA_CDN_KEY_PARAMETER: keyParameterName,
      PROCESSING_QUEUE_URL: processingQueue.queueUrl,
      TAGGING_QUEUE_URL: taggingQueue.queueUrl,
      MEDIACONVERT_ROLE_ARN: mediaConvertRole.roleArn,
      BEDROCK_MODEL_ID: `us.${NOVA_LITE}`,
      APP_TAG: appTag,
      FAMILY_GROUP: 'family',
      NODE_OPTIONS: '--enable-source-maps',
    };
    const fn = (name: string, entry: string, extra: Partial<NodejsFunctionProps> & { sharp?: boolean }) =>
      new NodejsFunction(this, name, {
        entry: fileURLToPath(new URL(`./functions/${entry}.ts`, import.meta.url)),
        depsLockFilePath: fileURLToPath(new URL('../package-lock.json', import.meta.url)),
        runtime: lambda.Runtime.NODEJS_22_X,
        architecture: lambda.Architecture.X86_64,
        environment,
        logGroup: new logs.LogGroup(this, `${name}Logs`, { retention: logs.RetentionDays.ONE_MONTH }),
        bundling: {
          format: OutputFormat.ESM,
          target: 'node22',
          sourceMap: true,
          banner: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
          externalModules: ['@aws-sdk/*', ...(extra.sharp ? ['sharp'] : [])],
          // sharp is native: install the Linux x64 build whatever machine deploys.
          nodeModules: extra.sharp ? ['sharp'] : [],
          environment: extra.sharp ? { npm_config_os: 'linux', npm_config_cpu: 'x64', npm_config_libc: 'glibc' } : {},
        },
        ...extra,
      });

    const api = fn('Api', 'api', { memorySize: 512, timeout: Duration.seconds(20) });
    const processor = fn('Processor', 'processor', { memorySize: 2048, timeout: PROCESSOR_TIMEOUT, sharp: true });
    const tagger = fn('Tagger', 'tagger', { memorySize: 1024, timeout: TAGGER_TIMEOUT, sharp: true });
    const janitor = fn('Janitor', 'janitor', { memorySize: 256, timeout: Duration.minutes(5) });

    table.grantReadWriteData(api);
    staging.grantReadWrite(api);
    api.addToRolePolicy(new iam.PolicyStatement({ actions: ['s3:AbortMultipartUpload'], resources: [staging.arnForObjects('*')] }));
    media.grantRead(api);
    media.grantDelete(api); // "Delete now" in Recently deleted
    api.addToRolePolicy(new iam.PolicyStatement({ actions: ['ssm:GetParameter'], resources: [keyParameterArn] }));
    processingQueue.grantSendMessages(api);

    table.grantReadWriteData(processor);
    staging.grantReadWrite(processor);
    staging.grantDelete(processor);
    media.grantReadWrite(processor);
    taggingQueue.grantSendMessages(processor);
    processor.addToRolePolicy(
      new iam.PolicyStatement({ actions: ['mediaconvert:CreateJob', 'mediaconvert:GetJob'], resources: ['*'] }),
    );
    mediaConvertRole.grantPassRole(processor.grantPrincipal);
    processor.addEventSource(
      new SqsEventSource(processingQueue, { batchSize: 1, maxConcurrency: 5, reportBatchItemFailures: true }),
    );

    table.grantReadWriteData(tagger);
    media.grantRead(tagger);
    tagger.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel'],
        resources: [
          `arn:aws:bedrock:*::foundation-model/${NOVA_LITE}`,
          `arn:aws:bedrock:*:${stack.account}:inference-profile/us.${NOVA_LITE}`,
        ],
      }),
    );
    tagger.addEventSource(new SqsEventSource(taggingQueue, { batchSize: 1, maxConcurrency: 2, reportBatchItemFailures: true }));

    // Daily: remove Items that have been in Recently deleted for 30 days.
    table.grantReadWriteData(janitor);
    media.grantDelete(janitor);
    new events.Rule(this, 'DailyPurge', {
      schedule: events.Schedule.cron({ hour: '7', minute: '23' }),
      targets: [new targets.LambdaFunction(janitor)],
    });

    // ---- HTTP API ----
    const httpApi = new HttpApi(this, 'HttpApi', {
      description: 'Family Archive API',
      corsPreflight: {
        allowOrigins: ['*'],
        allowMethods: [CorsHttpMethod.GET, CorsHttpMethod.POST, CorsHttpMethod.PUT, CorsHttpMethod.DELETE],
        allowHeaders: ['authorization', 'content-type'],
        maxAge: Duration.days(1),
      },
      defaultAuthorizer: new HttpJwtAuthorizer(
        'Cognito',
        `https://cognito-idp.${stack.region}.amazonaws.com/${props.userPool.userPoolId}`,
        { jwtAudience: [props.userPoolClient.userPoolClientId] },
      ),
    });
    httpApi.addRoutes({
      path: '/{proxy+}',
      methods: [HttpMethod.GET, HttpMethod.POST, HttpMethod.PUT, HttpMethod.DELETE],
      integration: new HttpLambdaIntegration('ApiIntegration', api),
    });
    this.apiUrl = httpApi.apiEndpoint;
  }
}
