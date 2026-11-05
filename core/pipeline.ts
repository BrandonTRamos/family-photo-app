// Background workers: processing (photos, videos) and photo AI tagging. Every step is safe to repeat.
import { createHash } from 'node:crypto';
import type { CaptureDate, Item, ItemMedia } from './domain.js';
import { mediaLayout } from './media-layout.js';
import { applyAiTags, captureFor, fail as failItem, needsAiTags, publish as publishItem, recordVideoJob } from './item.js';
import type { Deps, ProcessingMessage, VideoEvent, VideoOutputs, VideoSize } from './ports.js';

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
    const thumbKey = mediaLayout.thumb(item.id);
    const displayKey = mediaLayout.display(item.id);
    await this.writeVerified(displayKey, processed.display.bytes);
    await this.writeVerified(thumbKey, processed.thumb.bytes);
    if (processed.display.width <= 0 || processed.display.height <= 0) {
      return this.fail(item, 'This photo has no visible size.');
    }

    await this.publish(item.id, captureFor(item, fileDate), {
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
    const info = await this.d.metadata
      .videoInfo((s, e) => this.d.staging.readRange(item.stagingKey, s, e), head.size)
      .catch(() => ({}) as { capture?: CaptureDate; size?: VideoSize });
    const { jobId } = await this.d.transcoder.submit({
      itemId: item.id,
      inputKey: item.stagingKey,
      outputFolder: mediaLayout.videoFolder(item.id),
      size: videoOutputSize(info.size),
    });
    const capture = captureFor(item, info.capture);
    const at = this.d.clock.now().toISOString();
    await this.d.repo.updateItem(item.id, (it) => recordVideoJob(it, jobId, at, capture));
  }

  /** A redelivered ingest for a video already submitted: ask MediaConvert where it stands. */
  private async reconcileVideo(item: Item): Promise<void> {
    const job = await this.d.transcoder.getJob(item.videoJob!.jobId);
    if (job.status === 'COMPLETE') return this.completeVideo(item, job.outputs);
    if (job.status === 'ERROR' || job.status === 'CANCELED') return this.fail(item, 'The video could not be converted.');
  }

  private async videoEvent(msg: VideoEvent): Promise<void> {
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
    const thumbKey = mediaLayout.thumb(item.id);
    await this.writeVerified(thumbKey, thumb.bytes);
    await this.publish(item.id, item.capture, {
      thumbKey,
      videoKey: outputs.videoKey,
      posterKey: outputs.posterKey,
      durationMs: outputs.durationMs,
      checksums: { [thumbKey]: sha256(thumb.bytes) },
    });
  }

  private async publish(itemId: string, capture: CaptureDate | undefined, media: ItemMedia): Promise<void> {
    const pending = await this.d.repo.getItem(itemId);
    if (pending?.requestedAlbumId && (await this.d.repo.getAlbum(pending.requestedAlbumId))) {
      await this.d.repo.addToAlbum(pending.requestedAlbumId, itemId, this.d.clock.now().toISOString());
    }
    const published = await this.d.repo.updateItem(itemId, (it) => publishItem(it, capture, media));
    if (published?.status === 'ready') await this.afterPublish(published);
  }

  private async afterPublish(item: Item): Promise<void> {
    if (needsAiTags(item)) await this.d.taggingQueue.send({ kind: 'tag', itemId: item.id });
    await this.d.staging.delete(item.stagingKey); // only after the outputs were verified
  }

  /** Failed inputs stay in staging for recovery. */
  private async fail(item: Item, reason: string): Promise<void> {
    await this.d.repo.updateItem(item.id, (it) => failItem(it, reason));
  }

  private async writeVerified(key: string, bytes: Uint8Array): Promise<void> {
    await this.d.media.write(key, bytes, 'image/jpeg');
    const head = await this.d.media.head(key);
    if (head?.size !== bytes.length) throw new Error(`Output ${key} did not verify`);
  }

  // ---- photo AI tagging ----

  async tag(itemId: string): Promise<void> {
    const item = await this.d.repo.getItem(itemId);
    if (!item || !needsAiTags(item)) return;
    const small = await this.d.images.forAi(await this.d.media.read(item.media!.displayKey!));
    const result = await this.d.tagger.tag(small, 'image/jpeg');
    const at = this.d.clock.now().toISOString();
    await this.d.repo.updateItem(itemId, (it) => applyAiTags(it, result.tags, result.model, at));
  }
}

/** Videos are kept at most 1080p: the short side scaled down to 1080, never up (undefined = keep the input size). */
export function videoOutputSize(input: VideoSize | undefined): VideoSize | undefined {
  if (!input) return undefined;
  const short = Math.min(input.width, input.height);
  if (short <= MAX_VIDEO_SHORT_SIDE) return undefined;
  const scale = MAX_VIDEO_SHORT_SIDE / short;
  const even = (n: number) => Math.max(2, Math.round((n * scale) / 2) * 2); // H.264 needs even sizes
  return { width: even(input.width), height: even(input.height) };
}

const MAX_VIDEO_SHORT_SIDE = 1080;

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
