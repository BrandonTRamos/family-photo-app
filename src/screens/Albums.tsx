import { useState, type FormEvent } from 'react';
import { ErrorNotice, Grid, Loading, useApi, useLoad } from '../components';
import { items } from '../format';
import { BackIcon } from '../icons';
import { href, navigate } from '../router';

export function Albums() {
  const api = useApi();
  const { data, error, reload } = useLoad(() => api.albums(), []);
  const [name, setName] = useState('');
  const [failure, setFailure] = useState<string>();

  async function create(e: FormEvent) {
    e.preventDefault();
    try {
      const album = await api.createAlbum(name);
      setName('');
      navigate({ name: 'album', id: album.id });
    } catch (err) {
      setFailure((err as Error).message);
    }
  }

  return (
    <main className="page">
      <h1 className="page-title">Albums</h1>
      <p className="subtitle" style={{ marginTop: -10 }}>
        Albums group photos. Everything stays on the Timeline too.
      </p>
      {error && <ErrorNotice message={error} retry={reload} />}
      {!data && !error && <Loading />}
      {data && data.albums.length === 0 && <p className="notice">No albums yet. Start one below.</p>}
      {data && (
        <div className="album-grid">
          {data.albums.map((a) => (
            <a key={a.id} className="album-card" href={href({ name: 'album', id: a.id })}>
              <span className="print">
                {a.coverUrl ? <img src={a.coverUrl} alt="" /> : <img alt="" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" />}
              </span>
              <span className="name">{a.name}</span>
              <span className="muted">{items(a.count)}</span>
            </a>
          ))}
        </div>
      )}
      {failure && <ErrorNotice message={failure} />}
      <form className="field" onSubmit={create}>
        <label htmlFor="album-name">New album</label>
        <div className="row">
          <input id="album-name" className="input" maxLength={60} placeholder="Lake trip 1978" value={name} onChange={(e) => setName(e.target.value)} />
          <button type="submit" className="button" disabled={!name.trim()}>
            Create
          </button>
        </div>
      </form>
    </main>
  );
}

export function AlbumDetail({ id }: { id: string }) {
  const api = useApi();
  const { data, error, reload } = useLoad(() => api.album(id), [id]);
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
    <main className="page">
      <div>
        <a className="link-button" href={href({ name: 'albums' })}>
          <BackIcon />
          All albums
        </a>
      </div>
      {error && <ErrorNotice message={error} retry={reload} />}
      {!data && !error && <Loading />}
      {data && (
        <>
          <header>
            <h1 className="page-title">{data.album.name}</h1>
            <p className="subtitle">{items(data.album.count)}</p>
          </header>
          {data.items.length === 0 ? (
            <p className="notice">This album is empty. Open a photo and choose “Add to album”.</p>
          ) : (
            <Grid items={data.items} />
          )}
          {failure && <ErrorNotice message={failure} />}
          {confirming ? (
            <div className="notice">
              <p style={{ marginTop: 0 }}>
                Delete the album “{data.album.name}”? The photos and videos stay in the Archive and on the Timeline.
              </p>
              <div className="row" style={{ flexWrap: 'wrap' }}>
                <button type="button" className="button danger" onClick={remove}>
                  Delete album
                </button>
                <button type="button" className="button outline" onClick={() => setConfirming(false)}>
                  Keep it
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="button danger" onClick={() => setConfirming(true)}>
              Delete this album
            </button>
          )}
        </>
      )}
    </main>
  );
}
