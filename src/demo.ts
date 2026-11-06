// The browser preview, used when no backend is configured. It is the real Archive and HTTP API running in the
// page on in-memory adapters, reached through the normal web client. Only media processing is stood in for:
// uploads are published as they are, with the date read from the photo, and get no AI tags.
import { inProcessFetch, type Caller } from '../core/adapters/in-process-fetch';
import { MemoryRepository } from '../core/adapters/memory-repository';
import type { CaptureDate, Item, ItemKind, ItemMedia, Person } from '../core/domain';
import { makeHttpHandler } from '../core/http-api';
import { addFamilyTag, applyAiTags, captureFor, markUploaded, newUpload, parseTag, publish } from '../core/item';
import { defaultConfig, type BlobStore, type Deps, type ProcessingMessage, type Repository, type UploadGrant } from '../core/ports';
import { HttpApiClient, type ApiClient } from './api';
import { readFileDate } from './file-date';

const API = 'https://api.demo.invalid';
const STORAGE = 'https://storage.demo.invalid/';
const you: Caller = { sub: 'demo-you', name: 'Sam', groups: ['family'] };
const rosa: Person = { id: 'demo-rosa', name: 'Aunt Rosa' };
const dan: Person = { id: 'demo-dan', name: 'Uncle Dan' };

export function createDemoApi(): ApiClient {
  const repo = new MemoryRepository();
  const blobs = new BrowserBlobStore();
  const unavailable = () => Promise.reject(new Error('Not available in the preview'));
  const deps: Deps = {
    repo,
    staging: blobs,
    media: blobs,
    processingQueue: { send: (msg) => publishUpload(repo, blobs, msg) },
    taggingQueue: { send: async () => {} },
    tagger: { tag: unavailable },
    transcoder: { submit: unavailable, getJob: unavailable, parseEvent: () => undefined },
    images: { process: unavailable, forAi: unavailable },
    metadata: { photoCapture: unavailable, videoInfo: unavailable },
    clock: { now: () => new Date() },
    ids: { next: () => crypto.randomUUID() },
    config: defaultConfig,
  };
  const seeded = seed(repo, blobs);
  const local = inProcessFetch({
    apiBase: API,
    api: makeHttpHandler(deps),
    caller: (token) => (token === you.sub ? you : undefined),
    store: (url, bytes, contentType) => blobs.put(url.slice(STORAGE.length), bytes, contentType),
  });
  const fetch: typeof globalThis.fetch = async (input, init) => {
    await seeded;
    return local(input, init);
  };
  return new HttpApiClient(API, async () => you.sub, { fetch });
}

/** Stands in for the processing pipeline: publishes the original as is. */
async function publishUpload(repo: Repository, blobs: BrowserBlobStore, msg: ProcessingMessage): Promise<void> {
  if (msg.kind !== 'ingest') return;
  const item = await repo.getItem(msg.itemId);
  if (!item || item.status !== 'processing') return;
  const date = item.kind === 'photo' ? await readFileDate(blobs.blob(item.stagingKey)) : null;
  const fromFile: CaptureDate | undefined = date ? { date, source: 'file' } : undefined;
  if (item.requestedAlbumId && (await repo.getAlbum(item.requestedAlbumId))) {
    await repo.addToAlbum(item.requestedAlbumId, item.id, new Date().toISOString());
  }
  blobs.link('demo/poster', '/demo/birthday.svg');
  const media: ItemMedia =
    item.kind === 'photo'
      ? { thumbKey: item.stagingKey, displayKey: item.stagingKey, checksums: {} }
      : { thumbKey: 'demo/poster', posterKey: 'demo/poster', videoKey: item.stagingKey, checksums: {} };
  await repo.updateItem(item.id, (it) => publish(it, captureFor(it, fromFile), media));
}

async function seed(repo: Repository, blobs: BrowserBlobStore): Promise<void> {
  let n = 0;
  const add = async (
    kind: ItemKind,
    picture: string,
    when: { date: string; time: string } | undefined,
    aiTags: string[] = [],
    extra: { durationMs?: number; familyTag?: string } = {},
  ): Promise<string> => {
    n++;
    const id = `demo${n}`;
    const key = `demo/${picture}`;
    blobs.link(key, `/demo/${picture}.svg`);
    const createdAt = new Date(Date.UTC(2026, 9, 1, 12, n)).toISOString();
    let it: Item = newUpload({
      id,
      kind,
      contentType: kind === 'photo' ? 'image/jpeg' : 'video/mp4',
      size: 1,
      addedBy: n % 2 ? rosa : dan,
      createdAt,
      stagingKey: key,
    });
    const media: ItemMedia =
      kind === 'photo'
        ? { thumbKey: key, displayKey: key, checksums: {} }
        : { thumbKey: key, posterKey: key, durationMs: extra.durationMs, checksums: {} };
    it = publish(markUploaded(it)!, when && { ...when, source: 'file' }, media)!;
    if (kind === 'photo') it = applyAiTags(it, aiTags, 'demo', createdAt)!;
    if (extra.familyTag) it = addFamilyTag(it, parseTag(extra.familyTag), dan)!;
    await repo.createItem(it);
    return id;
  };
  const on = (date: string, time: string) => ({ date, time });

  await add('video', 'birthday', on('2026-10-26', '15:10:00'), [], { durationMs: 45_000 });
  await add('photo', 'birthday', on('2026-10-26', '15:02:00'), ['birthday cake', 'candles', 'party']);
  await add('photo', 'picnic', on('2026-10-26', '13:30:00'), ['picnic', 'park', 'outdoors']);
  await add('photo', 'picnic', on('2026-10-19', '12:00:00'), ['picnic', 'park', 'tree', 'outdoors']);
  await add('photo', 'garden', on('2026-10-19', '11:00:00'), ['flowers', 'garden', 'fence', 'outdoors']);
  await add('photo', 'kids', on('2026-09-20', '10:00:00'), ['soccer', 'field', 'child', 'outdoors']);
  await add('video', 'dog', on('2026-09-20', '09:30:00'), [], { durationMs: 72_000 });
  const lake = await add('photo', 'lake', on('2026-09-12', '19:00:00'), ['lake', 'sunset', 'dock', 'mountains', 'outdoors']);
  const beach = await add('photo', 'beach', on('2026-08-16', '10:00:00'), ['beach', 'beach umbrella', 'ocean', 'sunny day'], {
    familyTag: 'Cousins',
  });
  await add('photo', 'snow', on('2025-12-24', '18:00:00'), ['christmas tree', 'snow', 'night', 'lights']);
  await add('photo', 'wedding-old', undefined, ['wedding', 'couple', 'arch']);
  await add('photo', 'oldhouse', undefined, ['house', 'tree', 'porch']);

  await repo.createAlbum({ id: 'album1', name: 'Summer at the coast', createdBy: rosa, createdAt: '2026-10-01T12:00:00.000Z' });
  await repo.addToAlbum('album1', beach, '2026-10-01T12:00:00.000Z');
  await repo.addToAlbum('album1', lake, '2026-10-01T12:00:00.000Z');
}

/** Files kept in the page as object URLs; bundled sample pictures are linked by URL. */
class BrowserBlobStore implements BlobStore {
  private readonly files = new Map<string, { blob: Blob; url: string }>();
  private readonly links = new Map<string, string>();

  async createUploadGrant(key: string, contentType: string): Promise<UploadGrant> {
    return { mode: 'single', url: STORAGE + key, headers: { 'content-type': contentType } };
  }
  async completeMultipart(): Promise<void> {
    throw new Error('The preview sends files whole');
  }
  put(key: string, bytes: Uint8Array, contentType: string | undefined): string {
    const blob = new Blob([bytes as BlobPart], { type: contentType });
    this.files.set(key, { blob, url: URL.createObjectURL(blob) });
    return `"${key}"`;
  }
  link(key: string, url: string): void {
    this.links.set(key, url);
  }
  blob(key: string): Blob {
    return this.files.get(key)?.blob ?? new Blob();
  }
  async head(key: string) {
    const f = this.files.get(key);
    return f ? { size: f.blob.size } : this.links.has(key) ? { size: 1 } : undefined;
  }
  async read(key: string): Promise<Uint8Array> {
    return new Uint8Array(await this.blob(key).arrayBuffer());
  }
  async readRange(key: string, start: number, endInclusive: number): Promise<Uint8Array> {
    return new Uint8Array(await this.blob(key).slice(start, endInclusive + 1).arrayBuffer());
  }
  async write(key: string, body: Uint8Array, contentType: string): Promise<void> {
    this.put(key, body, contentType);
  }
  async delete(key: string): Promise<void> {
    const f = this.files.get(key);
    if (f) URL.revokeObjectURL(f.url);
    this.files.delete(key);
  }
  async signedGetUrl(key: string): Promise<string> {
    return this.files.get(key)?.url ?? this.links.get(key) ?? '';
  }
}
