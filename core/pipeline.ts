// Background workers: processing (photos, videos) and photo AI tagging. Every step is safe to repeat.
import { createHash } from 'node:crypto';
import { MAX_AI_TAGS, parseTagInput, type CaptureDate, type Item, type ItemMedia } from './domain.js';
import type { Deps, ProcessingMessage, VideoOutputs } from './ports.js';

export class Pipeline {
  constructor(private readonly d: Deps) {}

  async handle(msg: ProcessingMessage): Promise<void> {
    if (msg.kind === 'ingest') return this.ingest(msg.itemId);
    return this.videoEvent(msg);
  }

  async ingest(itemId: string): Promise<void> {
    const item = await this.d.repo.getItem(itemId);
    if (!item) return;
    if (item.status === 'ready') return this.afterPublish(item); // a retry after a partial run
    if (item.status !== 'processing') return;
    if (item.kind === 'photo') return this.ingestPhoto(item);
    return this.ingestVideo(item);
  }

  private async ingestPhoto(item: Item): Promise<void> {
    if (!(await this.d.staging.head(item.stagingKey))) return this.fail(item, 'The uploaded file is missing.');
    const bytes = await this.d.staging.read(item.stagingKey);
    const fileDate = await this.d.metadata.photoCapture(bytes);

    let processed;
    try {
      processed = await this.d.images.process(bytes);
    } catch {
      return this.fail(item, 'This file could not be opened as a photo.');
    }
    const thumbKey = `items/${item.id}/thumb.jpg`;
    const displayKey = `items/${item.id}/display.jpg`;
    await this.writeVerified(displayKey, processed.display.bytes);
    await this.writeVerified(thumbKey, processed.thumb.bytes);
    if (processed.display.width <= 0 || processed.display.height <= 0) {
      return this.fail(item, 'This photo has no visible size.');
    }

    await this.publish(item.id, this.captureFor(item, fileDate), {
      thumbKey,
      displayKey,
      width: processed.display.width,
      height: processed.display.height,
      checksums: { [thumbKey]: sha256(processed.thumb.bytes), [displayKey]: sha256(processed.display.bytes) },
    });
  }

  private async ingestVideo(item: Item): Promise<void> {
    if (item.videoJob) return this.reconcileVideo(item);
    const head = await this.d.staging.head(item.stagingKey);
    if (!head) return this.fail(item, 'The uploaded file is missing.');
    const fileDate = await this.d.metadata
      .videoCapture((s, e) => this.d.staging.readRange(item.stagingKey, s, e), head.size)
      .catch(() => undefined);
    const { jobId } = await this.d.transcoder.submit({
      itemId: item.id,
      inputKey: item.stagingKey,
      outputPrefix: `items/${item.id}/video/`,
    });
    const capture = this.captureFor(item, fileDate);
    await this.d.repo.updateItem(item.id, (it) =>
      it.status === 'processing' && !it.videoJob
        ? { ...it, capture, videoJob: { jobId, submittedAt: this.d.clock.now().toISOString() } }
        : undefined,
    );
  }

  /** A redelivered ingest for a video already submitted: ask MediaConvert where it stands. */
  private async reconcileVideo(item: Item): Promise<void> {
    const job = await this.d.transcoder.getJob(item.videoJob!.jobId);
    if (job.status === 'COMPLETE') return this.completeVideo(item, job.outputs);
    if (job.status === 'ERROR' || job.status === 'CANCELED') return this.fail(item, 'The video could not be converted.');
  }

  private async videoEvent(msg: Extract<ProcessingMessage, { kind: 'video' }>): Promise<void> {
    const item = await this.d.repo.getItem(msg.itemId);
    if (!item || item.kind !== 'video') return;
    if (item.status === 'ready') return this.afterPublish(item);
    if (item.status !== 'processing') return;
    // The job id is saved just after submitting; a very fast event can beat it, so retry later.
    if (!item.videoJob) throw new Error(`Video job for ${item.id} not recorded yet`);
    if (item.videoJob.jobId !== msg.jobId) return;
    if (msg.status === 'COMPLETE') return this.completeVideo(item, msg.outputs);
    if (msg.status === 'ERROR' || msg.status === 'CANCELED') return this.fail(item, 'The video could not be converted.');
  }

  private async completeVideo(item: Item, outputs: VideoOutputs | undefined): Promise<void> {
    if (!outputs || !(await this.d.media.head(outputs.videoKey)) || !(await this.d.media.head(outputs.posterKey))) {
      return this.fail(item, 'The converted video is missing.');
    }
    if (!(outputs.durationMs > 0)) return this.fail(item, 'The converted video has no length.');
    let thumb;
    try {
      thumb = (await this.d.images.process(await this.d.media.read(outputs.posterKey))).thumb;
    } catch {
      return this.fail(item, 'The video poster could not be read.');
    }
    const thumbKey = `items/${item.id}/thumb.jpg`;
    await this.writeVerified(thumbKey, thumb.bytes);
    await this.publish(item.id, item.capture, {
      thumbKey,
      videoKey: outputs.videoKey,
      posterKey: outputs.posterKey,
      durationMs: outputs.durationMs,
      checksums: { [thumbKey]: sha256(thumb.bytes) },
    });
  }

  private captureFor(item: Item, fileDate: CaptureDate | undefined): CaptureDate | undefined {
    if (fileDate) return fileDate;
    return item.requestedCaptureDate ? { date: item.requestedCaptureDate, source: 'family' } : undefined;
  }

  private async publish(itemId: string, capture: CaptureDate | undefined, media: ItemMedia): Promise<void> {
    const pending = await this.d.repo.getItem(itemId);
    if (pending?.requestedAlbumId && (await this.d.repo.getAlbum(pending.requestedAlbumId))) {
      await this.d.repo.addToAlbum(pending.requestedAlbumId, itemId, this.d.clock.now().toISOString());
    }
    const published = await this.d.repo.updateItem(itemId, (it) =>
      it.status === 'processing' ? { ...it, status: 'ready', capture, media, failureReason: undefined } : undefined,
    );
    if (published?.status === 'ready') await this.afterPublish(published);
  }

  private async afterPublish(item: Item): Promise<void> {
    if (item.kind === 'photo' && !item.aiTagging) await this.d.taggingQueue.send({ kind: 'tag', itemId: item.id });
    await this.d.staging.delete(item.stagingKey); // only after the outputs were verified
  }

  /** Failed inputs stay in staging for recovery. */
  private async fail(item: Item, reason: string): Promise<void> {
    await this.d.repo.updateItem(item.id, (it) =>
      it.status === 'processing' || it.status === 'uploading' ? { ...it, status: 'failed', failureReason: reason } : undefined,
    );
  }

  private async writeVerified(key: string, bytes: Buffer): Promise<void> {
    await this.d.media.write(key, bytes, 'image/jpeg');
    const head = await this.d.media.head(key);
    if (head?.size !== bytes.length) throw new Error(`Output ${key} did not verify`);
  }

  // ---- photo AI tagging ----

  async tag(itemId: string): Promise<void> {
    const item = await this.d.repo.getItem(itemId);
    if (!item || item.kind !== 'photo' || item.status !== 'ready' || item.aiTagging || !item.media?.displayKey) return;
    const small = await this.d.images.forAi(await this.d.media.read(item.media.displayKey));
    const result = await this.d.tagger.tag(small, 'image/jpeg');
    const proposed = boundTags(result.tags);
    await this.d.repo.updateItem(itemId, (it) => {
      if (it.aiTagging) return undefined;
      const present = new Set(it.tags.map((t) => t.key));
      for (const tag of proposed) {
        if (present.has(tag.key) || it.suppressedAiTags.includes(tag.key)) continue;
        it.tags.push({ key: tag.key, label: tag.label, source: 'ai', model: result.model });
        present.add(tag.key);
      }
      it.aiTagging = { model: result.model, at: this.d.clock.now().toISOString() };
      return it;
    });
  }
}

export function boundTags(raw: unknown): { key: string; label: string }[] {
  if (!Array.isArray(raw)) return [];
  const out: { key: string; label: string }[] = [];
  const seen = new Set<string>();
  for (const value of raw) {
    try {
      const { key } = parseTagInput(value);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ key, label: key });
    } catch {
      // drop anything that isn't a short phrase
    }
    if (out.length >= MAX_AI_TAGS) break;
  }
  return out;
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}
