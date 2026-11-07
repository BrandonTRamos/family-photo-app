import { useEffect, useState, type FormEvent } from 'react';
import type { ItemDetailDto, TimelineDto, TimelineMonthDto } from '../../core/api-types';
import { ErrorNotice, Grid, IconButton, Loading, NavBar, Sheet, useApi } from '../components';
import { dayHeading, greeting, items, monthName, shortDate } from '../format';
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
  const showHero = jumpedTo === undefined && months.length > 0;

  return (
    <main className="page">
      <NavBar
        title="Family Archive"
        meta={greeting(name)}
        overHero={showHero}
        actions={
          <IconButton label="Jump to a year" onClick={() => setJumping(true)}>
            <CalendarIcon />
          </IconButton>
        }
      />

      {showHero && (
        <>
          <Hero id={months[0].days[0].items[0].id} greeting={greeting(name)} />
          <MonthCards months={months} />
        </>
      )}

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
        <section key={m.month} id={`m-${m.month}`} className="month-section" aria-label={`${monthName(m.month)} ${m.month.slice(0, 4)}`}>
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

/**
 * The top of the Timeline: the newest photo or video edge to edge, with the greeting and title over it,
 * like the opening of a photo book.
 */
function Hero({ id, greeting }: { id: string; greeting: string }) {
  const api = useApi();
  const [item, setItem] = useState<ItemDetailDto>();
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let live = true;
    api.item(id).then((it) => live && setItem(it), () => undefined); // decoration only: skip it on error
    return () => {
      live = false;
    };
  }, [api, id]);
  const src = item && (item.kind === 'video' ? item.posterUrl ?? item.thumbUrl : item.displayUrl ?? item.thumbUrl);
  return (
    <a className="hero" href={href({ name: 'item', id })} aria-label="Open the latest photo">
      {src ? (
        <img src={src} alt="" className={loaded ? 'loaded' : undefined} onLoad={() => setLoaded(true)} />
      ) : (
        <span className="hero-blank shimmer" />
      )}
      <span className="hero-text">
        <span className="hero-greeting">{greeting}</span>
        <span className="hero-title">Family Archive</span>
        {item && (
          <span className="hero-latest">
            {item.kind === 'video' && <PlayIcon />}
            Latest{item.capture ? ` · ${shortDate(item.capture.date)}` : ''} · {item.addedBy}
          </span>
        )}
      </span>
    </a>
  );
}

/** Tall cards for the latest months, scrolling sideways; tap one to jump to it. */
function MonthCards({ months }: { months: TimelineMonthDto[] }) {
  if (months.length < 2) return null;
  return (
    <section className="month-cards-section" aria-label="Months">
      <h2 className="row-title">Months</h2>
      <div className="month-cards scroll-row">
        {months.slice(0, 10).map((m) => (
          <button
            key={m.month}
            type="button"
            className="month-card"
            onClick={() => document.getElementById(`m-${m.month}`)?.scrollIntoView({ behavior: 'smooth' })}
          >
            <img src={m.days[0].items[0].thumbUrl} alt="" loading="lazy" />
            <span className="month-card-label">
              <strong>{monthName(m.month)}</strong>
              <span>
                {m.month.slice(0, 4)} · {m.count}
              </span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
