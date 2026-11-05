// The Item module: every rule about how an Item changes and where it shows up.
// Operations are pure: each returns the next Item, or undefined when nothing changes.
// That makes them safe inside Repository.updateItem, which re-runs them on a write conflict.
// Errors are DomainErrors thrown before anything is written.
import { DomainError, type CaptureDate, type Item, type ItemKind, type ItemMedia, type Person } from './domain.js';

export const MAX_TAG_LENGTH = 40;
export const MAX_AI_TAGS = 6;

// ---- lifecycle: uploading → processing → ready | failed; ready ⇄ deleted (Recently deleted) → purged ----

export function newUpload(fields: {
  id: string;
  kind: ItemKind;
  contentType: string;
  size: number;
  addedBy: Person;
  createdAt: string;
  stagingKey: string;
  multipartUploadId?: string;
  requestedCaptureDate?: string;
  requestedAlbumId?: string;
}): Item {
  return { ...fields, status: 'uploading', version: 1, tags: [], suppressedAiTags: [] };
}

/** The family member's bytes all arrived; hand the Item to the pipeline. */
export function markUploaded(it: Item): Item | undefined {
  return it.status === 'uploading' ? { ...it, status: 'processing' } : undefined;
}

export function recordVideoJob(it: Item, jobId: string, at: string, capture: CaptureDate | undefined): Item | undefined {
  return it.status === 'processing' && !it.videoJob ? { ...it, capture, videoJob: { jobId, submittedAt: at } } : undefined;
}

export function publish(it: Item, capture: CaptureDate | undefined, media: ItemMedia): Item | undefined {
  return it.status === 'processing' ? { ...it, status: 'ready', capture, media, failureReason: undefined } : undefined;
}

export function fail(it: Item, reason: string): Item | undefined {
  return it.status === 'processing' || it.status === 'uploading' ? { ...it, status: 'failed', failureReason: reason } : undefined;
}

/** The Capture date for a processed file: the file's own, else the one given at upload. */
export function captureFor(it: Item, fromFile: CaptureDate | undefined): CaptureDate | undefined {
  if (fromFile) return fromFile;
  return it.requestedCaptureDate ? { date: it.requestedCaptureDate, source: 'family' } : undefined;
}

/** Family members can see and change only ready Items. */
export function isReady(it: Item): boolean {
  return it.status === 'ready';
}

/** Whether this family member can open it: a failed or processing Item can be; a deleted one only by its uploader. */
export function isVisibleTo(it: Item, viewer: Person): boolean {
  if (it.status === 'uploading') return false;
  return it.status !== 'deleted' || isUploader(it, viewer);
}

export function isUploader(it: Item, person: Person): boolean {
  return it.addedBy.id === person.id;
}

// ---- Recently deleted ----

export const RECENTLY_DELETED_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Only the uploader can delete, and only a ready Item. */
export function canDelete(it: Item, by: Person): boolean {
  return isReady(it) && isUploader(it, by);
}

export function moveToRecentlyDeleted(it: Item, by: Person, at: string): Item {
  requireReady(it);
  if (!isUploader(it, by)) throw new DomainError(403, 'not_yours', 'Only the person who added this can delete it.');
  return { ...it, status: 'deleted', deletedAt: at };
}

/** Back exactly as it was: same Tags, same Albums. */
export function restore(it: Item, by: Person): Item {
  if (it.status !== 'deleted' || !isUploader(it, by)) throw new DomainError(404, 'not_found', 'That item was not found.');
  return { ...it, status: 'ready', deletedAt: undefined };
}

/** The day (UTC) a deleted Item is removed for good. */
export function purgeOn(it: Item): string | undefined {
  return it.deletedAt && new Date(Date.parse(it.deletedAt) + RECENTLY_DELETED_DAYS * DAY_MS).toISOString().slice(0, 10);
}

export function isPurgeDue(it: Item, now: Date): boolean {
  return it.status === 'deleted' && !!it.deletedAt && now.getTime() >= Date.parse(it.deletedAt) + RECENTLY_DELETED_DAYS * DAY_MS;
}

/** Every stored file of the Item, for removing it for good. */
export function mediaKeys(it: Item): string[] {
  const m = it.media;
  return m ? [m.thumbKey, m.displayKey, m.videoKey, m.posterKey].filter((k): k is string => !!k) : [];
}

export function canSetCaptureDate(it: Item): boolean {
  return isReady(it) && !it.capture;
}

export function setCaptureDate(it: Item, date: string): Item {
  requireReady(it);
  if (it.capture) throw new DomainError(409, 'already_dated', 'This item already has a date.');
  return { ...it, capture: { date, source: 'family' } };
}

// ---- where an Item shows up ----

export type Placement = { list: 'timeline' | 'undated' | 'deleted'; sortKey: string };

/** Timeline for dated ready Items, Undated for undated ones, Recently deleted for deleted ones, nowhere otherwise. */
export function placement(it: Item): Placement | undefined {
  if (it.status === 'deleted') return { list: 'deleted', sortKey: `${it.deletedAt}#${it.id}` };
  if (!isReady(it)) return undefined;
  if (it.capture) return { list: 'timeline', sortKey: timelineSortKey(it)! };
  return { list: 'undated', sortKey: `${it.createdAt}#${it.id}` };
}

/** Sort key on the Timeline: local date-time, then id. */
export function timelineSortKey(it: Pick<Item, 'id' | 'capture'>): string | undefined {
  if (!it.capture) return undefined;
  return `${it.capture.date}T${it.capture.time ?? '00:00:00'}#${it.id}`;
}

/** Dated Items newest first, then Undated Items newest added first. */
export function compareForDisplay(a: Item, b: Item): number {
  const ka = timelineSortKey(a);
  const kb = timelineSortKey(b);
  if (ka && kb) return kb.localeCompare(ka);
  if (ka) return -1;
  if (kb) return 1;
  return b.createdAt.localeCompare(a.createdAt);
}

// ---- Tags ----

/** A Tag as typed: tidied label for display, lowercase key for matching. */
export function parseTag(raw: unknown): { key: string; label: string } {
  if (typeof raw !== 'string') throw new DomainError(400, 'invalid_tag', 'A tag must be text.');
  const label = raw.normalize('NFKC').trim().replace(/\s+/g, ' ');
  const key = label.toLowerCase();
  if (!key) throw new DomainError(400, 'invalid_tag', 'A tag cannot be empty.');
  if (key.includes(',')) throw new DomainError(400, 'invalid_tag', 'A tag cannot contain a comma.');
  if (key.length > MAX_TAG_LENGTH) {
    throw new DomainError(400, 'invalid_tag', `A tag can be at most ${MAX_TAG_LENGTH} characters.`);
  }
  return { key, label };
}

export function hasTags(it: Item, keys: string[]): boolean {
  return keys.every((k) => it.tags.some((t) => t.key === k));
}

export function addFamilyTag(it: Item, tag: { key: string; label: string }, by: Person): Item | undefined {
  requireReady(it);
  if (it.tags.some((t) => t.key === tag.key)) return undefined;
  return { ...it, tags: [...it.tags, { ...tag, source: 'family', addedBy: by }] };
}

/** Removing an AI tag also stops AI tagging from ever adding it back. */
export function removeTag(it: Item, key: string): Item {
  const tag = it.tags.find((t) => t.key === key);
  if (!tag) throw new DomainError(404, 'tag_not_found', 'That tag is not on this item.');
  const suppressed =
    tag.source === 'ai' && !it.suppressedAiTags.includes(key) ? [...it.suppressedAiTags, key] : it.suppressedAiTags;
  return { ...it, tags: it.tags.filter((t) => t.key !== key), suppressedAiTags: suppressed };
}

/** Only ready photos that were never AI tagged get AI tags. */
export function needsAiTags(it: Item): boolean {
  return it.kind === 'photo' && isReady(it) && !it.aiTagging && !!it.media?.displayKey;
}

/**
 * Merge what the tagger proposed: short, unique, at most MAX_AI_TAGS, never one a
 * family member removed or already added. Runs once per Item.
 */
export function applyAiTags(it: Item, proposed: unknown, model: string, at: string): Item | undefined {
  if (it.aiTagging) return undefined;
  const present = new Set(it.tags.map((t) => t.key));
  const added: Item['tags'] = [];
  for (const value of Array.isArray(proposed) ? proposed : []) {
    if (added.length >= MAX_AI_TAGS) break;
    let key: string;
    try {
      key = parseTag(value).key;
    } catch {
      continue; // drop anything that isn't a short phrase
    }
    if (present.has(key) || it.suppressedAiTags.includes(key)) continue;
    present.add(key);
    added.push({ key, label: key, source: 'ai', model });
  }
  return { ...it, tags: [...it.tags, ...added], aiTagging: { model, at } };
}

function requireReady(it: Item): void {
  if (!isReady(it)) throw new DomainError(409, 'not_ready', 'This item is still being processed.');
}
