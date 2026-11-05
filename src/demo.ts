// A browser-only stand-in for the API, used when no backend is configured (local preview).
import type {
  AlbumDto,
  ItemDetailDto,
  ItemSummaryDto,
  TagDto,
  TimelineDto,
  TimelineMonthDto,
  UploadRequest,
  UploadResponse,
} from '../core/api-types';
import { ApiError, type ApiClient } from './api';

interface DemoItem {
  id: string;
  kind: 'photo' | 'video';
  src: string;
  date?: string;
  time?: string;
  source?: 'file' | 'family';
  durationMs?: number;
  addedBy: string;
  tags: TagDto[];
  createdAt: number;
}

const ai = (...keys: string[]): TagDto[] => keys.map((k) => ({ key: k, label: k, source: 'ai' }));
const img = (name: string) => `/demo/${name}.svg`;

export class DemoApiClient implements ApiClient {
  private items: DemoItem[];
  private albumList: { id: string; name: string; itemIds: string[] }[];
  private nextId = 100;

  constructor() {
    let n = 0;
    const mk = (kind: DemoItem['kind'], name: string, date: string | undefined, time: string | undefined, tags: TagDto[], extra: Partial<DemoItem> = {}): DemoItem => ({
      id: `demo${++n}`,
      kind,
      src: img(name),
      date,
      time,
      source: date ? 'file' : undefined,
      addedBy: n % 2 ? 'Aunt Rosa' : 'Uncle Dan',
      tags,
      createdAt: n,
      ...extra,
    });
    this.items = [
      mk('video', 'birthday', '2026-10-26', '15:10:00', [], { durationMs: 45_000 }),
      mk('photo', 'birthday', '2026-10-26', '15:02:00', ai('birthday cake', 'candles', 'party')),
      mk('photo', 'picnic', '2026-10-26', '13:30:00', ai('picnic', 'park', 'outdoors')),
      mk('photo', 'picnic', '2026-10-19', '12:00:00', ai('picnic', 'park', 'tree', 'outdoors')),
      mk('photo', 'garden', '2026-10-19', '11:00:00', ai('flowers', 'garden', 'fence', 'outdoors')),
      mk('photo', 'kids', '2026-09-20', '10:00:00', ai('soccer', 'field', 'child', 'outdoors')),
      mk('video', 'dog', '2026-09-20', '09:30:00', [], { durationMs: 72_000 }),
      mk('photo', 'lake', '2026-09-12', '19:00:00', ai('lake', 'sunset', 'dock', 'mountains', 'outdoors')),
      mk('photo', 'beach', '2026-08-16', '10:00:00', [...ai('beach', 'beach umbrella', 'ocean', 'sunny day'), { key: 'cousins', label: 'Cousins', source: 'family', addedBy: 'Uncle Dan' }]),
      mk('photo', 'snow', '2025-12-24', '18:00:00', ai('christmas tree', 'snow', 'night', 'lights')),
      mk('photo', 'wedding-old', undefined, undefined, ai('wedding', 'couple', 'arch')),
      mk('photo', 'oldhouse', undefined, undefined, ai('house', 'tree', 'porch')),
    ];
    this.albumList = [{ id: 'album1', name: 'Summer at the coast', itemIds: ['demo9', 'demo8'] }];
  }

  async me() {
    return { name: 'Demo family member', member: true };
  }

  private summary(i: DemoItem): ItemSummaryDto {
    return {
      id: i.id,
      kind: i.kind,
      thumbUrl: i.src,
      durationMs: i.durationMs,
      capture: i.date ? { date: i.date, time: i.time, source: i.source! } : undefined,
    };
  }

  private sorted(list: DemoItem[]): DemoItem[] {
    return [...list].sort((a, b) => {
      const ka = a.date ? `${a.date}T${a.time ?? '00:00:00'}` : '';
      const kb = b.date ? `${b.date}T${b.time ?? '00:00:00'}` : '';
      return kb.localeCompare(ka) || b.createdAt - a.createdAt;
    });
  }

  async timeline(opts: { year?: number } = {}): Promise<TimelineDto> {
    const dated = this.sorted(this.items.filter((i) => i.date && (!opts.year || i.date < String(opts.year + 1))));
    const months: TimelineMonthDto[] = [];
    for (const i of dated) {
      const month = i.date!.slice(0, 7);
      let m = months.at(-1);
      if (!m || m.month !== month) {
        months.push((m = { month, count: this.items.filter((x) => x.date?.startsWith(month)).length, days: [] }));
      }
      let d = m.days.at(-1);
      if (!d || d.date !== i.date) {
        m.days.push((d = { date: i.date!, count: this.items.filter((x) => x.date === i.date).length, items: [] }));
      }
      d.items.push(this.summary(i));
    }
    return { months, undatedCount: this.items.filter((i) => !i.date).length };
  }

  async undated() {
    const list = this.items.filter((i) => !i.date);
    return { count: list.length, items: this.sorted(list).map((i) => this.summary(i)) };
  }

  private find(id: string): DemoItem {
    const item = this.items.find((i) => i.id === id);
    if (!item) throw new ApiError(404, 'not_found', 'That item was not found.');
    return item;
  }

  async item(id: string): Promise<ItemDetailDto> {
    const i = this.find(id);
    return {
      id: i.id,
      kind: i.kind,
      status: 'ready',
      addedBy: i.addedBy,
      capture: i.date ? { date: i.date, time: i.time, source: i.source! } : undefined,
      canSetDate: !i.date,
      thumbUrl: i.src,
      displayUrl: i.kind === 'photo' ? i.src : undefined,
      posterUrl: i.kind === 'video' ? i.src : undefined,
      durationMs: i.durationMs,
      tags: i.tags,
      albums: this.albumList.filter((a) => a.itemIds.includes(i.id)).map((a) => ({ id: a.id, name: a.name })),
    };
  }

  async addTag(id: string, label: string) {
    const clean = label.trim().replace(/\s+/g, ' ');
    if (!clean) throw new ApiError(400, 'invalid_tag', 'A tag cannot be empty.');
    const i = this.find(id);
    if (!i.tags.some((t) => t.key === clean.toLowerCase())) {
      i.tags.push({ key: clean.toLowerCase(), label: clean, source: 'family', addedBy: 'You' });
    }
    return this.item(id);
  }

  async removeTag(id: string, key: string) {
    const i = this.find(id);
    i.tags = i.tags.filter((t) => t.key !== key);
    return this.item(id);
  }

  async setDate(id: string, date: string) {
    const i = this.find(id);
    if (i.date) throw new ApiError(409, 'already_dated', 'This item already has a date.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ApiError(400, 'invalid_date', 'Enter a full date: year, month and day.');
    i.date = date;
    i.source = 'family';
    return this.item(id);
  }

  async search(tags: string[]) {
    const keys = tags.map((t) => t.trim().toLowerCase()).filter(Boolean);
    const matched = this.sorted(this.items.filter((i) => keys.every((k) => i.tags.some((t) => t.key === k))));
    const tally = new Map<string, number>();
    for (const i of matched) for (const t of i.tags) if (!keys.includes(t.key)) tally.set(t.key, (tally.get(t.key) ?? 0) + 1);
    const related = [...tally.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 4)
      .map(([key]) => ({ key, label: key }));
    return { tags: keys, count: matched.length, items: matched.map((i) => this.summary(i)), related };
  }

  private albumDto(a: { id: string; name: string; itemIds: string[] }): AlbumDto {
    const list = this.sorted(this.items.filter((i) => a.itemIds.includes(i.id)));
    return { id: a.id, name: a.name, count: list.length, coverUrl: list[0]?.src };
  }

  private findAlbum(id: string) {
    const a = this.albumList.find((x) => x.id === id);
    if (!a) throw new ApiError(404, 'album_not_found', 'That album was not found.');
    return a;
  }

  async albums() {
    return { albums: this.albumList.map((a) => this.albumDto(a)) };
  }

  async album(id: string) {
    const a = this.findAlbum(id);
    return {
      album: this.albumDto(a),
      items: this.sorted(this.items.filter((i) => a.itemIds.includes(i.id))).map((i) => this.summary(i)),
    };
  }

  async createAlbum(name: string) {
    const clean = name.trim();
    if (!clean) throw new ApiError(400, 'invalid_name', 'Give the album a name.');
    const a = { id: `album${++this.nextId}`, name: clean, itemIds: [] };
    this.albumList.unshift(a);
    return this.albumDto(a);
  }

  async addToAlbum(albumId: string, itemId: string) {
    const a = this.findAlbum(albumId);
    if (!a.itemIds.includes(itemId)) a.itemIds.push(itemId);
    return this.albumDto(a);
  }

  async removeFromAlbum(albumId: string, itemId: string) {
    const a = this.findAlbum(albumId);
    a.itemIds = a.itemIds.filter((x) => x !== itemId);
    return this.albumDto(a);
  }

  async deleteAlbum(albumId: string) {
    this.albumList = this.albumList.filter((a) => a.id !== albumId);
  }

  private pendingFiles = new Map<string, { req: UploadRequest['files'][number]; albumId?: string }>();

  async requestUploads(req: UploadRequest): Promise<UploadResponse> {
    return {
      results: req.files.map((f) => {
        const id = `demo${++this.nextId}`;
        this.pendingFiles.set(id, { req: f, albumId: req.albumId });
        return { ok: true as const, name: f.name, itemId: id, grant: { mode: 'single' as const, url: id, headers: {} } };
      }),
    };
  }

  private fileUrls = new Map<string, string>();

  async sendFile(grant: { mode: string; url?: string }, file: File, onProgress: (f: number) => void) {
    if (grant.url) this.fileUrls.set(grant.url, URL.createObjectURL(file));
    onProgress(1);
    return undefined;
  }

  async completeUpload(itemId: string) {
    const pending = this.pendingFiles.get(itemId);
    if (!pending) throw new ApiError(404, 'not_found', 'That upload was not found.');
    const kind = pending.req.type.startsWith('video/') ? 'video' : 'photo';
    this.items.push({
      id: itemId,
      kind,
      src: kind === 'photo' ? (this.fileUrls.get(itemId) ?? img('garden')) : img('birthday'),
      date: pending.req.captureDate,
      source: pending.req.captureDate ? 'family' : undefined,
      addedBy: 'You',
      tags: kind === 'photo' ? ai('new upload') : [],
      createdAt: Date.now(),
      durationMs: kind === 'video' ? 30_000 : undefined,
    });
    if (pending.albumId) this.findAlbum(pending.albumId).itemIds.push(itemId);
    return { status: 'ready' };
  }
}
