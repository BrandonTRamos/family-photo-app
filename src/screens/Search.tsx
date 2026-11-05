import { useEffect, useState, type FormEvent } from 'react';
import type { SearchDto } from '../../core/api-types';
import { ErrorNotice, Grid, Loading, useApi } from '../components';
import { navigate } from '../router';

export function Search({ tags }: { tags: string[] }) {
  const api = useApi();
  const [text, setText] = useState(tags.join(', '));
  const [result, setResult] = useState<SearchDto>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setText(tags.join(', '));
    setResult(undefined);
    if (!tags.length) return;
    setBusy(true);
    setError(undefined);
    api
      .search(tags)
      .then(setResult)
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  }, [api, tags.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  function submit(e: FormEvent) {
    e.preventDefault();
    const next = text.split(',').map((t) => t.trim()).filter(Boolean);
    if (next.length) navigate({ name: 'search', tags: next });
  }

  async function more() {
    if (!result?.cursor) return;
    setBusy(true);
    try {
      const next = await api.search(tags, result.cursor);
      setResult({ ...next, items: [...result.items, ...next.items] });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page">
      <h1 className="page-title">Search</h1>
      <form className="field" onSubmit={submit} role="search">
        <label htmlFor="q">Search by what's in the photo</label>
        <div className="row">
          <input id="q" className="input" type="search" placeholder="dog, beach, birthday" value={text} onChange={(e) => setText(e.target.value)} />
          <button type="submit" className="button">
            Search
          </button>
        </div>
        <p className="hint">To combine tags, separate them with commas.</p>
      </form>

      {result && result.related.length > 0 && (
        <div className="chips" style={{ alignItems: 'center' }}>
          <span className="muted">Also try:</span>
          {result.related.map((r) => (
            <button key={r.key} type="button" className="chip-button" onClick={() => navigate({ name: 'search', tags: [r.key] })}>
              {r.label}
            </button>
          ))}
        </div>
      )}

      {error && <ErrorNotice message={error} />}
      {busy && !result && <Loading />}
      {result && (
        <>
          <p style={{ margin: 0, borderTop: '1px solid var(--rule)', paddingTop: 12 }}>
            <strong>{result.count}</strong> photo{result.count === 1 ? '' : 's'} and videos tagged{' '}
            <strong>{result.tags.join(' + ')}</strong>
          </p>
          <Grid items={result.items} />
          {result.cursor && (
            <button type="button" className="button outline block" disabled={busy} onClick={more}>
              {busy ? 'Loading…' : 'Show more'}
            </button>
          )}
        </>
      )}
    </main>
  );
}
