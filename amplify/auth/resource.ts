import { defineAuth } from '@aws-amplify/backend';

/**
 * Email sign-in. Anyone can create an account, but the API only lets in members of the
 * "family" group; an Archive admin adds people to it in the Cognito console.
 * The name is shown as "Added by ..." on items.
 */
export const auth = defineAuth({
  loginWith: { email: true },
  groups: ['family'],
  userAttributes: {
    fullname: { required: true, mutable: true },
  },
});
