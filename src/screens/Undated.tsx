import { useState } from 'react';
import type { UndatedDto } from '../../core/api-types';
import { ErrorNotice, Grid, Loading, NavBar, useApi, useCached } from '../components';

export function Undated() {
  const api = useApi();
  const { data, error, reload, set } = useCached<UndatedDto>('undated', () => api.undated());
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
    <main className="page push">
      <NavBar
        title="Without a date"
        compactTitle="Undated"
        meta="Open one to set its date, if you know it"
        back={{ route: { name: 'timeline' }, label: 'Back to Timeline' }}
      />
      {error && <ErrorNotice message={error} retry={reload} />}
      {!data && !error && <Loading />}
      {data && data.count === 0 && <p className="empty">Everything has a date.</p>}
      {data && <Grid items={data.items} large />}
      {data?.cursor && (
        <button type="button" className="button secondary block" disabled={busy} onClick={more}>
          {busy ? 'Loading…' : 'Show more'}
        </button>
      )}
    </main>
  );
}
