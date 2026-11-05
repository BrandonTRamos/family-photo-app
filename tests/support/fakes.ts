// Test stand-ins for the services we can't run locally. Real-shaped where it matters.
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import type {
  AiTagger,
  BlobStore,
  Queue,
  TranscodeStatus,
  UploadGrant,
  VideoEvent,
  VideoOutputs,
  VideoTranscoder,
} from '../../core/ports.js';
import { mediaConvertOutputKeys, parseMediaConvertEvent } from '../../core/adapters/mediaconvert.js';

export class MemoryBlobStore implements BlobStore {
  readonly objects = new Map<string, { body: Buffer; contentType: string }>();
  private readonly uploads = new Map<string, { key: string; parts: Map<number, Buffer> }>();
  private nextUpload = 1;
  multipartCompleted = 0;

  constructor(
    readonly name: string,
    private readonly multipartThreshold = 32 * 1024 * 1024,
    private readonly partSize = 8 * 1024 * 1024,
  ) {}

  async createUploadGrant(key: string, contentType: string, size: number): Promise<UploadGrant> {
    if (size <= this.multipartThreshold) {
      return { mode: 'single', url: `memory://${this.name}/${key}`, headers: { 'content-type': contentType } };
    }
    const uploadId = `mpu-${this.nextUpload++}`;
    this.uploads.set(uploadId, { key, parts: new Map() });
    const count = Math.ceil(size / this.partSize);
    return {
      mode: 'multipart',
      uploadId,
      partSize: this.partSize,
      parts: Array.from({ length: count }, (_, i) => ({
        partNumber: i + 1,
        url: `memory://${this.name}/${key}?uploadId=${uploadId}&partNumber=${i + 1}`,
      })),
    };
  }

  async completeMultipart(key: string, uploadId: string, parts: { partNumber: number; etag: string }[]): Promise<void> {
    const upload = this.uploads.get(uploadId);
    if (!upload || upload.key !== key) throw new Error('NoSuchUpload');
    const ordered = [...parts].sort((a, b) => a.partNumber - b.partNumber);
    const chunks = ordered.map((p) => {
      const chunk = upload.parts.get(p.partNumber);
      if (!chunk || etag(chunk) !== p.etag) throw new Error('InvalidPart');
      return chunk;
    });
    this.objects.set(key, { body: Buffer.concat(chunks), contentType: 'application/octet-stream' });
    this.uploads.delete(uploadId);
    this.multipartCompleted++;
  }

  /** What a browser PUT to a grant URL does. Returns the part's ETag. */
  putToUrl(url: string, body: Buffer, contentType = 'application/octet-stream'): string {
    const parsed = new URL(url);
    const key = decodeURIComponent(parsed.pathname.slice(1));
    const uploadId = parsed.searchParams.get('uploadId');
    if (uploadId) {
      const upload = this.uploads.get(uploadId);
      if (!upload) throw new Error('NoSuchUpload');
      upload.parts.set(Number(parsed.searchParams.get('partNumber')), body);
    } else {
      this.objects.set(key, { body, contentType });
    }
    return etag(body);
  }

  async head(key: string) {
    const o = this.objects.get(key);
    return o ? { size: o.body.length } : undefined;
  }

  async read(key: string): Promise<Buffer> {
    const o = this.objects.get(key);
    if (!o) throw new Error(`NoSuchKey ${this.name}/${key}`);
    return o.body;
  }

  async readRange(key: string, start: number, endInclusive: number): Promise<Buffer> {
    return (await this.read(key)).subarray(start, endInclusive + 1);
  }

  async write(key: string, body: Buffer, contentType: string): Promise<void> {
    this.objects.set(key, { body, contentType });
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }

  async signedGetUrl(key: string, expiresInSeconds: number): Promise<string> {
    return `https://${this.name}.test/${key}?expires=${expiresInSeconds}`;
  }
}

function etag(body: Buffer): string {
  return `"${createHash('md5').update(body).digest('hex')}"`;
}

export class MemoryQueue<M> implements Queue<M> {
  readonly bodies: string[] = [];
  async send(message: M): Promise<void> {
    this.bodies.push(JSON.stringify(message));
  }
  sendRaw(body: string): void {
    this.bodies.push(body);
  }
}

export class FakeTagger implements AiTagger {
  calls = 0;
  failuresLeft = 0;
  tags: string[] = ['beach', 'ocean', 'sunny day'];
  readonly model = 'fake-vision-1';

  async tag(): Promise<{ tags: string[]; model: string }> {
    this.calls++;
    if (this.failuresLeft > 0) {
      this.failuresLeft--;
      throw new Error('ThrottlingException');
    }
    return { tags: [...this.tags], model: this.model };
  }
}

interface FakeJob {
  jobId: string;
  itemId: string;
  inputKey: string;
  outputFolder: string;
  status: TranscodeStatus;
  outputs?: VideoOutputs;
}

/** Names outputs and emits EventBridge events exactly like MediaConvert, so the real naming and parser are exercised. */
export class FakeTranscoder implements VideoTranscoder {
  readonly jobs = new Map<string, FakeJob>();
  submitCalls = 0;

  constructor(
    private readonly media: MemoryBlobStore,
    private readonly processing: MemoryQueue<unknown>,
    private readonly mediaBucket = 'media-bucket',
  ) {}

  async submit(req: { itemId: string; inputKey: string; outputFolder: string }) {
    this.submitCalls++;
    const existing = [...this.jobs.values()].find((j) => j.itemId === req.itemId);
    if (existing) return { jobId: existing.jobId };
    const jobId = `job-${this.jobs.size + 1}`;
    this.jobs.set(jobId, { jobId, ...req, status: 'SUBMITTED' });
    return { jobId };
  }

  async getJob(jobId: string) {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error('NotFound');
    return { status: job.status, outputs: job.outputs };
  }

  /** Same events as MediaConvert, so the real parser reads them. */
  parseEvent(event: unknown): VideoEvent | undefined {
    return parseMediaConvertEvent(event);
  }

  /** Simulate MediaConvert finishing: write outputs and emit the completion event. */
  async finish(jobId: string, opts: { durationMs?: number; writeOutputs?: boolean } = {}): Promise<void> {
    const job = this.jobs.get(jobId)!;
    const { videoKey, posterKey } = mediaConvertOutputKeys(job.outputFolder, job.inputKey);
    if (opts.writeOutputs !== false) {
      await this.media.write(videoKey, Buffer.from('mp4-bytes'), 'video/mp4');
      const poster = await sharp({ create: { width: 1280, height: 720, channels: 3, background: '#f2c7a5' } }).jpeg().toBuffer();
      await this.media.write(posterKey, poster, 'image/jpeg');
    }
    job.status = 'COMPLETE';
    job.outputs = { videoKey, posterKey, durationMs: opts.durationMs ?? 45_000 };
    this.processing.sendRaw(JSON.stringify(this.event(job, 'COMPLETE')));
  }

  fail(jobId: string): void {
    const job = this.jobs.get(jobId)!;
    job.status = 'ERROR';
    this.processing.sendRaw(JSON.stringify(this.event(job, 'ERROR')));
  }

  lastCompletionEvent(jobId: string): string {
    return JSON.stringify(this.event(this.jobs.get(jobId)!, 'COMPLETE'));
  }

  private event(job: FakeJob, status: 'COMPLETE' | 'ERROR') {
    const detail: Record<string, unknown> = {
      timestamp: 1793836000000,
      accountId: '123456789012',
      queue: 'arn:aws:mediaconvert:us-east-1:123456789012:queues/Default',
      jobId: job.jobId,
      status,
      userMetadata: { app: 'family-archive', itemId: job.itemId },
    };
    if (status === 'COMPLETE' && job.outputs) {
      detail.outputGroupDetails = [
        {
          outputDetails: [
            {
              outputFilePaths: [`s3://${this.mediaBucket}/${job.outputs.videoKey}`],
              durationInMs: job.outputs.durationMs,
              videoDetails: { widthInPx: 1920, heightInPx: 1080 },
            },
          ],
          type: 'FILE_GROUP',
        },
        {
          outputDetails: [{ outputFilePaths: [`s3://${this.mediaBucket}/${job.outputs.posterKey}`], durationInMs: 0 }],
          type: 'FILE_GROUP',
        },
      ];
    } else {
      detail.errorCode = 1030;
      detail.errorMessage = 'Unsupported codec';
    }
    return {
      version: '0',
      id: `evt-${job.jobId}-${status}`,
      'detail-type': 'MediaConvert Job State Change',
      source: 'aws.mediaconvert',
      account: '123456789012',
      time: '2026-11-05T00:00:00Z',
      region: 'us-east-1',
      resources: [`arn:aws:mediaconvert:us-east-1:123456789012:jobs/${job.jobId}`],
      detail,
    };
  }
}
