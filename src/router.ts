import { useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { changeScreen, watchTaps, type ScreenChange } from './screen-change';

export type Route =
  | { name: 'timeline' }
  | { name: 'item'; id: string }
  | { name: 'search'; tags: string[] }
  | { name: 'upload' }
  | { name: 'albums' }
  | { name: 'album'; id: string }
  | { name: 'undated' }
  | { name: 'deleted' };

export function parseRoute(hash: string): Route {
  const [path, query = ''] = hash.replace(/^#/, '').split('?');
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  const params = new URLSearchParams(query);
  switch (parts[0]) {
    case 'items':
      return parts[1] ? { name: 'item', id: parts[1] } : { name: 'timeline' };
    case 'search':
      return { name: 'search', tags: (params.get('tags') ?? '').split(',').filter(Boolean) };
    case 'upload':
      return { name: 'upload' };
    case 'albums':
      return parts[1] ? { name: 'album', id: parts[1] } : { name: 'albums' };
    case 'undated':
      return { name: 'undated' };
    case 'recently-deleted':
      return { name: 'deleted' };
    default:
      return { name: 'timeline' };
  }
}

export function href(route: Route): string {
  switch (route.name) {
    case 'timeline':
      return '#/';
    case 'item':
      return `#/items/${encodeURIComponent(route.id)}`;
    case 'search':
      return route.tags.length ? `#/search?tags=${encodeURIComponent(route.tags.join(','))}` : '#/search';
    case 'upload':
      return '#/upload';
    case 'albums':
      return '#/albums';
    case 'album':
      return `#/albums/${encodeURIComponent(route.id)}`;
    case 'undated':
      return '#/undated';
    case 'deleted':
      return '#/recently-deleted';
  }
}

/** The last screen shown that was not a single photo: where a photo's Back button returns to. */
let lastList: Route = { name: 'timeline' };

export function cameFrom(): Route {
  return lastList;
}

export function navigate(route: Route): void {
  window.location.hash = href(route);
}

/** Redraws the app at the current address; set while the app is on screen. */
let redraw: (() => void) | undefined;

/**
 * Show another route in place of this one, adding nothing to the history: Back still leaves for wherever this
 * screen was opened from. (Swiping from photo to photo.) The browser tells nobody about a replaced address, so
 * the app is redrawn from here.
 */
export function replaceRoute(route: Route): void {
  history.replaceState(history.state, '', href(route));
  redraw?.();
}

// ---- which way a screen change goes, so Back can look like going back ----

/**
 * Every history entry is numbered when it is first shown. Arriving at one that already has a number means
 * the browser's Back or Forward was used; a lower number than the one just left means Back.
 */
let here = 0;
/** An in-app Back button was just tapped. It is a link like any other, so it would otherwise count as forward. */
let backTapped = false;
/** When the browser last said it had animated a Back or Forward itself, as a swipe-back gesture does. */
let browserAnimatedAt = -Infinity;

export function goingBack(): void {
  backTapped = true;
}

function numberOf(state: unknown): number | undefined {
  const n = (state as { n?: unknown } | null)?.n;
  return typeof n === 'number' ? n : undefined;
}

function numberThisEntry(n: number): void {
  here = n;
  history.replaceState({ ...history.state, n }, '');
}

function arrive(): 'forward' | 'back' {
  const tapped = backTapped;
  backTapped = false;
  const n = numberOf(history.state);
  if (n === undefined) {
    numberThisEntry(here + 1);
    return tapped ? 'back' : 'forward';
  }
  const move = n < here ? 'back' : 'forward';
  here = n;
  return move;
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));
  useEffect(() => {
    numberThisEntry(numberOf(history.state) ?? 0);
    const show = () => setRoute(parseRoute(window.location.hash));
    redraw = show;
    /** The photo a visit to the photo screen began on; swiping moves on from it. */
    let opened: string | undefined;
    const onChange = (e: HashChangeEvent) => {
      // From the address just left, not the last route seen: Search rewrites its address as you type.
      const left = parseRoute(new URL(e.oldURL).hash);
      const to = parseRoute(window.location.hash);
      if (left.name !== 'item') lastList = left;
      const change: ScreenChange = {
        move: arrive(),
        opens: to.name === 'item' ? href(to) : undefined,
        closes: left.name === 'item' ? href(left) : undefined,
        swiped: left.name === 'item' && left.id !== opened,
        shown: performance.now() - browserAnimatedAt < 200,
      };
      opened = to.name === 'item' ? to.id : undefined;
      // Drawn at once, not when React next gets to it: the new screen has to be there for the transition, and its
      // scroll position (scroll.ts, which also sends a new screen to the top) set before anything is painted.
      changeScreen(change, () => flushSync(show));
    };
    // Comes just before hashchange for Back and Forward.
    const onPop = (e: PopStateEvent) => {
      if (e.hasUAVisualTransition) browserAnimatedAt = performance.now();
    };
    const unwatch = watchTaps();
    window.addEventListener('hashchange', onChange);
    window.addEventListener('popstate', onPop);
    return () => {
      redraw = undefined;
      unwatch();
      window.removeEventListener('hashchange', onChange);
      window.removeEventListener('popstate', onPop);
    };
  }, []);
  return route;
}

/** Which bottom tab a route belongs to. */
export function tabFor(route: Route): 'timeline' | 'albums' | 'search' | 'upload' {
  if (route.name === 'albums' || route.name === 'album') return 'albums';
  if (route.name === 'search') return 'search';
  if (route.name === 'upload') return 'upload';
  return 'timeline';
}
