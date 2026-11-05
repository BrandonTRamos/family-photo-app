import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Amplify } from 'aws-amplify';
import { fetchAuthSession } from 'aws-amplify/auth';
import { Authenticator } from '@aws-amplify/ui-react';
import '@aws-amplify/ui-react/styles.css';
import './styles.css';
import { App } from './App';
import { HttpApiClient } from './api';
import { DemoApiClient } from './demo';

// amplify_outputs.json exists only after `npx ampx sandbox` or an Amplify Hosting deploy.
const found = import.meta.glob<{ default: Record<string, any> }>('../amplify_outputs.json', { eager: true });
const outputs = Object.values(found)[0]?.default;
const apiUrl: string | undefined = outputs?.custom?.apiUrl;

const root = createRoot(document.getElementById('root')!);

if (outputs && apiUrl) {
  Amplify.configure(outputs);
  const api = new HttpApiClient(apiUrl, async () => (await fetchAuthSession()).tokens?.idToken?.toString());
  root.render(
    <StrictMode>
      <Authenticator signUpAttributes={['name']} components={{ Header: () => <h1 className="page-title" style={{ textAlign: 'center', margin: '32px 0 16px' }}>Family Archive</h1> }}>
        {({ signOut }) => <App api={api} onSignOut={signOut} />}
      </Authenticator>
    </StrictMode>,
  );
} else {
  root.render(
    <StrictMode>
      <App api={new DemoApiClient()} demo />
    </StrictMode>,
  );
}
