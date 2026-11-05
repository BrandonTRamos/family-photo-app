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
import { CreateJobCommand, GetJobCommand, MediaConvertClient } from '@aws-sdk/client-mediaconvert';
import type { AiTagger, BlobStore, Queue, TranscodeStatus, UploadGrant, VideoOutputs, VideoTranscoder } from '../ports.js';
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
  `Give 3 to ${MAX_AI_TAGS} short lowercase tags (1 to 3 words each) for what is actually visible:`,
  'objects, animals, places, settings, activities, events, weather and seasons.',
  'Never name or guess who anyone is. Never guess names, ages, family relationships, ethnicity, religion, health or other personal traits.',
  'For people use only generic words such as "person", "child", "baby" or "group".',
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
        inferenceConfig: { maxTokens: 300, temperature: 0.2 },
      }),
    );
    const text = (res.output?.message?.content ?? []).map((c) => ('text' in c ? c.text : '')).join('');
    return { tags: parseTagJson(text), model: this.modelId };
  }
}

export function parseTagJson(text: string): string[] {
  const match = /\{[\s\S]*\}/.exec(text);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[0]) as { tags?: unknown };
    return Array.isArray(parsed.tags) ? parsed.tags.filter((t): t is string => typeof t === 'string') : [];
  } catch {
    return [];
  }
}

export interface MediaConvertConfig {
  roleArn: string;
  stagingBucket: string;
  mediaBucket: string;
  appTag: string;
}

/** One 30 fps H.264 + AAC MP4 (8 Mbps cap) and one poster frame per video. */
export class MediaConvertTranscoder implements VideoTranscoder {
  constructor(
    private readonly client: MediaConvertClient,
    private readonly cfg: MediaConvertConfig,
  ) {}

  async submit(req: { itemId: string; inputKey: string; outputPrefix: string }): Promise<{ jobId: string }> {
    const destination = `s3://${this.cfg.mediaBucket}/${req.outputPrefix}`;
    const res = await this.client.send(
      new CreateJobCommand({
        Role: this.cfg.roleArn,
        ClientRequestToken: `item-${req.itemId}`,
        UserMetadata: { app: this.cfg.appTag, itemId: req.itemId },
        Settings: {
          TimecodeConfig: { Source: 'ZEROBASED' },
          Inputs: [
            {
              FileInput: `s3://${this.cfg.stagingBucket}/${req.inputKey}`,
              TimecodeSource: 'ZEROBASED',
              VideoSelector: { Rotate: 'AUTO' },
              AudioSelectors: { 'Audio Selector 1': { DefaultSelection: 'DEFAULT' } },
            },
          ],
          OutputGroups: [
            {
              Name: 'Video',
              OutputGroupSettings: { Type: 'FILE_GROUP_SETTINGS', FileGroupSettings: { Destination: destination } },
              Outputs: [
                {
                  NameModifier: '-1080p',
                  ContainerSettings: { Container: 'MP4', Mp4Settings: { MoovPlacement: 'PROGRESSIVE_DOWNLOAD' } },
                  VideoDescription: {
                    CodecSettings: {
                      Codec: 'H_264',
                      H264Settings: {
                        RateControlMode: 'QVBR',
                        QvbrSettings: { QvbrQualityLevel: 7 },
                        MaxBitrate: 8_000_000,
                        CodecProfile: 'HIGH',
                        SceneChangeDetect: 'TRANSITION_DETECTION',
                        FramerateControl: 'SPECIFIED',
                        FramerateNumerator: 30,
                        FramerateDenominator: 1,
                        FramerateConversionAlgorithm: 'DUPLICATE_DROP',
                      },
                    },
                  },
                  AudioDescriptions: [
                    {
                      AudioSourceName: 'Audio Selector 1',
                      CodecSettings: {
                        Codec: 'AAC',
                        AacSettings: { Bitrate: 128_000, CodingMode: 'CODING_MODE_2_0', SampleRate: 48_000 },
                      },
                    },
                  ],
                },
              ],
            },
            {
              Name: 'Poster',
              OutputGroupSettings: { Type: 'FILE_GROUP_SETTINGS', FileGroupSettings: { Destination: destination } },
              Outputs: [
                {
                  NameModifier: '-poster',
                  ContainerSettings: { Container: 'RAW' },
                  VideoDescription: {
                    CodecSettings: {
                      Codec: 'FRAME_CAPTURE',
                      FrameCaptureSettings: { FramerateNumerator: 1, FramerateDenominator: 1, MaxCaptures: 1, Quality: 80 },
                    },
                  },
                },
              ],
            },
          ],
        },
      }),
    );
    return { jobId: res.Job!.Id! };
  }

  async getJob(jobId: string): Promise<{ status: TranscodeStatus; outputs?: VideoOutputs; error?: string }> {
    const { Job: job } = await this.client.send(new GetJobCommand({ Id: jobId }));
    const status = (job?.Status ?? 'SUBMITTED') as TranscodeStatus;
    if (status !== 'COMPLETE') return { status, error: job?.ErrorMessage };
    const destination = job?.Settings?.OutputGroups?.[0]?.OutputGroupSettings?.FileGroupSettings?.Destination ?? '';
    const prefix = destination.replace(/^s3:\/\/[^/]+\//, '');
    const input = job?.Settings?.Inputs?.[0]?.FileInput ?? '';
    const base = input.split('/').pop()!.replace(/\.[^.]+$/, '');
    const durationMs = job?.OutputGroupDetails?.[0]?.OutputDetails?.[0]?.DurationInMs ?? 0;
    return {
      status,
      outputs: { videoKey: `${prefix}${base}-1080p.mp4`, posterKey: `${prefix}${base}-poster.0000000.jpg`, durationMs },
    };
  }
}
