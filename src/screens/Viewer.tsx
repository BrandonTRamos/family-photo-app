import { useState, type FormEvent } from 'react';
import type { ItemDetailDto } from '../../core/api-types';
import { ErrorNotice, Loading, Sheet, useApi, useLoad } from '../components';
import { fullDate } from '../format';
import { BackIcon, CloseIcon, SparkleIcon } from '../icons';
import { href } from '../router';

export function Viewer({ id }: { id: string }) {
  const api = useApi();
  const { data: item, error, reload, set } = useLoad(() => api.item(id), [id]);
  const [actionError, setActionError] = useState<string>();
  const [adding, setAdding] = useState(false);
  const [newTag, setNewTag] = useState('');
  const [date, setDate] = useState('');
  const [albumSheet, setAlbumSheet] = useState(false);
  const [videoRetried, setVideoRetried] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function act(run: () => Promise<ItemDetailDto>) {
    setActionError(undefined);
    try {
      set(await run());
      return true;
    } catch (e) {
      setActionError((e as Error).message);
      return false;
    }
  }

  async function addTag(e: FormEvent) {
    e.preventDefault();
    if (await act(() => api.addTag(id, newTag))) {
      setNewTag('');
      setAdding(false);
    }
  }

  async function saveDate(e: FormEvent) {
    e.preventDefault();
    await act(() => api.setDate(id, date));
  }

  const back = (
    <a className="link-button" href={href({ name: 'timeline' })}>
      <BackIcon />
      Back to Timeline
    </a>
  );

  if (error) return <main className="page">{back}<ErrorNotice message={error} retry={reload} /></main>;
  if (!item) return <main className="page">{back}<Loading /></main>;

  return (
    <main className="page">
      <div>{back}</div>

      {item.status === 'processing' && (
        <p className="notice">
          Still being prepared. It will appear for everyone shortly.{' '}
          <button type="button" className="link-button" onClick={reload}>
            Check again
          </button>
        </p>
      )}
      {item.status === 'deleted' && (
        <div className="notice" role="status">
          <p style={{ margin: '0 0 12px' }}>
            In <a href={href({ name: 'deleted' })}>Recently deleted</a>. Only you can see it.
            {item.purgeOn && ` It will be deleted for good on ${fullDate(item.purgeOn)}.`}
          </p>
          {item.canRestore && (
            <button type="button" className="button" onClick={() => act(() => api.restoreItem(id))}>
              Restore
            </button>
          )}
        </div>
      )}
      {item.status === 'failed' && (
        <p className="notice error" role="alert">
          {item.failureReason ?? 'This upload could not be processed.'} Please try uploading it again.
        </p>
      )}

      {(item.status === 'ready' || item.status === 'deleted') && (
        <figure className="viewer-print">
          {item.kind === 'video' ? (
            <video
              controls
              playsInline
              preload="metadata"
              poster={item.posterUrl}
              src={item.videoUrl}
              onError={() => {
                // Signed links expire; fetch a fresh one once.
                if (!videoRetried) {
                  setVideoRetried(true);
                  reload();
                }
              }}
            />
          ) : (
            <img src={item.displayUrl} alt={item.tags.length ? `Photo: ${item.tags.map((t) => t.label).join(', ')}` : 'Photo'} />
          )}
        </figure>
      )}

      <div>
        <h1 className="full-date">{item.capture ? fullDate(item.capture.date) : 'No date yet'}</h1>
        <p className="subtitle">Added by {item.addedBy}</p>
      </div>

      {actionError && <ErrorNotice message={actionError} />}

      {item.canSetDate && (
        <form className="field notice" onSubmit={saveDate}>
          <label htmlFor="set-date">If you know exactly when this was taken, set its date</label>
          <div className="row">
            <input
              id="set-date"
              className="input"
              type="date"
              required
              max={new Date().toISOString().slice(0, 10)}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
            <button type="submit" className="button">
              Set date
            </button>
          </div>
        </form>
      )}

      {item.status === 'ready' && (
        <section className="section">
          <h2 className="day" style={{ fontSize: 19 }}>
            What's in this {item.kind}
          </h2>
          <div className="chips">
            {item.tags.map((t) => (
              <span key={t.key} className="chip">
                {t.source === 'ai' && <SparkleIcon label="Added automatically" />}
                {t.label}
                <button
                  type="button"
                  className="remove"
                  aria-label={`Remove tag ${t.label}`}
                  onClick={() => act(() => api.removeTag(id, t.key))}
                >
                  <CloseIcon />
                </button>
              </span>
            ))}
            {!adding && (
              <button type="button" className="chip-button add" onClick={() => setAdding(true)}>
                + Add a tag
              </button>
            )}
          </div>
          {adding && (
            <form className="row" onSubmit={addTag}>
              <label htmlFor="new-tag" className="visually-hidden">
                New tag
              </label>
              <input
                id="new-tag"
                className="input"
                autoFocus
                maxLength={40}
                placeholder="Cousins"
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
              />
              <button type="submit" className="button">
                Add
              </button>
            </form>
          )}
          {item.tags.some((t) => t.source === 'ai') && (
            <p className="hint">
              <SparkleIcon />
              Added automatically. Tap × to remove a wrong tag.
            </p>
          )}
        </section>
      )}

      {item.albums.length > 0 && (
        <p style={{ margin: 0 }}>
          In {item.albums.length} album{item.albums.length === 1 ? '' : 's'}:{' '}
          {item.albums.map((a, i) => (
            <span key={a.id}>
              {i > 0 && ', '}
              <a href={href({ name: 'album', id: a.id })} style={{ fontWeight: 700 }}>
                {a.name}
              </a>
            </span>
          ))}
        </p>
      )}

      {item.status === 'ready' && (
        <button type="button" className="button block" onClick={() => setAlbumSheet(true)}>
          Add to album
        </button>
      )}

      {item.canDelete && (
        <button type="button" className="button danger block" onClick={() => setConfirmDelete(true)}>
          Delete this {item.kind}
        </button>
      )}

      {confirmDelete && (
        <Sheet title={`Delete this ${item.kind}?`} onClose={() => setConfirmDelete(false)}>
          <p style={{ margin: 0 }}>It moves to Recently deleted. You can restore it there for 30 days.</p>
          <button
            type="button"
            className="button danger block"
            onClick={async () => {
              setConfirmDelete(false);
              await act(() => api.deleteItem(id));
            }}
          >
            Delete
          </button>
        </Sheet>
      )}

      {albumSheet && (
        <AddToAlbum
          itemId={id}
          inAlbums={item.albums.map((a) => a.id)}
          onClose={() => setAlbumSheet(false)}
          onAdded={() => {
            setAlbumSheet(false);
            reload();
          }}
        />
      )}
    </main>
  );
}

function AddToAlbum(props: { itemId: string; inAlbums: string[]; onClose: () => void; onAdded: () => void }) {
  const api = useApi();
  const { data, error } = useLoad(() => api.albums(), []);
  const [name, setName] = useState('');
  const [failure, setFailure] = useState<string>();

  async function add(albumId: string) {
    try {
      await api.addToAlbum(albumId, props.itemId);
      props.onAdded();
    } catch (e) {
      setFailure((e as Error).message);
    }
  }

  async function create(e: FormEvent) {
    e.preventDefault();
    try {
      const album = await api.createAlbum(name);
      await add(album.id);
    } catch (err) {
      setFailure((err as Error).message);
    }
  }

  return (
    <Sheet title="Add to album" onClose={props.onClose}>
      {(error || failure) && <ErrorNotice message={error ?? failure!} />}
      {!data && !error && <Loading />}
      {data?.albums.map((a) => {
        const already = props.inAlbums.includes(a.id);
        return (
          <button key={a.id} type="button" className="list-button" disabled={already} onClick={() => add(a.id)}>
            <span style={{ flex: 1 }}>{a.name}</span>
            <span className="muted">{already ? 'Already in it' : `${a.count} items`}</span>
          </button>
        );
      })}
      <form className="field" onSubmit={create}>
        <label htmlFor="new-album">Or start a new album</label>
        <div className="row">
          <input id="new-album" className="input" maxLength={60} placeholder="Lake trip 1978" value={name} onChange={(e) => setName(e.target.value)} />
          <button type="submit" className="button" disabled={!name.trim()}>
            Create
          </button>
        </div>
      </form>
    </Sheet>
  );
}
