import { useEffect, useState, type FormEvent } from 'react';
import type { TimelineDto, TimelineMonthDto } from '../../core/api-types';
import { ErrorNotice, Grid, Loading, useApi } from '../components';
import { dayHeading, items, monthName } from '../format';
import { ChevronIcon } from '../icons';
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

export function Timeline() {
  const api = useApi();
  const [page, setPage] = useState<TimelineDto>();
  const [months, setMonths] = useState<TimelineMonthDto[]>([]);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [year, setYear] = useState('');
  const [jumpedTo, setJumpedTo] = useState<number>();

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

  function jump(e: FormEvent) {
    e.preventDefault();
    const y = Number(year);
    if (!Number.isInteger(y) || y < 1800) return;
    setJumpedTo(y);
    void load({ year: y, replace: true });
  }

  const years = new Map<string, TimelineMonthDto[]>();
  for (const m of months) years.set(m.month.slice(0, 4), [...(years.get(m.month.slice(0, 4)) ?? []), m]);

  return (
    <main className="page">
      <header>
        <h1 className="page-title">Family Archive</h1>
        <p className="subtitle">Everyone's photos and videos, newest first</p>
      </header>

      {page && page.undatedCount > 0 && (
        <a className="banner" href={href({ name: 'undated' })}>
          <span>
            <strong>Undated</strong> · {page.undatedCount} need{page.undatedCount === 1 ? 's' : ''} a date
          </span>
          <span className="go">
            See
            <ChevronIcon />
          </span>
        </a>
      )}

      {error && <ErrorNotice message={error} retry={() => load({ replace: true, year: jumpedTo })} />}
      {!page && !error && <Loading />}
      {page && months.length === 0 && !busy && (
        <p className="notice">
          Nothing on the Timeline yet. <a href={href({ name: 'upload' })}>Add the first photos</a>.
        </p>
      )}

      {[...years.entries()].map(([y, ms]) => (
        <section key={y} className="section" aria-labelledby={`y${y}`}>
          <h2 className="year" id={`y${y}`}>
            {y}
          </h2>
          {ms.map((m) => (
            <section key={m.month} className="section">
              <h3 className="month">
                {monthName(m.month)} <span className="count">· {items(m.count)}</span>
              </h3>
              {m.days.map((d) => (
                <div key={d.date} className="section" style={{ gap: 8 }}>
                  <h4 className="day">
                    {dayHeading(d.date)} <span className="count">· {d.count}</span>
                  </h4>
                  <Grid items={d.items} />
                </div>
              ))}
            </section>
          ))}
        </section>
      ))}

      {page?.cursor && (
        <button type="button" className="button outline block" disabled={busy} onClick={() => load({ cursor: page.cursor })}>
          {busy ? 'Loading…' : 'Show older photos'}
        </button>
      )}

      <form className="field" onSubmit={jump}>
        <label htmlFor="jump-year">Jump to a year</label>
        <div className="row">
          <input
            id="jump-year"
            className="input"
            inputMode="numeric"
            pattern="[0-9]{4}"
            placeholder="1978"
            value={year}
            onChange={(e) => setYear(e.target.value)}
          />
          <button type="submit" className="button">
            Go
          </button>
        </div>
      </form>

      <p style={{ margin: 0 }}>
        <a href={href({ name: 'deleted' })}>Recently deleted</a>
      </p>
    </main>
  );
}
