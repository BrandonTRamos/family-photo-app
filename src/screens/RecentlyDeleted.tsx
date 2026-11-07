import { useState } from 'react';
import { ErrorNotice, Loading, NavBar, Print, Sheet, useApi, useLoad } from '../components';
import { shortDate } from '../format';

/** The signed-in family member's own deleted items, kept 30 days. */
export function RecentlyDeleted() {
  const api = useApi();
  const { data, error, reload } = useLoad(() => api.recentlyDeleted(), []);
  const [actionError, setActionError] = useState<string>();
  const [confirm, setConfirm] = useState<string>();

  async function act(run: () => Promise<unknown>) {
    setActionError(undefined);
    try {
      await run();
      reload();
    } catch (e) {
      setActionError((e as Error).message);
    }
  }

  return (
    <main className="page push">
      <NavBar
        title="Recently deleted"
        meta="Restore within 30 days, then they're gone for good"
        back={{ route: { name: 'timeline' }, label: 'Back to Timeline' }}
      />
      {(error || actionError) && <ErrorNotice message={(error ?? actionError)!} retry={error ? reload : undefined} />}
      {!data && !error && <Loading />}
      {data && data.items.length === 0 && <p className="empty">Nothing here.</p>}
      {data && data.items.length > 0 && (
        <ul className="file-list list-group">
          {data.items.map((i) => (
            <li key={i.id} className="file-row">
              <div style={{ width: 88, flexShrink: 0 }}>
                <Print item={i} />
              </div>
              <div className="info">
                <strong>{i.kind === 'video' ? 'Video' : 'Photo'}</strong>
                <span className="muted">Deleted for good on {shortDate(i.purgeOn)}</span>
              </div>
              <button type="button" className="button small" onClick={() => act(() => api.restoreItem(i.id))}>
                Restore
              </button>
              <button type="button" className="button small danger" onClick={() => setConfirm(i.id)}>
                Delete now
              </button>
            </li>
          ))}
        </ul>
      )}
      {confirm && (
        <Sheet title="Delete for good?" onClose={() => setConfirm(undefined)}>
          <p style={{ margin: 0 }}>This can't be undone.</p>
          <button
            type="button"
            className="button danger block"
            onClick={() => {
              const id = confirm;
              setConfirm(undefined);
              void act(() => api.deleteForGood(id));
            }}
          >
            Delete for good
          </button>
        </Sheet>
      )}
    </main>
  );
}
