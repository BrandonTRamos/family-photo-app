import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';
import { SQSClient } from '@aws-sdk/client-sqs';
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { MediaConvertClient } from '@aws-sdk/client-mediaconvert';
import { randomUUID } from 'node:crypto';
import { defaultConfig, type Deps, type ImageProcessor } from '../ports.js';
import { FileMetadataReader } from '../media/metadata.js';
import { DynamoRepository } from './dynamo-repository.js';
import { BedrockTagger, S3BlobStore, SqsQueue } from './aws.js';
import { MediaConvertTranscoder } from './mediaconvert.js';

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

/** Image processing needs sharp's native binary, so only the workers that use it pass one in. */
export function depsFromEnv(images?: ImageProcessor): Deps {
  const s3 = new S3Client({});
  const sqs = new SQSClient({});
  const unavailable: ImageProcessor = {
    process: () => Promise.reject(new Error('Image processing is not available in this function')),
    forAi: () => Promise.reject(new Error('Image processing is not available in this function')),
  };
  return {
    repo: new DynamoRepository(
      DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } }),
      env('TABLE_NAME'),
    ),
    staging: new S3BlobStore(s3, env('STAGING_BUCKET')),
    media: new S3BlobStore(s3, env('MEDIA_BUCKET')),
    processingQueue: new SqsQueue(sqs, env('PROCESSING_QUEUE_URL')),
    taggingQueue: new SqsQueue(sqs, env('TAGGING_QUEUE_URL')),
    tagger: new BedrockTagger(new BedrockRuntimeClient({}), process.env.BEDROCK_MODEL_ID ?? 'us.amazon.nova-lite-v1:0'),
    transcoder: new MediaConvertTranscoder(new MediaConvertClient({}), {
      roleArn: process.env.MEDIACONVERT_ROLE_ARN ?? '',
      stagingBucket: env('STAGING_BUCKET'),
      mediaBucket: env('MEDIA_BUCKET'),
      appTag: process.env.APP_TAG ?? 'family-archive',
    }),
    images: images ?? unavailable,
    metadata: new FileMetadataReader(),
    clock: { now: () => new Date() },
    ids: { next: () => randomUUID() },
    config: {
      ...defaultConfig,
      familyGroup: process.env.FAMILY_GROUP ?? defaultConfig.familyGroup,
    },
  };
}
