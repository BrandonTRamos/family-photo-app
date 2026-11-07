import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { ItemSummaryDto } from '../core/api-types';
import type { ApiClient } from './api';
import { duration, durationWords, shortDate } from './format';
import { AlbumsIcon, BackIcon, PlayIcon, SearchIcon, TimelineIcon, UploadIcon } from './icons';
import { href, tabFor, type Route } from './router';

type Tab = { tab: 'timeline' | 'albums' | 'search' | 'upload'; label: string; route: Route; icon: ReactNode };

export const ApiContext = createContext<ApiClient | null>(null);

export function useApi(): ApiClient {
  const api = useContext(ApiContext);
  if (!api) throw new Error('ApiContext missing');
  return api;
}

/** Loads data for a screen, with loading and error states. */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[]): {
  data: T | undefined;
  error: string | undefined;
  reload: () => void;
  set: (value: T) => void;
} {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setError(undefined);
    load()
      .then((d) => live && setData(d))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { data, error, reload: () => setTick((t) => t + 1), set: setData };
}

export function Print({ item }: { item: ItemSummaryDto }) {
  const [loaded, setLoaded] = useState(false);
  const when = item.capture ? shortDate(item.capture.date) : 'no date';
  const label =
    item.kind === 'video' ? `Video, ${durationWords(item.durationMs)}, ${when}` : `Photo, ${when}`;
  return (
    <a className="print" href={href({ name: 'item', id: item.id })} aria-label={label}>
      <img
        src={item.thumbUrl}
        alt=""
        loading="lazy"
        className={loaded ? 'loaded' : 'shimmer'}
        ref={(img) => img?.complete && img.naturalWidth > 0 && !loaded && setLoaded(true)}
        onLoad={() => setLoaded(true)}
      />
      {item.kind === 'video' && (
        <span className="badge">
          <PlayIcon />
          {duration(item.durationMs)}
        </span>
      )}
    </a>
  );
}

export function Grid({ items, large }: { items: ItemSummaryDto[]; large?: boolean }) {
  return (
    <div className={large ? 'grid large' : 'grid'}>
      {items.map((i) => (
        <Print key={i.id} item={i} />
      ))}
    </div>
  );
}

/** Empty prints with a light sweeping across them, where the photos will appear. */
export function Loading({ variant = 'grid' }: { variant?: 'grid' | 'photo' }) {
  return (
    <div className="skeleton" role="status">
      <span className="visually-hidden">Loading…</span>
      {variant === 'photo' ? (
        <div className="ghost-print large" aria-hidden="true">
          <span className="shimmer" />
        </div>
      ) : (
        <div className="grid" aria-hidden="true">
          {Array.from({ length: 9 }, (_, i) => (
            <div key={i} className="ghost-print" style={{ animationDelay: `${i * 40}ms` }}>
              <span className="shimmer" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function ErrorNotice({ message, retry }: { message: string; retry?: () => void }) {
  return (
    <div className="notice error" role="alert">
      <p style={{ margin: '0 0 8px' }}>{message}</p>
      {retry && (
        <button type="button" className="button small outline" onClick={retry}>
          Try again
        </button>
      )}
    </div>
  );
}

const tabs: Tab[] = [
  { tab: 'timeline', label: 'Timeline', route: { name: 'timeline' }, icon: <TimelineIcon /> },
  { tab: 'albums', label: 'Albums', route: { name: 'albums' }, icon: <AlbumsIcon /> },
  { tab: 'search', label: 'Search', route: { name: 'search', tags: [] }, icon: <SearchIcon /> },
  { tab: 'upload', label: 'Upload', route: { name: 'upload' }, icon: <UploadIcon /> },
];

export function Navigation({ route, children }: { route: Route; children?: ReactNode }) {
  const current = tabFor(route);
  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <p className="brand">Family Archive</p>
          <nav aria-label="Main" className="topnav">
            {tabs
              .filter((t) => t.tab !== 'upload')
              .map((t) => (
                <a key={t.tab} href={href(t.route)} aria-current={current === t.tab && route.name !== 'undated' ? 'page' : undefined}>
                  {t.label}
                </a>
              ))}
            <a href={href({ name: 'undated' })} aria-current={route.name === 'undated' ? 'page' : undefined}>
              Undated
            </a>
          </nav>
          {children}
          <a className="button" href={href({ name: 'upload' })}>
            <UploadIcon size={20} />
            Upload photos &amp; videos
          </a>
        </div>
      </header>
      <nav aria-label="Main" className="tabbar" hidden={route.name === 'item'}>
        {tabs.map((t) => (
          <a key={t.tab} className="tab" href={href(t.route)} aria-current={current === t.tab ? 'page' : undefined}>
            {t.icon}
            {t.label}
          </a>
        ))}
      </nav>
    </>
  );
}

/**
 * The bar at the top of every screen, like an iOS navigation bar: a large title that, once scrolled away,
 * shrinks into a small centred title on a blurred bar. Round buttons for back and actions.
 */
export function NavBar({
  title,
  back,
  actions,
  meta,
  large = true,
  compactTitle,
  overHero,
}: {
  title: ReactNode;
  back?: { route: Route; label: string };
  actions?: ReactNode;
  /** A small grey line under the title. */
  meta?: ReactNode;
  large?: boolean;
  /** Shorter title for the small bar, when the large one is long. */
  compactTitle?: string;
  /** Sits clear over a full-bleed photo that shows the title; the bar appears once scrolled past it. */
  overHero?: boolean;
}) {
  const scrolled = useScrolled(overHero ? 300 : large ? 56 : 8);
  return (
    <>
      <header
        className="navbar"
        data-scrolled={scrolled || undefined}
        data-large={large || overHero || undefined}
        data-hero={overHero || undefined}
      >
        <div className="navbar-side">
          {back && (
            <a className="icon-button glass" href={href(back.route)} aria-label={back.label}>
              <BackIcon />
            </a>
          )}
        </div>
        <p className="navbar-title" aria-hidden={large ? true : undefined}>
          {compactTitle ?? title}
        </p>
        <div className="navbar-side end">{actions}</div>
      </header>
      {large && !overHero && (
        <div className="large-title">
          <h1 className="page-title">{title}</h1>
          {meta && <p className="title-meta">{meta}</p>}
        </div>
      )}
    </>
  );
}

function useScrolled(threshold: number): boolean {
  const [scrolled, setScrolled] = useState(() => window.scrollY > threshold);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > threshold);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [threshold]);
  return scrolled;
}

/** A round glass button with an icon, for the top bar. */
export function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className="icon-button glass" aria-label={label} onClick={onClick}>
      {children}
    </button>
  );
}

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <span className="grabber" aria-hidden="true" />
        <h2>{title}</h2>
        {children}
        <button type="button" className="button secondary block" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}
