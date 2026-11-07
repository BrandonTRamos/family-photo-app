// Keeps the screen cache honest: after anything that changes data, forget (or fix up) what it changed,
// so the next screen shows the change instead of an old copy.
import type { ItemDetailDto, TimelineMonthDto } from '../core/api-types';
import type { ApiClient } from './api';
import { dropCache, readCache, writeCache } from './cache';

/** The Timeline as last shown: every month loaded so far, and the first page's ids to spot changes. */
export interface CachedTimeline {
  months: TimelineMonthDto[];
  cursor?: string;
  undatedCount: number;
  head: string[];
  /** When the oldest of these links was handed out; they stop working an hour or so later. */
  issuedAt: number;
}

type Changes = { [K in keyof ApiClient]?: (args: Parameters<ApiClient[K]>, result: Awaited<ReturnType<ApiClient[K]>>) => void };

const changes: Changes = {
  addTag: ([id], item) => keepItem(id, item),
  removeTag: ([id], item) => keepItem(id, item),
  setDate: ([id], item) => {
    keepItem(id, item);
    dropCache('timeline');
    dropCache('undated');
  },
  deleteItem: ([id], item) => {
    keepItem(id, item);
    removeFromTimeline(id);
    dropCache('undated');
    dropCache('albums');
    dropCache('album:*');
  },
  restoreItem: ([id], item) => {
    keepItem(id, item);
    dropCache('timeline');
    dropCache('undated');
    dropCache('albums');
    dropCache('album:*');
  },
  createAlbum: () => dropCache('albums'),
  deleteAlbum: ([albumId]) => {
    dropCache('albums');
    dropCache(`album:${albumId}`);
    dropCache('item:*');
  },
  addToAlbum: ([albumId, itemId]) => {
    dropCache('albums');
    dropCache(`album:${albumId}`);
    dropCache(`item:${itemId}`);
  },
  removeFromAlbum: ([albumId, itemId]) => {
    dropCache('albums');
    dropCache(`album:${albumId}`);
    dropCache(`item:${itemId}`);
  },
};

export function keepCacheFresh(api: ApiClient): ApiClient {
  return new Proxy(api, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== 'function') return value;
      const after = changes[prop as keyof ApiClient] as ((args: unknown[], result: unknown) => void) | undefined;
      if (!after) return value.bind(target);
      return async (...args: unknown[]) => {
        const result = await value.apply(target, args);
        after(args, result);
        return result;
      };
    },
  });
}

function keepItem(id: string, item: ItemDetailDto): void {
  writeCache(`item:${id}`, item);
}

/** Take a deleted item off the remembered Timeline, so going back never flashes it. */
function removeFromTimeline(id: string): void {
  const t = readCache<CachedTimeline>('timeline');
  if (!t) return;
  const months = t.months
    .map((m) => {
      const days = m.days
        .map((d) => {
          const items = d.items.filter((i) => i.id !== id);
          return { ...d, items, count: d.count - (d.items.length - items.length) };
        })
        .filter((d) => d.items.length > 0);
      const removed = m.days.reduce((n, d) => n + d.items.length, 0) - days.reduce((n, d) => n + d.items.length, 0);
      return { ...m, days, count: m.count - removed };
    })
    .filter((m) => m.days.length > 0);
  writeCache('timeline', { ...t, months, head: t.head.filter((h) => h !== id) });
}
