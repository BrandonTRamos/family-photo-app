import { defineBackend } from '@aws-amplify/backend';
import { auth } from './auth/resource';
import { ArchiveResources } from './archive-resources';
import { configureProjectTags } from './cost-tags';

const backend = defineBackend({ auth });

configureProjectTags(backend.stack, process.env.COST_TAG || 'family-photos', {
  appId: process.env.AWS_APP_ID,
  branch: process.env.AWS_BRANCH,
});

// Sign-ins last a year, renewed once a day. Each renewal is a chance for a filtering network (e.g. office Wi-Fi)
// to make the sign-in library give up and sign the person out, so renew rarely. Removing someone from the family
// takes effect within a day.
const { cfnUserPoolClient } = backend.auth.resources.cfnResources;
cfnUserPoolClient.idTokenValidity = 24;
cfnUserPoolClient.accessTokenValidity = 24;
cfnUserPoolClient.refreshTokenValidity = 365;
cfnUserPoolClient.tokenValidityUnits = { idToken: 'hours', accessToken: 'hours', refreshToken: 'days' };

const stack = backend.createStack('Archive');
const archive = new ArchiveResources(stack, 'Archive', {
  userPool: backend.auth.resources.userPool,
  userPoolClient: backend.auth.resources.userPoolClient,
});

backend.addOutput({
  custom: {
    apiUrl: archive.apiUrl,
    mediaDomain: archive.mediaDomain,
    region: stack.region,
  },
});
