// Family-facing use cases behind the HTTP API.
import { DomainError, parseExactDate, type Album, type Item, type Person } from './domain.js';
import {
  addFamilyTag,
  canSetCaptureDate,
  compareForDisplay,
  canDelete,
  isPurgeDue,
  isReady,
  isUploader,
  isVisibleTo,
  markUploaded,
  matchesSearch,
  mediaKeys,
  moveToRecentlyDeleted,
  newUpload,
  parseTag,
  purgeOn,
  removeTag,
  restore,
  setCaptureDate,
  tagMatches,
} from './item.js';
import {
  PHOTO_TYPES,
  VIDEO_TYPES,
  type AlbumDetailDto,
  type AlbumDto,
  type ItemDetailDto,
  type ItemSummaryDto,
  type RecentlyDeletedDto,
  type SearchDto,
  type TimelineDto,
  type TimelineMonthDto,
  type UndatedDto,
  type UploadRequest,
  type UploadResponse,
  type UploadResultDto,
} from './api-types.js';
import type { Deps } from './ports.js';
import { mediaLayout } from './media-layout.js';

const MAX_FILES_PER_UPLOAD = 50;
const MAX_ALBUM_NAME = 60;

export class Archive {
  constructor(private readonly d: Deps) {}

  private today(): string {
    return this.d.clock.now().toISOString().slice(0, 10);
  }

  // ---- uploads ----

  async requestUploads(user: Person, body: unknown): Promise<UploadResponse> {
    const req = body as Partial<UploadRequest> | undefined;
    if (!req || !Array.isArray(req.files) || req.files.length === 0) {
      throw new DomainError(400, 'invalid_request', 'Choose at least one photo or video.');
    }
    if (req.files.length > MAX_FILES_PER_UPLOAD) {
      throw new DomainError(400, 'invalid_request', `Upload at most ${MAX_FILES_PER_UPLOAD} items at a time.`);
    }
    if (req.albumId !== undefined && !(await this.d.repo.getAlbum(String(req.albumId)))) {
      throw new DomainError(404, 'album_not_found', 'That album no longer exists.');
    }
    const results: UploadResultDto[] = [];
    for (const file of req.files) results.push(await this.requestOne(user, file, req.albumId));
    return { results };
  }

  private async requestOne(user: Person, file: unknown, albumId: string | undefined): Promise<UploadResultDto> {
    const f = (file ?? {}) as Record<string, unknown>;
    const name = typeof f.name === 'string' ? f.name.slice(0, 200) : 'file';
    const type = typeof f.type === 'string' ? f.type.toLowerCase() : '';
    const size = f.size;
    const kind = (PHOTO_TYPES as readonly string[]).includes(type)
      ? 'photo'
      : (VIDEO_TYPES as readonly string[]).includes(type)
        ? 'video'
        : undefined;
    if (!kind) {
      return { ok: false, name, error: 'unsupported_type', message: `${name} is not a supported photo or video type.` };
    }
    if (typeof size !== 'number' || !Number.isInteger(size) || size <= 0) {
      return { ok: false, name, error: 'invalid', message: `${name} looks empty.` };
    }
    const max = kind === 'photo' ? this.d.config.maxPhotoBytes : this.d.config.maxVideoBytes;
    if (size > max) {
      return { ok: false, name, error: 'too_large', message: `${name} is larger than the ${formatBytes(max)} limit.` };
    }
    let requestedCaptureDate: string | undefined;
    if (f.captureDate !== undefined && f.captureDate !== null && f.captureDate !== '') {
      try {
        requestedCaptureDate = parseExactDate(f.captureDate, this.today());
      } catch (err) {
        return { ok: false, name, error: 'invalid', message: (err as Error).message };
      }
    }

    const id = this.d.ids.next();
    const stagingKey = mediaLayout.original(id);
    const grant = await this.d.staging.createUploadGrant(stagingKey, type, size);
    await this.d.repo.createItem(
      newUpload({
        id,
        kind,
        contentType: type,
        size,
        addedBy: user,
        createdAt: this.d.clock.now().toISOString(),
        stagingKey,
        multipartUploadId: grant.mode === 'multipart' ? grant.uploadId : undefined,
        requestedCaptureDate,
        requestedAlbumId: albumId,
      }),
    );
    return { ok: true, name, itemId: id, grant };
  }

  async completeUpload(user: Person, id: string, body: unknown): Promise<{ id: string; status: Item['status'] }> {
    const item = await this.d.repo.getItem(id);
    if (!item || item.addedBy.id !== user.id) throw new DomainError(404, 'not_found', 'That upload was not found.');
    if (item.status !== 'uploading') return { id, status: item.status };

    if (item.multipartUploadId) {
      const parts = (body as { parts?: unknown } | undefined)?.parts;
      if (!Array.isArray(parts) || parts.length === 0) {
        throw new DomainError(400, 'invalid_request', 'The upload parts are missing.');
      }
      const clean = parts.map((p) => {
        const part = p as { partNumber?: unknown; etag?: unknown };
        if (typeof part.partNumber !== 'number' || typeof part.etag !== 'string') {
          throw new DomainError(400, 'invalid_request', 'An upload part is malformed.');
        }
        return { partNumber: part.partNumber, etag: part.etag };
      });
      try {
        await this.d.staging.completeMultipart(item.stagingKey, item.multipartUploadId, clean);
      } catch {
        throw new DomainError(409, 'upload_incomplete', 'Some of the file did not arrive. Please try again.');
      }
    }

    const head = await this.d.staging.head(item.stagingKey);
    if (!head) throw new DomainError(409, 'upload_incomplete', 'The file has not finished uploading.');
    if (head.size !== item.size) {
      await this.d.staging.delete(item.stagingKey);
      throw new DomainError(409, 'upload_incomplete', 'The file did not arrive in full. Please try again.');
    }

    const updated = await this.d.repo.updateItem(id, markUploaded);
    if (updated?.status === 'processing') await this.d.processingQueue.send({ kind: 'ingest', itemId: id });
    return { id, status: updated?.status ?? 'processing' };
  }

  // ---- browsing ----

  async timeline(query: Record<string, string | undefined>): Promise<TimelineDto> {
    const limit = parseLimit(query.limit, 60);
    const year = query.year === undefined ? undefined : Number(query.year);
    if (year !== undefined && (!Number.isInteger(year) || year < 1800 || year > 9999)) {
      throw new DomainError(400, 'invalid_request', 'Year must be a four-digit year.');
    }
    const page = await this.d.repo.timeline({ limit, cursor: query.cursor, year });
    const months: TimelineMonthDto[] = [];
    for (const item of page.items) {
      const date = item.capture!.date;
      const month = date.slice(0, 7);
      let m = months.at(-1);
      if (!m || m.month !== month) months.push((m = { month, count: 0, days: [] }));
      let d = m.days.at(-1);
      if (!d || d.date !== date) m.days.push((d = { date, count: 0, items: [] }));
      d.items.push(await this.summary(item));
    }
    await Promise.all(
      months.flatMap((m) => [
        this.d.repo.countTimeline(m.month).then((c) => (m.count = c)),
        ...m.days.map((d) => this.d.repo.countTimeline(d.date).then((c) => (d.count = c))),
      ]),
    );
    const undatedCount = await this.d.repo.countUndated();
    return { months, undatedCount, cursor: page.cursor };
  }

  async undated(query: Record<string, string | undefined>): Promise<UndatedDto> {
    const page = await this.d.repo.undated({ limit: parseLimit(query.limit, 60), cursor: query.cursor });
    return {
      count: await this.d.repo.countUndated(),
      items: await Promise.all(page.items.map((i) => this.summary(i))),
      cursor: page.cursor,
    };
  }

  async item(user: Person, id: string): Promise<ItemDetailDto> {
    const item = await this.d.repo.getItem(id);
    if (!item || !isVisibleTo(item, user)) throw new DomainError(404, 'not_found', 'That item was not found.');
    return this.detail(item, user);
  }

  async search(query: Record<string, string | undefined>): Promise<SearchDto> {
    const terms = [...new Set((query.tags ?? '').split(',').filter((t) => t.trim()).map((t) => parseTag(t).key))];
    if (terms.length === 0) throw new DomainError(400, 'invalid_request', 'Type what you are looking for.');
    const idLists = await Promise.all(terms.map((t) => this.d.repo.itemIdsMatching(t)));
    const [first, ...rest] = idLists.map((ids) => new Set(ids));
    const candidates = [...first].filter((id) => rest.every((s) => s.has(id)));
    const matched = sortForDisplay(
      (await this.d.repo.getItems(candidates)).filter((i) => isReady(i) && matchesSearch(i, terms)),
    );
    const tally = new Map<string, { label: string; n: number }>();
    for (const item of matched) {
      for (const t of item.tags) {
        if (terms.some((term) => tagMatches(t.key, term))) continue;
        const entry = tally.get(t.key) ?? { label: t.label, n: 0 };
        entry.n++;
        tally.set(t.key, entry);
      }
    }
    const related = [...tally.entries()]
      .sort((a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0]))
      .slice(0, 4)
      .map(([key, v]) => ({ key, label: v.label }));
    const { page, cursor } = offsetPage(matched, query.cursor, parseLimit(query.limit, 60));
    return { tags: terms, count: matched.length, items: await Promise.all(page.map((i) => this.summary(i))), related, cursor };
  }

  // ---- edits ----

  async addTag(user: Person, id: string, body: unknown): Promise<ItemDetailDto> {
    const tag = parseTag((body as { label?: unknown } | undefined)?.label);
    const item = await this.d.repo.updateItem(id, (it) => addFamilyTag(it, tag, user));
    if (!item) throw new DomainError(404, 'not_found', 'That item was not found.');
    return this.detail(item, user);
  }

  async removeTag(user: Person, id: string, rawKey: string): Promise<ItemDetailDto> {
    const { key } = parseTag(rawKey);
    const item = await this.d.repo.updateItem(id, (it) => removeTag(it, key));
    if (!item) throw new DomainError(404, 'not_found', 'That item was not found.');
    return this.detail(item, user);
  }

  async setCaptureDate(user: Person, id: string, body: unknown): Promise<ItemDetailDto> {
    const date = parseExactDate((body as { date?: unknown } | undefined)?.date, this.today());
    const item = await this.d.repo.updateItem(id, (it) => setCaptureDate(it, date));
    if (!item) throw new DomainError(404, 'not_found', 'That item was not found.');
    return this.detail(item, user);
  }

  // ---- deleting: Recently deleted for 30 days, then gone for good ----

  async deleteItem(user: Person, id: string): Promise<ItemDetailDto> {
    const at = this.d.clock.now().toISOString();
    const item = await this.d.repo.updateItem(id, (it) => moveToRecentlyDeleted(it, user, at));
    if (!item) throw new DomainError(404, 'not_found', 'That item was not found.');
    return this.detail(item, user);
  }

  async restoreItem(user: Person, id: string): Promise<ItemDetailDto> {
    const item = await this.d.repo.updateItem(id, (it) => restore(it, user));
    if (!item) throw new DomainError(404, 'not_found', 'That item was not found.');
    return this.detail(item, user);
  }

  /** The caller's own deleted Items, most recently deleted first. */
  async recentlyDeleted(user: Person): Promise<RecentlyDeletedDto> {
    const mine = (await this.d.repo.deletedItems())
      .filter((i) => isUploader(i, user))
      .sort((a, b) => b.deletedAt!.localeCompare(a.deletedAt!));
    return { items: await Promise.all(mine.map(async (i) => ({ ...(await this.summary(i)), purgeOn: purgeOn(i)! }))) };
  }

  /** "Delete now" from Recently deleted. */
  async deleteForGood(user: Person, id: string): Promise<{ deleted: true }> {
    const item = await this.d.repo.getItem(id);
    if (!item || !isVisibleTo(item, user)) throw new DomainError(404, 'not_found', 'That item was not found.');
    if (item.status !== 'deleted') throw new DomainError(409, 'not_deleted', 'Delete it first; it then waits in Recently deleted.');
    await this.purge(item);
    return { deleted: true };
  }

  /** Runs daily: removes Items that have been in Recently deleted for 30 days. */
  async purgeExpired(): Promise<number> {
    const now = this.d.clock.now();
    const due = (await this.d.repo.deletedItems()).filter((i) => isPurgeDue(i, now));
    for (const item of due) await this.purge(item);
    return due.length;
  }

  /** Files first, then the record, so a failure part-way is finished by the next run. */
  private async purge(item: Item): Promise<void> {
    for (const key of mediaKeys(item)) await this.d.media.delete(key);
    await this.d.repo.deleteItem(item.id);
  }

  // ---- albums ----

  async createAlbum(user: Person, body: unknown): Promise<AlbumDto> {
    const raw = (body as { name?: unknown } | undefined)?.name;
    const name = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') : '';
    if (!name) throw new DomainError(400, 'invalid_name', 'Give the album a name.');
    if (name.length > MAX_ALBUM_NAME) {
      throw new DomainError(400, 'invalid_name', `Album names can be at most ${MAX_ALBUM_NAME} characters.`);
    }
    const album: Album = { id: this.d.ids.next(), name, createdBy: user, createdAt: this.d.clock.now().toISOString() };
    await this.d.repo.createAlbum(album);
    return { id: album.id, name, count: 0 };
  }

  async listAlbums(): Promise<{ albums: AlbumDto[] }> {
    const albums = await this.d.repo.listAlbums();
    return { albums: await Promise.all(albums.map((a) => this.albumDto(a))) };
  }

  async album(id: string, query: Record<string, string | undefined>): Promise<AlbumDetailDto> {
    const album = await this.requireAlbum(id);
    const items = await this.albumItems(id);
    const { page, cursor } = offsetPage(items, query.cursor, parseLimit(query.limit, 60));
    return {
      album: await this.albumDto(album, items),
      items: await Promise.all(page.map((i) => this.summary(i))),
      cursor,
    };
  }

  async addToAlbum(albumId: string, body: unknown): Promise<AlbumDto> {
    const album = await this.requireAlbum(albumId);
    const itemId = (body as { itemId?: unknown } | undefined)?.itemId;
    const item = typeof itemId === 'string' ? await this.d.repo.getItem(itemId) : undefined;
    if (!item || !isReady(item)) throw new DomainError(404, 'not_found', 'That item was not found.');
    await this.d.repo.addToAlbum(albumId, item.id, this.d.clock.now().toISOString());
    return this.albumDto(album);
  }

  async removeFromAlbum(albumId: string, itemId: string): Promise<AlbumDto> {
    const album = await this.requireAlbum(albumId);
    await this.d.repo.removeFromAlbum(albumId, itemId);
    return this.albumDto(album);
  }

  async deleteAlbum(id: string): Promise<{ deleted: true }> {
    await this.requireAlbum(id);
    await this.d.repo.deleteAlbum(id);
    return { deleted: true };
  }

  // ---- mapping ----

  private async requireAlbum(id: string): Promise<Album> {
    const album = await this.d.repo.getAlbum(id);
    if (!album) throw new DomainError(404, 'album_not_found', 'That album was not found.');
    return album;
  }

  private async albumItems(albumId: string): Promise<Item[]> {
    const ids = await this.d.repo.albumItemIds(albumId);
    return sortForDisplay((await this.d.repo.getItems(ids)).filter(isReady));
  }

  private async albumDto(album: Album, items?: Item[]): Promise<AlbumDto> {
    const list = items ?? (await this.albumItems(album.id));
    const cover = list[0]?.media?.thumbKey;
    return {
      id: album.id,
      name: album.name,
      count: list.length,
      coverUrl: cover ? await this.url(cover) : undefined,
    };
  }

  private url(key: string): Promise<string> {
    return this.d.media.signedGetUrl(key, this.d.config.mediaUrlTtlSeconds);
  }

  private async summary(item: Item): Promise<ItemSummaryDto> {
    return {
      id: item.id,
      kind: item.kind,
      thumbUrl: await this.url(item.media!.thumbKey),
      durationMs: item.media?.durationMs,
      capture: item.capture ? { date: item.capture.date, time: item.capture.time, source: item.capture.source } : undefined,
    };
  }

  private async detail(item: Item, viewer: Person): Promise<ItemDetailDto> {
    const albumIds = await this.d.repo.albumIdsForItem(item.id);
    const albums = (await Promise.all(albumIds.map((a) => this.d.repo.getAlbum(a)))).filter((a): a is Album => !!a);
    const ready = isReady(item) || item.status === 'deleted';
    const m = ready ? item.media : undefined;
    return {
      id: item.id,
      kind: item.kind,
      status: item.status,
      addedBy: item.addedBy.name,
      capture:
        ready && item.capture
          ? { date: item.capture.date, time: item.capture.time, source: item.capture.source }
          : undefined,
      canSetDate: canSetCaptureDate(item),
      thumbUrl: m ? await this.url(m.thumbKey) : undefined,
      displayUrl: m?.displayKey ? await this.url(m.displayKey) : undefined,
      videoUrl: m?.videoKey ? await this.url(m.videoKey) : undefined,
      posterUrl: m?.posterKey ? await this.url(m.posterKey) : undefined,
      width: m?.width,
      height: m?.height,
      durationMs: m?.durationMs,
      tags: item.tags.map((t) => ({ key: t.key, label: t.label, source: t.source, addedBy: t.addedBy?.name })),
      albums: albums.sort((a, b) => a.name.localeCompare(b.name)).map((a) => ({ id: a.id, name: a.name })),
      failureReason: item.status === 'failed' ? item.failureReason : undefined,
      canDelete: canDelete(item, viewer),
      canRestore: item.status === 'deleted' && isUploader(item, viewer),
      purgeOn: purgeOn(item),
    };
  }
}

function sortForDisplay(list: Item[]): Item[] {
  return [...list].sort(compareForDisplay);
}

function offsetPage<T>(all: T[], cursor: string | undefined, limit: number): { page: T[]; cursor?: string } {
  let start = 0;
  try {
    start = cursor ? Number(atob(cursor)) || 0 : 0;
  } catch {
    // an unreadable cursor starts from the top
  }
  const end = start + limit;
  return { page: all.slice(start, end), cursor: end < all.length ? btoa(String(end)) : undefined };
}

function parseLimit(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 200) throw new DomainError(400, 'invalid_request', 'Limit must be 1 to 200.');
  return n;
}

function formatBytes(n: number): string {
  return n >= 1024 ** 3 ? `${n / 1024 ** 3} GB` : `${Math.round(n / 1024 ** 2)} MB`;
}
