// Sends chosen files to the Archive: asks for upload grants, sends the bytes straight to storage, then confirms.
// A file that failed is retried on the same Item while its grant is still valid, so a retry never leaves a
// half-made upload behind.
import type { UploadGrantDto } from '../core/api-types';
import type { ApiClient } from './api';

export interface UploadFile {
  /** Stable per chosen file, so a retry finds the earlier attempt. */
  key: string;
  file: File;
  captureDate?: string;
}

export type UploadOutcome = { key: string; ok: true; itemId: string } | { key: string; ok: false; message: string; itemId?: string };

/** Grants are signed for 6 hours; past 5, ask for a new one rather than risk it expiring mid-send. */
const GRANT_REUSE_MS = 5 * 60 * 60 * 1000;

export class UploadSession {
  private readonly started = new Map<string, { itemId: string; grant: UploadGrantDto; at: number }>();

  constructor(
    private readonly api: ApiClient,
    private readonly now: () => number = Date.now,
  ) {}

  async send(files: UploadFile[], albumId: string | undefined, onProgress: (key: string, fraction: number) => void): Promise<UploadOutcome[]> {
    const rejected = new Map<string, string>();
    const needGrant = files.filter((f) => {
      const s = this.started.get(f.key);
      return !s || this.now() - s.at >= GRANT_REUSE_MS;
    });
    if (needGrant.length) {
      const res = await this.api.requestUploads({
        files: needGrant.map((f) => ({ name: f.file.name, type: f.file.type, size: f.file.size, captureDate: f.captureDate })),
        albumId,
      });
      res.results.forEach((r, i) => {
        const key = needGrant[i].key;
        if (r.ok) this.started.set(key, { itemId: r.itemId, grant: r.grant, at: this.now() });
        else rejected.set(key, r.message);
      });
    }
    return Promise.all(
      files.map(async (f): Promise<UploadOutcome> => {
        const message = rejected.get(f.key);
        if (message !== undefined) return { key: f.key, ok: false, message };
        const { itemId, grant } = this.started.get(f.key)!;
        try {
          const parts = await this.api.sendFile(grant, f.file, (p) => onProgress(f.key, p));
          await this.api.completeUpload(itemId, parts);
          this.started.delete(f.key);
          return { key: f.key, ok: true, itemId };
        } catch (err) {
          return { key: f.key, ok: false, message: (err as Error).message, itemId };
        }
      }),
    );
  }
}
