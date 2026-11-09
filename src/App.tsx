import { useEffect, useMemo } from 'react';
import { ApiContext, ErrorNotice, Loading, Navigation, useApi, useCached } from './components';
import type { ApiClient } from './api';
import { href, useRoute } from './router';
import { useScrollMemory } from './scroll';
import { appReady } from './splash';
import { keepCacheFresh } from './cached-api';
import { UpdateBanner } from './UpdateBanner';
import { AlbumDetail, Albums } from './screens/Albums';
import { Search } from './screens/Search';
import { Timeline } from './screens/Timeline';
import { Undated } from './screens/Undated';
import { RecentlyDeleted } from './screens/RecentlyDeleted';
import { Upload } from './screens/Upload';
import { Viewer } from './screens/Viewer';

export function App({ api, onSignOut, demo }: { api: ApiClient; onSignOut?: () => void; demo?: boolean }) {
  const value = useMemo(() => keepCacheFresh(api), [api]);
  return (
    <ApiContext.Provider value={value}>
      <MembershipGate onSignOut={onSignOut} demo={demo} />
      <UpdateBanner />
    </ApiContext.Provider>
  );
}

function MembershipGate({ onSignOut, demo }: { onSignOut?: () => void; demo?: boolean }) {
  const api = useApi();
  const me = useCached('me', () => api.me());
  const settled = !!(me.data || me.error);
  useEffect(() => {
    if (settled) appReady();
  }, [settled]);
  if (me.error) {
    return (
      <div className="center">
        <ErrorNotice message={me.error} retry={me.reload} />
      </div>
    );
  }
  if (!me.data) {
    return (
      <div className="center">
        <Loading />
      </div>
    );
  }
  if (!me.data.member) {
    return (
      <div className="center">
        <h1 className="page-title">Almost there, {me.data.name}</h1>
        <p style={{ maxWidth: 420 }}>
          Your account is ready, but a family member needs to add you to the Archive before you can see it. Ask them to add
          you, then come back.
        </p>
        <button type="button" className="button" onClick={() => me.reload()}>
          Check again
        </button>
        {onSignOut && (
          <button type="button" className="link-button" onClick={onSignOut}>
            Sign out
          </button>
        )}
      </div>
    );
  }
  return <Shell name={me.data.name} onSignOut={onSignOut} demo={demo} />;
}

function Shell({ name, onSignOut, demo }: { name: string; onSignOut?: () => void; demo?: boolean }) {
  const route = useRoute();
  useScrollMemory(href(route));
  return (
    <div className="app">
      <Navigation route={route}>
        {onSignOut && (
          <button type="button" className="link-button" onClick={onSignOut}>
            Sign out
          </button>
        )}
      </Navigation>
      {demo && (
        <p className="notice demo-notice">
          Preview with sample photos. Nothing is saved. Deploy with Amplify to use the real Archive.
        </p>
      )}
      {route.name === 'timeline' && <Timeline name={name} />}
      {route.name === 'item' && <Viewer id={route.id} />}
      {route.name === 'search' && <Search tags={route.tags} />}
      {route.name === 'upload' && <Upload />}
      {route.name === 'albums' && <Albums />}
      {route.name === 'album' && <AlbumDetail id={route.id} />}
      {route.name === 'undated' && <Undated />}
      {route.name === 'deleted' && <RecentlyDeleted />}
    </div>
  );
}
