import type {
  AlbumDetailDto,
  AlbumDto,
  ErrorDto,
  ItemDetailDto,
  RecentlyDeletedDto,
  SearchDto,
  TimelineDto,
  UndatedDto,
  UploadGrantDto,
  UploadRequest,
  UploadResponse,
} from '../core/api-types';

export type Parts = { partNumber: number; etag: string }[];

export interface ApiClient {
  me(): Promise<{ name: string; member: boolean }>;
  timeline(opts?: { cursor?: string; year?: number }): Promise<TimelineDto>;
  undated(cursor?: string): Promise<UndatedDto>;
  item(id: string): Promise<ItemDetailDto>;
  addTag(id: string, label: string): Promise<ItemDetailDto>;
  removeTag(id: string, key: string): Promise<ItemDetailDto>;
  setDate(id: string, date: string): Promise<ItemDetailDto>;
  deleteItem(id: string): Promise<ItemDetailDto>;
  restoreItem(id: string): Promise<ItemDetailDto>;
  recentlyDeleted(): Promise<RecentlyDeletedDto>;
  deleteForGood(id: string): Promise<void>;
  search(tags: string[], cursor?: string): Promise<SearchDto>;
  albums(): Promise<{ albums: AlbumDto[] }>;
  album(id: string, cursor?: string): Promise<AlbumDetailDto>;
  createAlbum(name: string): Promise<AlbumDto>;
  addToAlbum(albumId: string, itemId: string): Promise<AlbumDto>;
  removeFromAlbum(albumId: string, itemId: string): Promise<AlbumDto>;
  deleteAlbum(albumId: string): Promise<void>;
  requestUploads(req: UploadRequest): Promise<UploadResponse>;
  sendFile(grant: UploadGrantDto, file: File, onProgress: (fraction: number) => void): Promise<Parts | undefined>;
  completeUpload(itemId: string, parts?: Parts): Promise<{ status: string }>;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface HttpOptions {
  /** Defaults to the browser's fetch; the preview and tests pass an in-process one. */
  fetch?: typeof fetch;
  /** First wait before retrying a failed storage send; doubles each time. */
  retryDelayMs?: number;
}

export class HttpApiClient implements ApiClient {
  private readonly fetch: typeof fetch;
  private readonly retryDelayMs: number;

  constructor(
    private readonly baseUrl: string,
    private readonly token: () => Promise<string | undefined>,
    opts: HttpOptions = {},
  ) {
    this.fetch = opts.fetch ?? ((input, init) => fetch(input, init));
    this.retryDelayMs = opts.retryDelayMs ?? 1000;
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const token = await this.token();
    const res = await this.fetch(this.baseUrl.replace(/\/$/, '') + path, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : undefined;
    if (!res.ok) {
      const err = (data ?? {}) as Partial<ErrorDto>;
      throw new ApiError(res.status, err.error ?? 'error', err.message ?? 'Something went wrong. Please try again.');
    }
    return data as T;
  }

  me() {
    return this.call<{ name: string; member: boolean }>('GET', '/me');
  }
  timeline(opts: { cursor?: string; year?: number } = {}) {
    const q = new URLSearchParams();
    if (opts.cursor) q.set('cursor', opts.cursor);
    if (opts.year) q.set('year', String(opts.year));
    return this.call<TimelineDto>('GET', `/timeline${q.size ? `?${q}` : ''}`);
  }
  undated(cursor?: string) {
    return this.call<UndatedDto>('GET', `/undated${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`);
  }
  item(id: string) {
    return this.call<ItemDetailDto>('GET', `/items/${encodeURIComponent(id)}`);
  }
  addTag(id: string, label: string) {
    return this.call<ItemDetailDto>('POST', `/items/${encodeURIComponent(id)}/tags`, { label });
  }
  removeTag(id: string, key: string) {
    return this.call<ItemDetailDto>('DELETE', `/items/${encodeURIComponent(id)}/tags/${encodeURIComponent(key)}`);
  }
  setDate(id: string, date: string) {
    return this.call<ItemDetailDto>('PUT', `/items/${encodeURIComponent(id)}/capture-date`, { date });
  }
  deleteItem(id: string) {
    return this.call<ItemDetailDto>('DELETE', `/items/${encodeURIComponent(id)}`);
  }
  restoreItem(id: string) {
    return this.call<ItemDetailDto>('POST', `/items/${encodeURIComponent(id)}/restore`);
  }
  recentlyDeleted() {
    return this.call<RecentlyDeletedDto>('GET', '/recently-deleted');
  }
  async deleteForGood(id: string) {
    await this.call('DELETE', `/recently-deleted/${encodeURIComponent(id)}`);
  }
  search(tags: string[], cursor?: string) {
    const q = new URLSearchParams({ tags: tags.join(',') });
    if (cursor) q.set('cursor', cursor);
    return this.call<SearchDto>('GET', `/search?${q}`);
  }
  albums() {
    return this.call<{ albums: AlbumDto[] }>('GET', '/albums');
  }
  album(id: string, cursor?: string) {
    return this.call<AlbumDetailDto>('GET', `/albums/${encodeURIComponent(id)}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`);
  }
  createAlbum(name: string) {
    return this.call<AlbumDto>('POST', '/albums', { name });
  }
  addToAlbum(albumId: string, itemId: string) {
    return this.call<AlbumDto>('POST', `/albums/${encodeURIComponent(albumId)}/items`, { itemId });
  }
  removeFromAlbum(albumId: string, itemId: string) {
    return this.call<AlbumDto>('DELETE', `/albums/${encodeURIComponent(albumId)}/items/${encodeURIComponent(itemId)}`);
  }
  async deleteAlbum(albumId: string) {
    await this.call('DELETE', `/albums/${encodeURIComponent(albumId)}`);
  }
  requestUploads(req: UploadRequest) {
    return this.call<UploadResponse>('POST', '/uploads', req);
  }
  completeUpload(itemId: string, parts?: Parts) {
    return this.call<{ status: string }>('POST', `/uploads/${encodeURIComponent(itemId)}/complete`, { parts });
  }

  /** Sends straight to storage. Large files go in parts, each retried, so a flaky connection need not restart. */
  async sendFile(grant: UploadGrantDto, file: File, onProgress: (fraction: number) => void): Promise<Parts | undefined> {
    if (grant.mode === 'single') {
      await this.withRetries(async () => {
        const res = await this.fetch(grant.url, { method: 'PUT', headers: grant.headers, body: file });
        if (!res.ok) throw new Error(`Upload failed (${res.status})`);
      });
      onProgress(1);
      return undefined;
    }
    const parts: Parts = [];
    for (const part of grant.parts) {
      const start = (part.partNumber - 1) * grant.partSize;
      const chunk = file.slice(start, start + grant.partSize);
      const etag = await this.withRetries(async () => {
        const res = await this.fetch(part.url, { method: 'PUT', body: chunk });
        const tag = res.headers.get('etag');
        if (!res.ok || !tag) throw new Error(`Upload failed (${res.status})`);
        return tag;
      });
      parts.push({ partNumber: part.partNumber, etag });
      onProgress(parts.length / grant.parts.length);
    }
    return parts;
  }

  private async withRetries<T>(run: () => Promise<T>, attempts = 4): Promise<T> {
    let last: unknown;
    for (let i = 0; i < attempts; i++) {
      try {
        return await run();
      } catch (err) {
        last = err;
        if (i < attempts - 1) await new Promise((r) => setTimeout(r, this.retryDelayMs * 2 ** i));
      }
    }
    throw last;
  }
}
