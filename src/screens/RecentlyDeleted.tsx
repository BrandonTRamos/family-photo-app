import { useState } from 'react';
import { ErrorNotice, Loading, Print, Sheet, useApi, useLoad } from '../components';
import { shortDate } from '../format';
import { BackIcon } from '../icons';
import { href } from '../router';

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
    <main className="page">
      <div>
        <a className="link-button" href={href({ name: 'timeline' })}>
          <BackIcon />
          Back to Timeline
        </a>
      </div>
      <header>
        <h1 className="page-title">Recently deleted</h1>
        <p className="subtitle">Things you deleted. Each is deleted for good 30 days later; until then you can restore it.</p>
      </header>
      {(error || actionError) && <ErrorNotice message={(error ?? actionError)!} retry={error ? reload : undefined} />}
      {!data && !error && <Loading />}
      {data && data.items.length === 0 && <p className="notice">Nothing here.</p>}
      {data && data.items.length > 0 && (
        <ul className="file-list">
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
