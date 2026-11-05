import { useState } from 'react';
import type { UndatedDto } from '../../core/api-types';
import { ErrorNotice, Grid, Loading, useApi, useLoad } from '../components';
import { BackIcon } from '../icons';
import { href } from '../router';

export function Undated() {
  const api = useApi();
  const { data, error, reload, set } = useLoad<UndatedDto>(() => api.undated(), []);
  const [busy, setBusy] = useState(false);

  async function more() {
    if (!data?.cursor) return;
    setBusy(true);
    try {
      const next = await api.undated(data.cursor);
      set({ ...next, items: [...data.items, ...next.items] });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page">
      <div>
        <a className="link-button" href={href({ name: 'timeline' })}>
          <BackIcon />
          Back to Timeline
        </a>
      </div>
      <header>
        <h1 className="page-title">Undated</h1>
        <p className="subtitle">
          These have no date yet. Open one and set its date if you know exactly when it was taken.
        </p>
      </header>
      {error && <ErrorNotice message={error} retry={reload} />}
      {!data && !error && <Loading />}
      {data && data.count === 0 && <p className="notice">Everything has a date.</p>}
      {data && <Grid items={data.items} />}
      {data?.cursor && (
        <button type="button" className="button outline block" disabled={busy} onClick={more}>
          {busy ? 'Loading…' : 'Show more'}
        </button>
      )}
    </main>
  );
}
