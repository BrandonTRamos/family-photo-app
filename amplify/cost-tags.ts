import { ArnFormat, Duration, RemovalPolicy, Tags, type Stack } from 'aws-cdk-lib';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { AwsCustomResource, AwsCustomResourcePolicy, PhysicalResourceId } from 'aws-cdk-lib/custom-resources';

/** Backend tags inherit through nested stacks; Hosting is managed outside this CDK tree. */
export function configureProjectTags(
  stack: Stack,
  project: string,
  hosting: { appId?: string; branch?: string } = {},
) {
  Tags.of(stack).add('project', project);
  // All branches share one Hosting app. Only main may set its account-wide project label.
  if (!hosting.appId || hosting.branch !== 'main') return;

  const appArn = stack.formatArn({
    service: 'amplify',
    resource: 'apps',
    resourceName: hosting.appId,
    arnFormat: ArnFormat.SLASH_RESOURCE_NAME,
  });
  const tagApp = {
    service: 'Amplify',
    action: 'tagResource',
    parameters: { resourceArn: appArn, tags: { project } },
    physicalResourceId: PhysicalResourceId.of(`project-tag-${hosting.appId}`),
    outputPaths: [],
  };
  new AwsCustomResource(stack, 'HostingProjectTag', {
    onCreate: tagApp,
    onUpdate: tagApp,
    // Removing a branch/backend must never remove the Hosting app's cost tag.
    installLatestAwsSdk: false,
    timeout: Duration.minutes(1),
    logGroup: new LogGroup(stack, 'HostingProjectTagLogs', {
      retention: RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    }),
    policy: AwsCustomResourcePolicy.fromStatements([
      new PolicyStatement({
        actions: ['amplify:TagResource'],
        resources: [appArn],
        conditions: {
          'ForAllValues:StringEquals': { 'aws:TagKeys': ['project'] },
          StringEquals: { 'aws:RequestTag/project': project },
        },
      }),
    ]),
  });
}
