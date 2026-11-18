// The picture at the top of the photo screen, as one of a row you swipe along: the list it was opened from.
//
// The row scrolls sideways and stops on each photo (scroll snapping), which is the browser's own scrolling.
// That is what keeps everything around it working: the browser already tells a sideways swipe from scrolling the
// page, from the phone's edge-swipe Back, and from dragging a video's progress bar. Arrow keys and, with a mouse,
// the round buttons scroll the same row.
//
// Only the photo in view and the one either side are drawn. The neighbours load their page and display picture
// while they wait, so a swipe lands on a ready photo. Blank space stands in for the rest of the row, so every photo
// keeps its place in it and the row never has to be moved under the finger.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ItemDetailDto, ItemSummaryDto } from '../../core/api-types';
import { fetchOnce, readCache, thumbFor } from '../cache';
import { Loading, useApi } from '../components';
import { BackIcon, ChevronIcon } from '../icons';

export function PhotoStrip(props: {
  id: string;
  /** The photo's page, once loaded. */
  item: ItemDetailDto | undefined;
  /** Its page could not be loaded. */
  failed: boolean;
  /** The list it was opened from and its place in it; without one the photo stands alone. */
  around: { items: ItemSummaryDto[]; index: number } | undefined;
  /** Another photo has been swiped into view. */
  onMove: (id: string) => void;
  onOpenFull: () => void;
  onReload: () => void;
}) {
  const items = props.around?.items;
  const index = props.around?.index ?? 0;
  const count = items?.length ?? 1;
  const strip = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  // For the listeners below, which are set up once.
  const now = useRef({ index, items, onMove: props.onMove });
  now.current = { index, items, onMove: props.onMove };

  const slideAt = (at: number) => track.current?.querySelector<HTMLElement>(`[data-at="${at}"]`) ?? undefined;
  const pictureHeight = (at: number) => (slideAt(at)?.firstElementChild as HTMLElement | null)?.offsetHeight;

  /** How far a slide is from being squarely in view, in pixels (0 when it is), and how wide a slide is. */
  const offsetOf = (slide: HTMLElement) => {
    const rect = slide.getBoundingClientRect();
    return { off: rect.left - track.current!.getBoundingClientRect().left, width: rect.width };
  };

  /** Where the row is, in photos: 3 is the fourth squarely in view, 3.5 half way on to the fifth. */
  const place = () => {
    const current = slideAt(now.current.index);
    if (!current) return undefined;
    const { off, width } = offsetOf(current);
    return width ? now.current.index - off / width : undefined;
  };

  /** Put the photo that is meant to be in view there, if the row is not within `slack` slide-widths of it already. */
  const lineUp = (slack: number) => {
    const current = slideAt(now.current.index);
    if (!current) return;
    const { off, width } = offsetOf(current);
    if (Math.abs(off) > slack * width) track.current!.scrollLeft += off;
  };

  // Drawn with a (new) photo as the one in view: its height is the strip's again (styles.css). Line the row up on it
  // when it is somewhere else entirely: on opening, or when the photo changed some way other than by scrolling here.
  // After a swipe it is within a hair already, and the browser is left to finish its own snap.
  useLayoutEffect(() => {
    strip.current!.style.height = '';
    lineUp(0.5);
  }, [index, items]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const row = track.current!;
    const settle = (at: number) => {
      const to = now.current.items?.[at];
      if (to && at !== now.current.index) now.current.onMove(to.id);
      else strip.current!.style.height = '';
    };
    const onScroll = () => {
      const at = place();
      if (at === undefined) return;
      // Photos differ in height: change from one height to the next with the swipe, not in a jump when it lands.
      const from = Math.floor(at);
      const a = pictureHeight(from);
      const b = pictureHeight(from + 1) ?? a;
      if (a !== undefined && b !== undefined) strip.current!.style.height = `${a + (b - a) * (at - from)}px`;
      if (Math.abs(at - Math.round(at)) < 0.01) settle(Math.round(at));
    };
    // Where the browser says when scrolling has stopped, believe it over the arithmetic above.
    const onScrollEnd = () => {
      const at = place();
      if (at !== undefined) settle(Math.round(at));
    };
    // Turning the phone or resizing the window changes how wide a photo is.
    const resized = new ResizeObserver(() => lineUp(0));
    resized.observe(row);
    row.addEventListener('scroll', onScroll, { passive: true });
    row.addEventListener('scrollend', onScrollEnd);
    return () => {
      resized.disconnect();
      row.removeEventListener('scroll', onScroll);
      row.removeEventListener('scrollend', onScrollEnd);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** Scroll on to the photo before (-1) or after (1); landing there is what changes the photo. */
  const step = (by: -1 | 1) => {
    const to = slideAt(now.current.index + by);
    if (!to) return;
    const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
    track.current!.scrollTo({ left: track.current!.scrollLeft + offsetOf(to).off, behavior: calm ? 'instant' : 'smooth' });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      // The arrows mean something else while typing, in a video's own controls, and under a sheet or the full-screen photo.
      const busy = (e.target as Element).closest?.('input, textarea, select, video, [contenteditable]');
      if (busy || document.querySelector('[aria-modal="true"]')) return;
      e.preventDefault();
      step(e.key === 'ArrowLeft' ? -1 : 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const first = Math.max(0, index - 1);
  const drawn: { id: string; summary?: ItemSummaryDto }[] = items
    ? items.slice(first, index + 2).map((summary) => ({ id: summary.id, summary }))
    : [{ id: props.id }];
  const after = count - first - drawn.length;

  return (
    <div className="photo-strip" ref={strip}>
      <div className="strip-track" ref={track}>
        {first > 0 && <div className="strip-gap" style={{ width: `${first * 100}%` }} />}
        {drawn.map((slide, i) => {
          const current = first + i === index;
          return (
            <div key={slide.id} className="strip-slide" data-at={first + i} data-current={current || undefined} aria-hidden={!current}>
              <Picture
                id={slide.id}
                summary={slide.summary}
                current={current}
                item={current ? props.item : undefined}
                failed={current && props.failed}
                onOpenFull={props.onOpenFull}
                onReload={props.onReload}
              />
            </div>
          );
        })}
        {after > 0 && <div className="strip-gap" style={{ width: `${after * 100}%` }} />}
      </div>
      {index > 0 && (
        <button type="button" className="icon-button glass strip-arrow before" aria-label="Previous photo" onClick={() => step(-1)}>
          <BackIcon />
        </button>
      )}
      {index < count - 1 && (
        <button type="button" className="icon-button glass strip-arrow after" aria-label="Next photo" onClick={() => step(1)}>
          <ChevronIcon />
        </button>
      )}
    </div>
  );
}

/**
 * One photo or video in the row. It opens on the tile's small picture, soft, in the frame the full one will fill
 * (lists say how big it is), and the sharp picture fades in over it. Off to the side it is the same thing waiting,
 * so nothing is redrawn when it slides into view.
 */
function Picture(props: {
  id: string;
  summary: ItemSummaryDto | undefined;
  current: boolean;
  item: ItemDetailDto | undefined;
  failed: boolean;
  onOpenFull: () => void;
  onReload: () => void;
}) {
  const { id, summary, current } = props;
  const ahead = useLoadedAhead(current ? undefined : id);
  const item = current ? props.item : ahead;
  const [displayLoaded, setDisplayLoaded] = useState(false);
  const [videoRetried, setVideoRetried] = useState(false);
  const video = useRef<HTMLVideoElement>(null);

  // A video swiped out of view stops playing.
  useEffect(() => {
    if (!current) video.current?.pause();
  }, [current]);

  if (item && item.status !== 'ready' && item.status !== 'deleted') return null;
  // The tile's own link first: that picture is already downloaded.
  const thumb = summary?.thumbUrl ?? thumbFor(id) ?? item?.thumbUrl;
  if (!item && !thumb) return current && !props.failed ? <Loading variant="photo" /> : null;
  const size = sizeOf(item) ?? sizeOf(summary);

  return (
    <figure className="viewer-print" style={size && { aspectRatio: `${size.width} / ${size.height}` }}>
      {thumb && (!item || (item.kind === 'photo' && !displayLoaded)) && (
        <img className={item || size ? 'viewer-placeholder under' : 'viewer-placeholder'} src={thumb} alt="" aria-hidden="true" />
      )}
      {item?.kind === 'video' && (
        <video
          ref={video}
          controls={current}
          playsInline
          preload={current ? 'metadata' : 'none'}
          poster={item.posterUrl}
          src={item.videoUrl}
          onError={() => {
            // Signed links expire; fetch a fresh one once.
            if (current && !videoRetried) {
              setVideoRetried(true);
              props.onReload();
            }
          }}
        />
      )}
      {item?.kind === 'photo' && (
        <button
          type="button"
          className="open-full"
          aria-label="Show full screen"
          tabIndex={current ? undefined : -1}
          onClick={props.onOpenFull}
        >
          <img
            src={item.displayUrl}
            alt={item.tags.length ? `Photo: ${item.tags.map((t) => t.label).join(', ')}` : 'Photo'}
            ref={(img) => img?.complete && img.naturalWidth > 0 && !displayLoaded && setDisplayLoaded(true)}
            onLoad={() => setDisplayLoaded(true)}
          />
        </button>
      )}
    </figure>
  );
}

function sizeOf(of: { width?: number; height?: number } | undefined): { width: number; height: number } | undefined {
  return of?.width && of.height ? { width: of.width, height: of.height } : undefined;
}

/** A neighbour's page, asked for before it is swiped to (unless it is already here). Nothing is asked for without an id. */
function useLoadedAhead(id: string | undefined): ItemDetailDto | undefined {
  const api = useApi();
  const [, arrived] = useState(0);
  useEffect(() => {
    if (!id || readCache(`item:${id}`)) return;
    let live = true;
    fetchOnce(`item:${id}`, () => api.item(id)).then(
      () => live && arrived((n) => n + 1),
      () => undefined, // it will be asked for again, and say what went wrong, if it is swiped to
    );
    return () => {
      live = false;
    };
  }, [api, id]);
  return id ? readCache<ItemDetailDto>(`item:${id}`) : undefined;
}
