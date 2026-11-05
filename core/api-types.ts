// The HTTP API contract, shared by the server and the web client. No runtime dependencies.

export type ItemKindDto = 'photo' | 'video';
export type ItemStatusDto = 'uploading' | 'processing' | 'ready' | 'failed';

export interface CaptureDateDto {
  date: string;
  time?: string;
  source: 'file' | 'family';
}

export interface ItemSummaryDto {
  id: string;
  kind: ItemKindDto;
  thumbUrl: string;
  durationMs?: number;
  capture?: CaptureDateDto;
}

export interface TagDto {
  key: string;
  label: string;
  source: 'ai' | 'family';
  addedBy?: string;
}

export interface ItemDetailDto {
  id: string;
  kind: ItemKindDto;
  status: ItemStatusDto;
  addedBy: string;
  capture?: CaptureDateDto;
  canSetDate: boolean;
  thumbUrl?: string;
  displayUrl?: string;
  videoUrl?: string;
  posterUrl?: string;
  width?: number;
  height?: number;
  durationMs?: number;
  tags: TagDto[];
  albums: { id: string; name: string }[];
  failureReason?: string;
}

export interface TimelineDayDto {
  date: string; // YYYY-MM-DD
  count: number;
  items: ItemSummaryDto[];
}

export interface TimelineMonthDto {
  month: string; // YYYY-MM
  count: number;
  days: TimelineDayDto[];
}

export interface TimelineDto {
  months: TimelineMonthDto[];
  undatedCount: number;
  cursor?: string;
}

export interface UndatedDto {
  count: number;
  items: ItemSummaryDto[];
  cursor?: string;
}

export interface SearchDto {
  tags: string[];
  count: number;
  items: ItemSummaryDto[];
  related: { key: string; label: string }[];
  cursor?: string;
}

export interface AlbumDto {
  id: string;
  name: string;
  count: number;
  coverUrl?: string;
}

export interface AlbumDetailDto {
  album: AlbumDto;
  items: ItemSummaryDto[];
  cursor?: string;
}

export interface UploadFileRequest {
  name: string;
  type: string;
  size: number;
  /** Exact date a family member gave; used only if the file has no date. */
  captureDate?: string;
}

export interface UploadRequest {
  files: UploadFileRequest[];
  albumId?: string;
}

export type UploadGrantDto =
  | { mode: 'single'; url: string; headers: Record<string, string> }
  | { mode: 'multipart'; uploadId: string; partSize: number; parts: { partNumber: number; url: string }[] };

export type UploadResultDto =
  | { ok: true; name: string; itemId: string; grant: UploadGrantDto }
  | { ok: false; name: string; error: 'too_large' | 'unsupported_type' | 'invalid'; message: string };

export interface UploadResponse {
  results: UploadResultDto[];
}

export interface CompleteUploadRequest {
  parts?: { partNumber: number; etag: string }[];
}

export interface ErrorDto {
  error: string;
  message: string;
}

export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'] as const;
export const VIDEO_TYPES = ['video/mp4', 'video/quicktime'] as const;
