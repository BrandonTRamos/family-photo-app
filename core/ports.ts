// Boundaries between the core and the outside world. AWS adapters and test fakes implement these.
import type { Album, CaptureDate, Item } from './domain.js';

export interface Page<T> {
  items: T[];
  cursor?: string;
}

export interface Repository {
  createItem(item: Item): Promise<void>;
  getItem(id: string): Promise<Item | undefined>;
  getItems(ids: string[]): Promise<Item[]>;
  /**
   * Optimistically updates an item. `mutate` returns the new item, or undefined to leave it unchanged.
   * On a concurrent change it is run again on the fresh item, so it must be pure (see item.ts); an error
   * it throws aborts the update and reaches the caller. Returns the stored item, or undefined if missing.
   */
  updateItem(id: string, mutate: (item: Item) => Item | undefined): Promise<Item | undefined>;

  /** Ready, dated items, newest first; with `year`, only those taken in that year or earlier. */
  timeline(opts: { limit: number; cursor?: string; year?: number }): Promise<Page<Item>>;
  /** Count of ready items whose Capture date starts with the prefix (YYYY-MM or YYYY-MM-DD). */
  countTimeline(datePrefix: string): Promise<number>;
  undated(opts: { limit: number; cursor?: string }): Promise<Page<Item>>;
  countUndated(): Promise<number>;
  itemIdsWithTag(tagKey: string): Promise<string[]>;

  createAlbum(album: Album): Promise<void>;
  getAlbum(id: string): Promise<Album | undefined>;
  listAlbums(): Promise<Album[]>;
  /** Removes the Album and its memberships. Never touches items. */
  deleteAlbum(id: string): Promise<void>;
  addToAlbum(albumId: string, itemId: string, at: string): Promise<void>;
  removeFromAlbum(albumId: string, itemId: string): Promise<void>;
  albumItemIds(albumId: string): Promise<string[]>;
  albumIdsForItem(itemId: string): Promise<string[]>;
}

export type UploadGrant =
  | { mode: 'single'; url: string; headers: Record<string, string> }
  | { mode: 'multipart'; uploadId: string; partSize: number; parts: { partNumber: number; url: string }[] };

export interface BlobStore {
  createUploadGrant(key: string, contentType: string, size: number): Promise<UploadGrant>;
  completeMultipart(key: string, uploadId: string, parts: { partNumber: number; etag: string }[]): Promise<void>;
  head(key: string): Promise<{ size: number } | undefined>;
  read(key: string): Promise<Buffer>;
  readRange(key: string, start: number, endInclusive: number): Promise<Buffer>;
  write(key: string, body: Buffer, contentType: string): Promise<void>;
  delete(key: string): Promise<void>;
  signedGetUrl(key: string, expiresInSeconds: number): Promise<string>;
}

export interface Queue<M> {
  send(message: M): Promise<void>;
}

export interface AiTagger {
  /** Returns open-ended tags for what the image shows. Never names or relationships. */
  tag(image: Buffer, contentType: string): Promise<{ tags: string[]; model: string }>;
}

export type TranscodeStatus = 'SUBMITTED' | 'PROGRESSING' | 'COMPLETE' | 'ERROR' | 'CANCELED';

export interface VideoTranscoder {
  /** Idempotent per item id. Writes the video and poster into outputFolder in the media store. */
  submit(req: { itemId: string; inputKey: string; outputFolder: string }): Promise<{ jobId: string }>;
  getJob(jobId: string): Promise<{ status: TranscodeStatus; outputs?: VideoOutputs; error?: string }>;
  /** Reads the transcoder's own job-state notification off the processing queue; undefined if it isn't one. */
  parseEvent(event: unknown): VideoEvent | undefined;
}

export interface VideoOutputs {
  videoKey: string;
  posterKey: string;
  durationMs: number;
}

export interface ProcessedImage {
  display: { bytes: Buffer; width: number; height: number };
  thumb: { bytes: Buffer; width: number; height: number };
}

export interface ImageProcessor {
  /** Auto-orients, compresses and strips metadata (including GPS). Throws on unreadable input. */
  process(bytes: Buffer): Promise<ProcessedImage>;
  /** Small copy for AI tagging. */
  forAi(bytes: Buffer): Promise<Buffer>;
}

export interface MetadataReader {
  photoCapture(bytes: Buffer): Promise<CaptureDate | undefined>;
  videoCapture(read: (start: number, endInclusive: number) => Promise<Buffer>, size: number): Promise<CaptureDate | undefined>;
}

export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  next(): string;
}

export type VideoEvent = { kind: 'video'; itemId: string; jobId: string; status: TranscodeStatus; outputs?: VideoOutputs; error?: string };

export type ProcessingMessage = { kind: 'ingest'; itemId: string } | VideoEvent;

export interface TaggingMessage {
  kind: 'tag';
  itemId: string;
}

export interface Deps {
  repo: Repository;
  staging: BlobStore;
  media: BlobStore;
  processingQueue: Queue<ProcessingMessage>;
  taggingQueue: Queue<TaggingMessage>;
  tagger: AiTagger;
  transcoder: VideoTranscoder;
  images: ImageProcessor;
  metadata: MetadataReader;
  clock: Clock;
  ids: IdGenerator;
  config: Config;
}

export interface Config {
  maxPhotoBytes: number;
  maxVideoBytes: number;
  multipartThreshold: number;
  mediaUrlTtlSeconds: number;
  familyGroup: string;
}

export const defaultConfig: Config = {
  maxPhotoBytes: 50 * 1024 * 1024,
  maxVideoBytes: 2 * 1024 * 1024 * 1024,
  multipartThreshold: 32 * 1024 * 1024,
  mediaUrlTtlSeconds: 3600,
  familyGroup: 'family',
};
