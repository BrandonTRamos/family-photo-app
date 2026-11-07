import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { Amplify } from 'aws-amplify';
import { fetchAuthSession } from 'aws-amplify/auth';
import { Authenticator } from '@aws-amplify/ui-react';
import '@aws-amplify/ui-react/styles.css';
import './styles.css';
import { App } from './App';
import { HttpApiClient } from './api';
import { createDemoApi } from './demo';
import { appReady } from './splash';
import { clearCache, disablePersistence } from './cache';

// amplify_outputs.json exists only after `npx ampx sandbox` or an Amplify Hosting deploy.
const found = import.meta.glob<{ default: Record<string, any> }>('../amplify_outputs.json', { eager: true });
const outputs = Object.values(found)[0]?.default;
const apiUrl: string | undefined = outputs?.custom?.apiUrl;

const root = createRoot(document.getElementById('root')!);

if (outputs && apiUrl) {
  // Open connections to the API, photo server and sign-in service now, before the first request needs them.
  const mediaDomain: string | undefined = outputs.custom?.mediaDomain;
  preconnect(new URL(apiUrl).origin);
  if (mediaDomain) preconnect(`https://${mediaDomain}`, false); // images load without CORS
  if (outputs.auth?.aws_region) preconnect(`https://cognito-idp.${outputs.auth.aws_region}.amazonaws.com`);
  Amplify.configure(outputs);
  const api = new HttpApiClient(apiUrl, async () => (await fetchAuthSession()).tokens?.idToken?.toString());
  root.render(
    <StrictMode>
      <Authenticator signUpAttributes={['name']} components={{ Header: SignInHeader }}>
        {({ signOut }) => (
          <App
            api={api}
            onSignOut={() => {
              clearCache();
              signOut?.();
            }}
          />
        )}
      </Authenticator>
    </StrictMode>,
  );
} else {
  disablePersistence();
  root.render(
    <StrictMode>
      <App api={createDemoApi()} demo />
    </StrictMode>,
  );
}

/** Shown above the sign-in form: the first thing a signed-out visitor sees, so the splash can go. */
function SignInHeader() {
  useEffect(appReady, []);
  return (
    <h1 className="page-title" style={{ textAlign: 'center', margin: '32px 0 16px' }}>
      Family Archive
    </h1>
  );
}

/** `cors` must match how the requests are made, or the browser opens a second connection anyway. */
function preconnect(origin: string, cors = true) {
  const link = document.createElement('link');
  link.rel = 'preconnect';
  link.href = origin;
  if (cors) link.crossOrigin = 'anonymous';
  document.head.appendChild(link);
}
