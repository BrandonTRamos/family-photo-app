import { useState, type FormEvent } from 'react';
import { ErrorNotice, Grid, IconButton, Loading, NavBar, Sheet, useApi, useCached } from '../components';
import { items } from '../format';
import { MoreIcon, PlusIcon } from '../icons';
import { href, navigate } from '../router';

export function Albums() {
  const api = useApi();
  const { data, error, reload } = useCached('albums', () => api.albums());
  const [name, setName] = useState('');
  const [failure, setFailure] = useState<string>();
  const [creating, setCreating] = useState(false);

  async function create(e: FormEvent) {
    e.preventDefault();
    try {
      const album = await api.createAlbum(name);
      setName('');
      setCreating(false);
      navigate({ name: 'album', id: album.id });
    } catch (err) {
      setFailure((err as Error).message);
    }
  }

  return (
    <main className="page">
      <NavBar
        title="Albums"
        meta="Everything stays on the Timeline too"
        actions={
          <IconButton label="New album" onClick={() => setCreating(true)}>
            <PlusIcon />
          </IconButton>
        }
      />
      {error && <ErrorNotice message={error} retry={reload} />}
      {!data && !error && <Loading />}
      {data && (
        <div className="album-grid">
          {data.albums.map((a) => (
            <a key={a.id} className="album-card" href={href({ name: 'album', id: a.id })}>
              <span className="album-cover">
                {a.coverUrl ? <img src={a.coverUrl} alt="" /> : <span className="album-empty" />}
              </span>
              <span className="name">{a.name}</span>
              <span className="muted">{items(a.count)}</span>
            </a>
          ))}
          <button type="button" className="album-card new" onClick={() => setCreating(true)}>
            <span className="album-cover">
              <PlusIcon size={34} />
            </span>
            <span className="name">New album</span>
          </button>
        </div>
      )}
      {creating && (
        <Sheet title="New album" onClose={() => setCreating(false)}>
          {failure && <ErrorNotice message={failure} />}
          <form className="field" onSubmit={create}>
            <label htmlFor="album-name">Name</label>
            <input
              id="album-name"
              className="input"
              autoFocus
              maxLength={60}
              placeholder="Lake trip 1978"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <button type="submit" className="button block" disabled={!name.trim()}>
              Create album
            </button>
          </form>
        </Sheet>
      )}
    </main>
  );
}

export function AlbumDetail({ id }: { id: string }) {
  const api = useApi();
  const { data, error, reload } = useCached(`album:${id}`, () => api.album(id));
  const [confirming, setConfirming] = useState(false);
  const [failure, setFailure] = useState<string>();

  async function remove() {
    try {
      await api.deleteAlbum(id);
      navigate({ name: 'albums' });
    } catch (e) {
      setFailure((e as Error).message);
    }
  }

  return (
    <main className="page push">
      <NavBar
        title={data?.album.name ?? ''}
        meta={data && items(data.album.count)}
        back={{ route: { name: 'albums' }, label: 'All albums' }}
        actions={
          data && (
            <IconButton label="Album options" onClick={() => setConfirming(true)}>
              <MoreIcon />
            </IconButton>
          )
        }
      />
      {error && <ErrorNotice message={error} retry={reload} />}
      {!data && !error && <Loading />}
      {failure && <ErrorNotice message={failure} />}
      {data &&
        (data.items.length === 0 ? (
          <p className="empty">This album is empty. Open a photo and choose “Add to album”.</p>
        ) : (
          <Grid items={data.items} large />
        ))}
      {confirming && data && (
        <Sheet title={data.album.name} onClose={() => setConfirming(false)}>
          <p style={{ margin: 0 }}>Deleting the album keeps its photos and videos in the Archive and on the Timeline.</p>
          <button
            type="button"
            className="button danger block"
            onClick={() => {
              setConfirming(false);
              void remove();
            }}
          >
            Delete album
          </button>
        </Sheet>
      )}
    </main>
  );
}
