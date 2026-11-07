import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { SearchDto } from '../../core/api-types';
import { ErrorNotice, Grid, NavBar, useApi } from '../components';
import { ClearIcon, SearchIcon } from '../icons';
import { href } from '../router';

/** Wait this long after the last keystroke before searching. */
const TYPING_PAUSE_MS = 250;

function termsOf(text: string): string[] {
  return text
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

/** Results update as you type. Each comma-separated term matches the start of any word in a tag. */
export function Search({ tags }: { tags: string[] }) {
  const api = useApi();
  const [text, setText] = useState(tags.join(', '));
  const [result, setResult] = useState<SearchDto>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const latest = useRef(0);
  const input = useRef<HTMLInputElement>(null);

  // Arriving with tags in the link (e.g. from a shared URL).
  useEffect(() => setText(tags.join(', ')), [tags.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  const terms = termsOf(text);
  const key = terms.join(',');

  useEffect(() => {
    const request = ++latest.current;
    history.replaceState(null, '', href({ name: 'search', tags: terms }));
    if (!terms.length) {
      setResult(undefined);
      setError(undefined);
      setBusy(false);
      return;
    }
    setBusy(true);
    const timer = setTimeout(() => {
      api
        .search(terms)
        .then((r) => request === latest.current && (setResult(r), setError(undefined)))
        .catch((e: Error) => request === latest.current && setError(e.message))
        .finally(() => request === latest.current && setBusy(false));
    }, TYPING_PAUSE_MS);
    return () => clearTimeout(timer);
  }, [api, key]); // eslint-disable-line react-hooks/exhaustive-deps

  function submit(e: FormEvent) {
    e.preventDefault();
    input.current?.blur(); // close the phone keyboard to show results
  }

  async function more() {
    if (!result?.cursor) return;
    const request = latest.current;
    setBusy(true);
    try {
      const next = await api.search(terms, result.cursor);
      if (request === latest.current) setResult({ ...next, items: [...result.items, ...next.items] });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const showing = result; // the last results stay up while the next ones load

  return (
    <main className="page">
      <NavBar title="Search" meta="Find photos by what's in them" />
      <form className="field search-form" onSubmit={submit} role="search">
        <label htmlFor="q" className="visually-hidden">
          Search by what's in the photo
        </label>
        <div className="search-field">
          <SearchIcon />
          <input
            id="q"
            ref={input}
            type="search"
            autoComplete="off"
            enterKeyHint="search"
            placeholder="dog, beach, birthday"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          {text && (
            <button type="button" className="clear" aria-label="Clear search" onClick={() => (setText(''), input.current?.focus())}>
              <ClearIcon />
            </button>
          )}
        </div>
        <p className="hint">Part of a word is enough. Separate with commas to combine.</p>
      </form>

      {showing && showing.related.length > 0 && (
        <div className="chips scroll-row" style={{ alignItems: 'center' }}>
          <span className="muted">Also try</span>
          {showing.related.map((r) => (
            <button key={r.key} type="button" className="tag" onClick={() => setText(r.label)}>
              <span className="hash">#</span>
              {r.label}
            </button>
          ))}
        </div>
      )}

      {error && <ErrorNotice message={error} />}
      {busy && !showing && <p className="muted">Searching…</p>}
      {showing && (
        <>
          <p className="result-count" aria-live="polite">
            <strong>{showing.count}</strong> {showing.count === 1 ? 'photo or video' : 'photos and videos'} matching{' '}
            <strong>{showing.tags.join(' + ')}</strong>
            {busy && <span className="muted"> · searching…</span>}
          </p>
          <Grid items={showing.items} large />
          {showing.cursor && (
            <button type="button" className="button secondary block" disabled={busy} onClick={more}>
              {busy ? 'Loading…' : 'Show more'}
            </button>
          )}
        </>
      )}
    </main>
  );
}
