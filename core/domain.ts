// Domain model for the Family Archive. Terms follow CONTEXT.md.

export type ItemKind = 'photo' | 'video';

/** uploading: grant issued, bytes not confirmed. processing: in the pipeline. */
export type ItemStatus = 'uploading' | 'processing' | 'ready' | 'failed';

export interface Person {
  id: string;
  name: string;
}

/** An exact Capture date. Time and offset are known only when read from the file. */
export interface CaptureDate {
  date: string; // YYYY-MM-DD, local to where it was taken
  time?: string; // HH:MM:SS local
  offset?: string; // e.g. +02:00
  source: 'file' | 'family';
}

export interface TagRecord {
  key: string; // normalized, used for search
  label: string; // as displayed
  source: 'ai' | 'family';
  addedBy?: Person;
  model?: string;
}

export interface ItemMedia {
  thumbKey: string;
  displayKey?: string;
  videoKey?: string;
  posterKey?: string;
  width?: number;
  height?: number;
  durationMs?: number;
  checksums: Record<string, string>;
}

export interface Item {
  id: string;
  kind: ItemKind;
  status: ItemStatus;
  version: number;
  contentType: string;
  size: number;
  addedBy: Person;
  createdAt: string;
  stagingKey: string;
  multipartUploadId?: string;
  capture?: CaptureDate;
  /** Date a family member gave at upload, used only if the file has none. */
  requestedCaptureDate?: string;
  requestedAlbumId?: string;
  media?: ItemMedia;
  tags: TagRecord[];
  /** AI tag keys a family member removed; never re-added by AI tagging. */
  suppressedAiTags: string[];
  aiTagging?: { model: string; at: string };
  videoJob?: { jobId: string; submittedAt: string };
  failureReason?: string;
}

export interface Album {
  id: string;
  name: string;
  createdBy: Person;
  createdAt: string;
}

export class DomainError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Exact calendar date only (YYYY-MM-DD), not in the future. */
export function parseExactDate(raw: unknown, today: string): string {
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new DomainError(400, 'invalid_date', 'Enter a full date: year, month and day.');
  }
  const [y, m, d] = raw.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d || y < 1800) {
    throw new DomainError(400, 'invalid_date', 'That date does not exist.');
  }
  if (raw > today) throw new DomainError(400, 'invalid_date', 'The date cannot be in the future.');
  return raw;
}
