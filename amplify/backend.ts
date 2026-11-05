import { defineBackend } from '@aws-amplify/backend';
import { auth } from './auth/resource';
import { ArchiveResources } from './archive-resources';

const backend = defineBackend({ auth });

const stack = backend.createStack('Archive');
const archive = new ArchiveResources(stack, 'Archive', {
  userPool: backend.auth.resources.userPool,
  userPoolClient: backend.auth.resources.userPoolClient,
});

backend.addOutput({
  custom: {
    apiUrl: archive.apiUrl,
    region: stack.region,
  },
});
