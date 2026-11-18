import { useEffect, useState } from 'react';

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

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));
  useEffect(() => {
    const onChange = (e: HashChangeEvent) => {
      // From the address just left, not the last route seen: Search rewrites its address as you type.
      const left = parseRoute(new URL(e.oldURL).hash);
      if (left.name !== 'item') lastList = left;
      setRoute(parseRoute(window.location.hash));
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
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
