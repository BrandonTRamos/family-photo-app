// Production adapters. Thin translations to AWS SDK calls; behavior lives in the core.
import {
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import type { AiTagger, BlobStore, Queue, UploadGrant } from '../ports.js';
import { MAX_AI_TAGS } from '../item.js';

const UPLOAD_URL_TTL = 6 * 3600;

export class S3BlobStore implements BlobStore {
  constructor(
    private readonly s3: S3Client,
    private readonly bucket: string,
    private readonly opts: { multipartThreshold: number; partSize: number } = {
      multipartThreshold: 32 * 1024 * 1024,
      partSize: 16 * 1024 * 1024,
    },
  ) {}

  async createUploadGrant(key: string, contentType: string, size: number): Promise<UploadGrant> {
    if (size <= this.opts.multipartThreshold) {
      const url = await getSignedUrl(
        this.s3,
        new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType, ContentLength: size }),
        { expiresIn: UPLOAD_URL_TTL, signableHeaders: new Set(['content-type', 'content-length']) },
      );
      return { mode: 'single', url, headers: { 'content-type': contentType } };
    }
    const created = await this.s3.send(
      new CreateMultipartUploadCommand({ Bucket: this.bucket, Key: key, ContentType: contentType }),
    );
    const uploadId = created.UploadId!;
    const count = Math.ceil(size / this.opts.partSize);
    const parts = await Promise.all(
      Array.from({ length: count }, async (_, i) => ({
        partNumber: i + 1,
        url: await getSignedUrl(
          this.s3,
          new UploadPartCommand({ Bucket: this.bucket, Key: key, UploadId: uploadId, PartNumber: i + 1 }),
          { expiresIn: UPLOAD_URL_TTL },
        ),
      })),
    );
    return { mode: 'multipart', uploadId, partSize: this.opts.partSize, parts };
  }

  async completeMultipart(key: string, uploadId: string, parts: { partNumber: number; etag: string }[]): Promise<void> {
    await this.s3.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: {
          Parts: [...parts].sort((a, b) => a.partNumber - b.partNumber).map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })),
        },
      }),
    );
  }

  async head(key: string): Promise<{ size: number } | undefined> {
    try {
      const res = await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { size: res.ContentLength ?? 0 };
    } catch (err) {
      const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (status === 404 || (err as Error).name === 'NotFound') return undefined;
      throw err;
    }
  }

  async read(key: string): Promise<Buffer> {
    const res = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return Buffer.from(await res.Body!.transformToByteArray());
  }

  async readRange(key: string, start: number, endInclusive: number): Promise<Buffer> {
    const res = await this.s3.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key, Range: `bytes=${start}-${endInclusive}` }),
    );
    return Buffer.from(await res.Body!.transformToByteArray());
  }

  async write(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.s3.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType, CacheControl: 'private, max-age=31536000, immutable' }),
    );
  }

  async delete(key: string): Promise<void> {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  signedGetUrl(key: string, expiresInSeconds: number): Promise<string> {
    return getSignedUrl(this.s3, new GetObjectCommand({ Bucket: this.bucket, Key: key }), { expiresIn: expiresInSeconds });
  }
}

export class SqsQueue<M> implements Queue<M> {
  constructor(
    private readonly sqs: SQSClient,
    private readonly url: string,
  ) {}

  async send(message: M): Promise<void> {
    await this.sqs.send(new SendMessageCommand({ QueueUrl: this.url, MessageBody: JSON.stringify(message) }));
  }
}

const TAGGING_SYSTEM_PROMPT = [
  'You tag family photos so relatives can search for them.',
  'Reply with JSON only, exactly like {"tags":["beach","beach umbrella","sunny day"]}.',
  `Give the ${MAX_AI_TAGS} best different short lowercase tags (1 to 3 words each), most important first, for what is actually visible:`,
  'objects, animals, places, settings, activities, events, weather and seasons.',
  'Never name or guess who anyone is. Never guess names, ages, family relationships, ethnicity, religion, health or other personal traits.',
  'For people use only generic words such as "person", "child", "baby" or "group".',
  `Never repeat a tag. Stop after ${MAX_AI_TAGS} tags.`,
].join(' ');

export class BedrockTagger implements AiTagger {
  constructor(
    private readonly client: BedrockRuntimeClient,
    private readonly modelId: string,
  ) {}

  async tag(image: Buffer, contentType: string): Promise<{ tags: string[]; model: string }> {
    const format = contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : 'jpeg';
    const res = await this.client.send(
      new ConverseCommand({
        modelId: this.modelId,
        system: [{ text: TAGGING_SYSTEM_PROMPT }],
        messages: [{ role: 'user', content: [{ image: { format, source: { bytes: image } } }, { text: 'Tag this photo.' }] }],
        inferenceConfig: { maxTokens: 100, temperature: 0.4 }, // 6 short tags fit easily; a loop stops sooner
      }),
    );
    const text = (res.output?.message?.content ?? []).map((c) => ('text' in c ? c.text : '')).join('');
    return { tags: parseTagJson(text), model: this.modelId };
  }
}

/**
 * Pulls the tag list out of the model's reply: {"tags":[...]}, or a bare list, even inside prose or a code fence.
 * Throws when there is none, so the photo is retried (and the reply logged) instead of being marked tagged.
 */
export function parseTagJson(text: string): string[] {
  const candidates = [/\{[\s\S]*\}/.exec(text)?.[0], /\[[\s\S]*\]/.exec(text)?.[0]];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const parsed = JSON.parse(candidate) as unknown;
      const list = Array.isArray(parsed) ? parsed : (parsed as { tags?: unknown })?.tags;
      const tags = Array.isArray(list) ? list.filter((t): t is string => typeof t === 'string' && t.trim() !== '') : [];
      if (tags.length) return tags;
    } catch {
      // try the next shape
    }
  }
  // A reply cut off by the length limit (the model can loop on one word): keep each complete tag before the cut.
  const open = text.indexOf('[');
  if (open >= 0) {
    const tags = [...text.slice(open).matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => JSON.parse(m[0]) as string).filter((t) => t.trim() !== '');
    if (tags.length) return tags;
  }
  throw new Error(`AI model reply had no tags: ${JSON.stringify(text.slice(0, 500))}`);
}
