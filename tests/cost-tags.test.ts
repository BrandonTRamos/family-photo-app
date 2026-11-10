import { App, NestedStack, Stack } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import { describe, expect, it } from 'vitest';
import { configureProjectTags } from '../amplify/cost-tags';

const makeStack = () => new Stack(new App(), 'Backend', {
  env: { account: '123456789012', region: 'us-east-1' },
});

// Custom-resource calls are JSON strings joined around CloudFormation's partition token.
function sdkCall(value: string | { 'Fn::Join': [string, unknown[]] }) {
  if (typeof value === 'string') return JSON.parse(value);
  const [separator, parts] = value['Fn::Join'];
  return JSON.parse(parts.map((part) => {
    if (typeof part === 'string') return part;
    expect(part).toEqual({ Ref: 'AWS::Partition' });
    return 'aws';
  }).join(separator));
}

describe('project cost tags', () => {
  it('tags resources in the root and nested backend stacks without a Hosting app in sandboxes', () => {
    const stack = makeStack();
    new Bucket(stack, 'RootBucket');
    const nested = new NestedStack(stack, 'Archive');
    new Bucket(nested, 'Media');
    configureProjectTags(stack, 'family-photos');
    for (const scope of [stack, nested]) {
      Template.fromStack(scope).hasResourceProperties('AWS::S3::Bucket', {
        Tags: Match.arrayWith([{ Key: 'project', Value: 'family-photos' }]),
      });
    }
    Template.fromStack(stack).resourceCountIs('Custom::AWS', 0);
  });

  it('sets the same project on the current main-branch Hosting app on create and update', () => {
    const stack = makeStack();
    configureProjectTags(stack, 'wellbeing-app-owner', { appId: 'dexample123', branch: 'main' });
    const template = Template.fromStack(stack);
    const resources = Object.values(template.findResources('Custom::AWS'));
    expect(resources).toHaveLength(1);
    const props = resources[0].Properties;
    for (const operation of ['Create', 'Update']) {
      expect(sdkCall(props[operation])).toEqual({
        service: 'Amplify',
        action: 'tagResource',
        parameters: {
          resourceArn: 'arn:aws:amplify:us-east-1:123456789012:apps/dexample123',
          tags: { project: 'wellbeing-app-owner' },
        },
        physicalResourceId: { id: 'project-tag-dexample123' },
        outputPaths: [],
      });
    }
    expect(props.Delete).toBeUndefined();
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([Match.objectLike({
          Action: 'amplify:TagResource',
          Effect: 'Allow',
          Resource: { 'Fn::Join': ['', ['arn:', { Ref: 'AWS::Partition' }, ':amplify:us-east-1:123456789012:apps/dexample123']] },
          Condition: {
            'ForAllValues:StringEquals': { 'aws:TagKeys': ['project'] },
            StringEquals: { 'aws:RequestTag/project': 'wellbeing-app-owner' },
          },
        })]),
      },
    });
  });

  it('keeps preview branches from changing the shared Hosting app tag', () => {
    const stack = makeStack();
    new Bucket(stack, 'PreviewBucket');
    configureProjectTags(stack, 'preview-project', { appId: 'dexample123', branch: 'preview' });
    Template.fromStack(stack).resourceCountIs('Custom::AWS', 0);
  });
});

