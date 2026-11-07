import { useEffect, useState, type FormEvent } from 'react';
import type { ItemDetailDto, TimelineDto, TimelineMonthDto } from '../../core/api-types';
import { ErrorNotice, Grid, IconButton, Loading, NavBar, Sheet, useApi } from '../components';
import { dayHeading, duration, greeting, items, longDate, monthName } from '../format';
import { CalendarIcon, ChevronIcon, PlayIcon } from '../icons';
import { takeFlash } from '../flash';
import { href } from '../router';

/** Pages can split a month or day; join them back together. */
function merge(into: TimelineMonthDto[], more: TimelineMonthDto[]): TimelineMonthDto[] {
  const out = into.map((m) => ({ ...m, days: m.days.map((d) => ({ ...d, items: [...d.items] })) }));
  for (const m of more) {
    const last = out.at(-1);
    if (last && last.month === m.month) {
      for (const d of m.days) {
        const lastDay = last.days.at(-1);
        if (lastDay && lastDay.date === d.date) lastDay.items.push(...d.items);
        else last.days.push(d);
      }
    } else {
      out.push(m);
    }
  }
  return out;
}

export function Timeline({ name }: { name?: string }) {
  const api = useApi();
  const [page, setPage] = useState<TimelineDto>();
  const [months, setMonths] = useState<TimelineMonthDto[]>([]);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [year, setYear] = useState('');
  const [jumpedTo, setJumpedTo] = useState<number>();
  const [flash, setFlash] = useState(takeFlash);

  async function load(opts: { cursor?: string; year?: number; replace?: boolean }) {
    setBusy(true);
    setError(undefined);
    try {
      const res = await api.timeline({ cursor: opts.cursor, year: opts.year });
      setPage(res);
      setMonths((prev) => (opts.replace ? res.months : merge(prev, res.months)));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void load({ replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function undoDelete(id: string) {
    try {
      await api.restoreItem(id);
      setFlash(undefined);
      await load({ replace: true, year: jumpedTo });
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function jump(e: FormEvent) {
    e.preventDefault();
    const y = Number(year);
    if (!Number.isInteger(y) || y < 1800) return;
    setJumpedTo(y);
    void load({ year: y, replace: true });
  }

  const [jumping, setJumping] = useState(false);

  return (
    <main className="page">
      <NavBar
        title="Family Archive"
        eyebrow={<p className="greeting">{greeting(name)}</p>}
        actions={
          <IconButton label="Jump to a year" onClick={() => setJumping(true)}>
            <CalendarIcon />
          </IconButton>
        }
      />

      {jumpedTo === undefined && months[0] && <Latest id={months[0].days[0].items[0].id} />}

      {jumpedTo !== undefined && (
        <button
          type="button"
          className="pill-button"
          onClick={() => {
            setJumpedTo(undefined);
            setYear('');
            void load({ replace: true });
          }}
        >
          From {jumpedTo} and earlier · <strong>Back to newest</strong>
        </button>
      )}

      {flash && (
        <div className="toast" role="status">
          <span>{flash.deleted.kind === 'video' ? 'Video' : 'Photo'} moved to Recently deleted</span>
          <button type="button" className="toast-action" onClick={() => undoDelete(flash.deleted.id)}>
            Undo
          </button>
        </div>
      )}

      {error && <ErrorNotice message={error} retry={() => load({ replace: true, year: jumpedTo })} />}
      {!page && !error && <Loading />}
      {page && months.length === 0 && !busy && (
        <div className="empty">
          <p>Nothing on the Timeline yet.</p>
          <a className="button" href={href({ name: 'upload' })}>
            Add the first photos
          </a>
        </div>
      )}

      {months.map((m) => (
        <section key={m.month} className="month-section" aria-label={`${monthName(m.month)} ${m.month.slice(0, 4)}`}>
          <h2 className="month-bar">
            <span className="month">
              {monthName(m.month)} <span className="month-year">{m.month.slice(0, 4)}</span>
            </span>
            <span className="count">{items(m.count)}</span>
          </h2>
          {m.days.map((d) => (
            <div key={d.date} className="day-group">
              <h3 className="day">
                {dayHeading(d.date)} <span className="count">· {d.count}</span>
              </h3>
              <Grid items={d.items} />
            </div>
          ))}
        </section>
      ))}

      {page?.cursor && (
        <button type="button" className="button secondary block" disabled={busy} onClick={() => load({ cursor: page.cursor })}>
          {busy ? 'Loading…' : 'Show older photos'}
        </button>
      )}

      <nav className="list-group" aria-label="More">
        <a className="list-row" href={href({ name: 'undated' })}>
          <span>Photos without a date</span>
          <ChevronIcon />
        </a>
        <a className="list-row" href={href({ name: 'deleted' })}>
          <span>Recently deleted</span>
          <ChevronIcon />
        </a>
      </nav>

      {jumping && (
        <Sheet title="Jump to a year" onClose={() => setJumping(false)}>
          <form
            className="field"
            onSubmit={(e) => {
              setJumping(false);
              jump(e);
            }}
          >
            <label htmlFor="jump-year">Show photos from this year and earlier</label>
            <div className="row">
              <input
                id="jump-year"
                className="input"
                inputMode="numeric"
                pattern="[0-9]{4}"
                placeholder="1978"
                autoFocus
                value={year}
                onChange={(e) => setYear(e.target.value)}
              />
              <button type="submit" className="button">
                Go
              </button>
            </div>
          </form>
        </Sheet>
      )}
    </main>
  );
}

/** The newest photo or video, shown large as a print. */
function Latest({ id }: { id: string }) {
  const api = useApi();
  const [item, setItem] = useState<ItemDetailDto>();
  useEffect(() => {
    let live = true;
    api.item(id).then((it) => live && setItem(it), () => undefined); // decoration only: skip it on error
    return () => {
      live = false;
    };
  }, [api, id]);
  const src = item && (item.kind === 'video' ? item.posterUrl ?? item.thumbUrl : item.displayUrl ?? item.thumbUrl);
  if (!item || !src) {
    return (
      <div className="hero-print placeholder" aria-hidden="true">
        <span className="shimmer" />
      </div>
    );
  }
  return (
    <a className="hero-print" href={href({ name: 'item', id: item.id })}>
      <span className="hero-photo">
        <img src={src} alt="" />
        {item.kind === 'video' && (
          <span className="badge">
            <PlayIcon />
            {duration(item.durationMs)}
          </span>
        )}
      </span>
      <span className="hero-caption">
        <span className="eyebrow">Latest</span>
        {item.capture && <span className="hero-date">{longDate(item.capture.date)}</span>}
        <span className="muted">Added by {item.addedBy}</span>
      </span>
    </a>
  );
}
