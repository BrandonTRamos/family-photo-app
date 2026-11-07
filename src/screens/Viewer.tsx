import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { ItemDetailDto } from '../../core/api-types';
import { ErrorNotice, Loading, NavBar, Sheet, useApi, useCached } from '../components';
import { fullDate, shortDate } from '../format';
import { AlbumAddIcon, ChevronIcon, CloseIcon, PlusIcon, ShareIcon, TrashIcon } from '../icons';
import { setFlash } from '../flash';
import { thumbFor } from '../cache';
import { href, navigate } from '../router';

export function Viewer({ id }: { id: string }) {
  const api = useApi();
  const { data: item, error, reload, set } = useCached(`item:${id}`, () => api.item(id));
  const [actionError, setActionError] = useState<string>();
  const [adding, setAdding] = useState(false);
  const [editingTags, setEditingTags] = useState(false);
  const [displayLoaded, setDisplayLoaded] = useState(false);
  const [newTag, setNewTag] = useState('');
  const [date, setDate] = useState('');
  const [albumSheet, setAlbumSheet] = useState(false);
  const [videoRetried, setVideoRetried] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [fullScreen, setFullScreen] = useState(false);

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

  const back = { route: { name: 'timeline' } as const, label: 'Back to Timeline' };
  const nav = (title: string) => <NavBar large={false} back={back} title={title} />;

  if (error) return <main className="page push">{nav('')}<ErrorNotice message={error} retry={reload} /></main>;
  if (!item) {
    // Open on the tile that was tapped (already downloaded) while the rest arrives.
    const thumb = thumbFor(id);
    return (
      <main className="page push">
        {nav('')}
        {thumb ? (
          <figure className="viewer-print">
            <img className="viewer-placeholder" src={thumb} alt="" />
          </figure>
        ) : (
          <Loading variant="photo" />
        )}
      </main>
    );
  }

  const mediaUrl = item.kind === 'video' ? item.videoUrl : item.displayUrl;
  const editing = editingTags && item.tags.length > 0;

  return (
    <main className="page push">
      {nav(item.capture ? shortDate(item.capture.date) : item.kind === 'video' ? 'Video' : 'Photo')}

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
        <figure
          className="viewer-print"
          style={item.width && item.height ? { aspectRatio: `${item.width} / ${item.height}` } : undefined}
        >
          {item.kind === 'photo' && (item.thumbUrl ?? thumbFor(id)) && !displayLoaded && (
            <img className="viewer-placeholder under" src={item.thumbUrl ?? thumbFor(id)} alt="" aria-hidden="true" />
          )}
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
            <button type="button" className="open-full" aria-label="Show full screen" onClick={() => setFullScreen(true)}>
              <img
                src={item.displayUrl}
                alt={item.tags.length ? `Photo: ${item.tags.map((t) => t.label).join(', ')}` : 'Photo'}
                ref={(img) => img?.complete && img.naturalWidth > 0 && !displayLoaded && setDisplayLoaded(true)}
                onLoad={() => setDisplayLoaded(true)}
              />
            </button>
          )}
        </figure>
      )}

      <div className="photo-meta">
        <span className="avatar" aria-hidden="true">
          {item.addedBy.trim().charAt(0).toUpperCase()}
        </span>
        <div>
          <p className="who">{item.addedBy}</p>
          <p className="when">{item.capture ? fullDate(item.capture.date) : 'No date yet'}</p>
        </div>
      </div>

      {item.status === 'ready' && (
        <section className="tags" aria-labelledby="tags-title">
          <div className="tags-head">
            <h2 id="tags-title" className="small-label">
              Tags
            </h2>
            {item.tags.length > 0 && (
              <button type="button" className="text-button" onClick={() => setEditingTags((e) => !e)}>
                {editing ? 'Done' : 'Edit'}
              </button>
            )}
          </div>
          <div className="tag-list">
            {item.tags.map((t) =>
              editing ? (
                <button
                  key={t.key}
                  type="button"
                  className="tag editing"
                  aria-label={`Remove tag ${t.label}`}
                  onClick={() => act(() => api.removeTag(id, t.key))}
                >
                  <span className="hash">#</span>
                  {t.label}
                  <CloseIcon />
                </button>
              ) : (
                <a
                  key={t.key}
                  className={t.source === 'family' ? 'tag family' : 'tag'}
                  href={href({ name: 'search', tags: [t.label] })}
                  aria-label={`See everything tagged ${t.label}${t.source === 'ai' ? ' (added automatically)' : ''}`}
                >
                  <span className="hash">#</span>
                  {t.label}
                </a>
              ),
            )}
            {!adding && !editing && (
              <button type="button" className="tag add" aria-label="Add a tag" onClick={() => setAdding(true)}>
                <PlusIcon size={16} />
              </button>
            )}
          </div>
          {adding && (
            <form className="tag-form" onSubmit={addTag}>
              <label htmlFor="new-tag" className="visually-hidden">
                New tag
              </label>
              <input
                id="new-tag"
                autoFocus
                maxLength={40}
                placeholder="Cousins, Grandma's house…"
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
              />
              <button type="button" className="text-button quiet" onClick={() => (setAdding(false), setNewTag(''))}>
                Cancel
              </button>
              <button type="submit" className="tag save" disabled={!newTag.trim()}>
                Add
              </button>
            </form>
          )}
          {editing && <p className="hint">Tap a tag to remove it.</p>}
        </section>
      )}

      {item.albums.length > 0 && (
        <div className="list-group">
          {item.albums.map((a) => (
            <a key={a.id} className="list-row" href={href({ name: 'album', id: a.id })}>
              <span>
                <span className="muted">Album · </span>
                {a.name}
              </span>
              <ChevronIcon />
            </a>
          ))}
        </div>
      )}

      {item.status === 'ready' && (
        <nav className="action-pill" aria-label="Photo actions">
          {mediaUrl && (
            <button type="button" className="pill-action" onClick={() => void share(mediaUrl, item.kind)}>
              <ShareIcon />
              Share
            </button>
          )}
          <button type="button" className="pill-action" onClick={() => setAlbumSheet(true)}>
            <AlbumAddIcon />
            Album
          </button>
          {item.canDelete && (
            <button type="button" className="pill-action danger" onClick={() => setConfirmDelete(true)}>
              <TrashIcon />
              Delete
            </button>
          )}
        </nav>
      )}

      {actionError && <ErrorNotice message={actionError} />}

      {item.canSetDate && (
        <form className="field card" onSubmit={saveDate}>
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

      {confirmDelete && (
        <Sheet title={`Delete this ${item.kind}?`} onClose={() => setConfirmDelete(false)}>
          <p style={{ margin: 0 }}>It moves to Recently deleted. You can restore it there for 30 days.</p>
          <button
            type="button"
            className="button danger block"
            onClick={async () => {
              setConfirmDelete(false);
              if (await act(() => api.deleteItem(id))) {
                setFlash({ deleted: { id, kind: item.kind } });
                navigate({ name: 'timeline' });
              }
            }}
          >
            Delete
          </button>
        </Sheet>
      )}

      {fullScreen && item.displayUrl && <FullScreen src={item.displayUrl} onClose={() => setFullScreen(false)} />}

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

/** The photo on black, filling the screen. Tap anywhere, the ×, Escape or the phone's Back to close. */
function FullScreen({ src, onClose }: { src: string; onClose: () => void }) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    // Back closes it instead of leaving the photo.
    history.pushState({ fullScreen: true }, '');
    const onBack = () => close.current();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && history.back();
    window.addEventListener('popstate', onBack);
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('popstate', onBack);
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, []);

  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label="Photo, full screen" onClick={() => history.back()}>
      <img src={src} alt="" />
      <button type="button" className="close" aria-label="Close full screen" onClick={(e) => (e.stopPropagation(), history.back())}>
        <CloseIcon />
      </button>
    </div>
  );
}

function AddToAlbum(props: { itemId: string; inAlbums: string[]; onClose: () => void; onAdded: () => void }) {
  const api = useApi();
  const { data, error } = useCached('albums', () => api.albums());
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

/** Share the photo or video itself (to Messages, Save Image, …), or its link where files can't be shared. */
async function share(url: string, kind: 'photo' | 'video') {
  try {
    const blob = await (await fetch(url)).blob();
    const file = new File([blob], kind === 'video' ? 'family-video.mp4' : 'family-photo.jpg', { type: blob.type });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file] });
      return;
    }
  } catch (e) {
    if ((e as Error).name === 'AbortError') return; // closed the share sheet
  }
  if (navigator.share) {
    await navigator.share({ url }).catch(() => undefined);
  } else {
    window.open(url, '_blank', 'noopener');
  }
}
