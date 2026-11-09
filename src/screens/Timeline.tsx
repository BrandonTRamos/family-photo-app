import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { ItemDetailDto, TimelineDto, TimelineMonthDto } from '../../core/api-types';
import { ErrorNotice, Grid, IconButton, Loading, NavBar, Sheet, useApi } from '../components';
import { dayHeading, greeting, items, monthName, shortDate } from '../format';
import { CalendarIcon, ChevronIcon, PlayIcon } from '../icons';
import { takeFlash } from '../flash';
import { fetchOnce, readCache, writeCache } from '../cache';
import type { CachedTimeline } from '../cached-api';
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

/** Remembered Timelines older than this may hold expired photo links. */
const TIMELINE_MAX_AGE_MS = 45 * 60 * 1000;

function rememberedTimeline(): CachedTimeline | undefined {
  const t = readCache<CachedTimeline>('timeline');
  return t && Date.now() - t.issuedAt < TIMELINE_MAX_AGE_MS ? t : undefined;
}

const idsOf = (months: TimelineMonthDto[]) => months.flatMap((m) => m.days.flatMap((d) => d.items.map((i) => i.id)));

export function Timeline({ name }: { name?: string }) {
  const api = useApi();
  // Show the Timeline as last seen at once, then check quietly for anything new.
  const [remembered] = useState(rememberedTimeline);
  const [page, setPage] = useState<TimelineDto | undefined>(
    remembered && { months: remembered.months, cursor: remembered.cursor, undatedCount: remembered.undatedCount },
  );
  const [months, setMonths] = useState<TimelineMonthDto[]>(remembered?.months ?? []);
  const head = useRef<string[]>(remembered?.head ?? []);
  const issuedAt = useRef(remembered?.issuedAt ?? Date.now());
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [year, setYear] = useState('');
  const [jumpedTo, setJumpedTo] = useState<number>();
  const [flash, setFlash] = useState(takeFlash);

  async function load(opts: { cursor?: string; year?: number; replace?: boolean; quietly?: boolean }) {
    if (!opts.quietly) setBusy(true);
    setError(undefined);
    try {
      const res = await api.timeline({ cursor: opts.cursor, year: opts.year });
      const first = !opts.cursor && opts.year === undefined;
      // Checking a remembered Timeline: nothing new at the top means keep everything already loaded.
      if (opts.quietly && sameIds(idsOf(res.months), head.current)) return;
      if (first) head.current = idsOf(res.months);
      if (opts.replace) issuedAt.current = Date.now();
      setPage(res);
      setMonths((prev) => (opts.replace ? res.months : merge(prev, res.months)));
    } catch (e) {
      if (!opts.quietly) setError((e as Error).message);
    } finally {
      if (!opts.quietly) setBusy(false);
    }
  }

  useEffect(() => {
    void load({ replace: true, quietly: !!remembered });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Remember what is shown (not a jumped-to year) for next time.
  useEffect(() => {
    if (jumpedTo !== undefined || !page) return;
    writeCache<CachedTimeline>('timeline', {
      months,
      cursor: page.cursor,
      undatedCount: page.undatedCount,
      head: head.current,
      issuedAt: issuedAt.current,
    });
  }, [months, page, jumpedTo]);

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
        <section
          key={m.month}
          id={`m-${m.month}`}
          className="month-section"
          style={{ containIntrinsicSize: `auto ${estimatedHeight(m)}px` }}
          aria-label={`${monthName(m.month)} ${m.month.slice(0, 4)}`}>
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
  const [item, setItem] = useState(() => readCache<ItemDetailDto>(`item:${id}`));
  const [loaded, setLoaded] = useState<false | 'cached' | 'fresh'>(false);
  useEffect(() => {
    let live = true;
    // Decoration only: on an error, keep what is shown.
    fetchOnce(`item:${id}`, () => api.item(id)).then((it) => live && setItem(it), () => undefined);
    return () => {
      live = false;
    };
  }, [api, id]);
  const src = item && (item.kind === 'video' ? item.posterUrl ?? item.thumbUrl : item.displayUrl ?? item.thumbUrl);
  return (
    <a className="hero" href={href({ name: 'item', id })} aria-label="Open the latest photo">
      {src ? (
        <img
          src={src}
          alt=""
          className={loaded === 'fresh' ? 'loaded' : undefined}
          ref={(img) => img?.complete && img.naturalWidth > 0 && !loaded && setLoaded('cached')}
          onLoad={() => setLoaded((l) => l || 'fresh')}
        />
      ) : (
        <span className="hero-blank shimmer" />
      )}
      <span className="hero-text">
        <span className="hero-greeting">{greeting}</span>
        <span className="hero-title">Family Photos</span>
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

function sameIds(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

/**
 * Roughly how tall a month is, so the phone can skip drawing it while off screen (content-visibility) and the
 * scroll bar and scroll restoring stay about right before it is drawn.
 */
function estimatedHeight(m: TimelineMonthDto): number {
  const width = Math.min(window.innerWidth, 1200) - 40;
  const tile = (width - 8) / 3;
  const days = m.days.reduce((h, d) => h + 30 + Math.ceil(d.items.length / 3) * (tile + 4), 0);
  return Math.round(48 + days + m.days.length * 12);
}
