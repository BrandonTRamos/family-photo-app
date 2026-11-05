// The Item module: every rule about how an Item changes and where it shows up.
// Operations are pure: each returns the next Item, or undefined when nothing changes.
// That makes them safe inside Repository.updateItem, which re-runs them on a write conflict.
// Errors are DomainErrors thrown before anything is written.
import { DomainError, type CaptureDate, type Item, type ItemKind, type ItemMedia, type Person } from './domain.js';

export const MAX_TAG_LENGTH = 40;
export const MAX_AI_TAGS = 12;

// ---- lifecycle: uploading → processing → ready | failed ----

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

/** Visible to family members at all (a failed or processing Item can still be opened). */
export function isVisible(it: Item): boolean {
  return it.status !== 'uploading';
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

export type Placement = { list: 'timeline' | 'undated'; sortKey: string };

/** Timeline for dated ready Items, Undated for undated ones, nowhere otherwise. */
export function placement(it: Item): Placement | undefined {
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
