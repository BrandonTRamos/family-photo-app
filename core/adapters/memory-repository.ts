// In-memory Repository: the browser preview runs on it, and the test suite runs against it as well as DynamoDB,
// so both adapters keep the same behaviour. Runs anywhere (no Node APIs).
import type { Album, Item } from '../domain.js';
import { placement, type Placement } from '../item.js';
import type { Page, Repository } from '../ports.js';

export class MemoryRepository implements Repository {
  private readonly items = new Map<string, Item>();
  private readonly albums = new Map<string, Album>();
  /** albumId → itemId → added at */
  private readonly memberships = new Map<string, Map<string, string>>();

  async createItem(item: Item): Promise<void> {
    if (this.items.has(item.id)) throw new Error(`Item ${item.id} already exists`);
    this.items.set(item.id, copy(item));
  }

  async getItem(id: string): Promise<Item | undefined> {
    const item = this.items.get(id);
    return item && copy(item);
  }

  async getItems(ids: string[]): Promise<Item[]> {
    return [...new Set(ids)].flatMap((id) => (this.items.has(id) ? [copy(this.items.get(id)!)] : []));
  }

  async updateItem(id: string, mutate: (item: Item) => Item | undefined): Promise<Item | undefined> {
    for (let attempt = 0; attempt < 6; attempt++) {
      const current = await this.getItem(id);
      if (!current) return undefined;
      const next = mutate(copy(current));
      if (!next) return current;
      await Promise.resolve(); // let a concurrent writer in, as a real store would
      if (this.items.get(id)?.version !== current.version) continue;
      const stored = { ...next, version: current.version + 1 };
      this.items.set(id, copy(stored));
      return copy(stored);
    }
    throw new Error(`Item ${id} kept changing; update abandoned`);
  }

  async timeline(opts: { limit: number; cursor?: string; year?: number }): Promise<Page<Item>> {
    const bound = opts.year === undefined ? undefined : String(opts.year + 1);
    return this.page('timeline', opts.limit, opts.cursor, (key) => !bound || key < bound);
  }

  async countTimeline(datePrefix: string): Promise<number> {
    return this.placed('timeline').filter(([key]) => key.startsWith(datePrefix)).length;
  }

  async undated(opts: { limit: number; cursor?: string }): Promise<Page<Item>> {
    return this.page('undated', opts.limit, opts.cursor);
  }

  async countUndated(): Promise<number> {
    return this.placed('undated').length;
  }

  async itemIdsWithTag(tagKey: string): Promise<string[]> {
    return [...this.items.values()].filter((i) => i.tags.some((t) => t.key === tagKey)).map((i) => i.id).sort();
  }

  async createAlbum(album: Album): Promise<void> {
    if (this.albums.has(album.id)) throw new Error(`Album ${album.id} already exists`);
    this.albums.set(album.id, copy(album));
  }

  async getAlbum(id: string): Promise<Album | undefined> {
    const album = this.albums.get(id);
    return album && copy(album);
  }

  async listAlbums(): Promise<Album[]> {
    const key = (a: Album) => `${a.createdAt}#${a.id}`;
    return [...this.albums.values()].sort((a, b) => key(b).localeCompare(key(a))).map(copy);
  }

  async deleteAlbum(id: string): Promise<void> {
    this.memberships.delete(id);
    this.albums.delete(id);
  }

  async addToAlbum(albumId: string, itemId: string, at: string): Promise<void> {
    if (!this.memberships.has(albumId)) this.memberships.set(albumId, new Map());
    this.memberships.get(albumId)!.set(itemId, at);
  }

  async removeFromAlbum(albumId: string, itemId: string): Promise<void> {
    this.memberships.get(albumId)?.delete(itemId);
  }

  async albumItemIds(albumId: string): Promise<string[]> {
    return [...(this.memberships.get(albumId)?.keys() ?? [])].sort();
  }

  async albumIdsForItem(itemId: string): Promise<string[]> {
    return [...this.memberships.entries()].filter(([, m]) => m.has(itemId)).map(([albumId]) => albumId).sort();
  }

  /** Items in a list, newest first by sort key. */
  private placed(list: Placement['list']): [string, Item][] {
    const out: [string, Item][] = [];
    for (const item of this.items.values()) {
      const where = placement(item);
      if (where?.list === list) out.push([where.sortKey, item]);
    }
    return out.sort((a, b) => b[0].localeCompare(a[0]));
  }

  private page(list: Placement['list'], limit: number, cursor?: string, keep: (key: string) => boolean = () => true): Page<Item> {
    const after = decode(cursor);
    const rows = this.placed(list).filter(([key]) => keep(key) && (after === undefined || key < after));
    const pageRows = rows.slice(0, limit);
    return {
      items: pageRows.map(([, item]) => copy(item)),
      cursor: rows.length > limit ? encode(pageRows.at(-1)![0]) : undefined,
    };
  }
}

/** Stored like DynamoDB stores it: a JSON copy, undefined fields dropped. */
function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function encode(key: string): string {
  return btoa(encodeURIComponent(key));
}

function decode(cursor: string | undefined): string | undefined {
  if (!cursor) return undefined;
  try {
    return decodeURIComponent(atob(cursor));
  } catch {
    return undefined;
  }
}
