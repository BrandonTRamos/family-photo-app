// Drives the system through its one seam: the HTTP API, with the workers running behind it.
import type { AddressInfo } from 'node:net';
import dynalite from 'dynalite';
import { CreateTableCommand, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { SQSEvent } from 'aws-lambda';
import { DynamoRepository, tableSchema } from '../../core/adapters/dynamo-repository.js';
import { MemoryRepository } from '../../core/adapters/memory-repository.js';
import { FileMetadataReader } from '../../core/media/metadata.js';
import { SharpImageProcessor } from '../../core/media/sharp-images.js';
import { makeHttpHandler, makeProcessingHandler, makeTaggingHandler } from '../../core/handlers.js';
import { defaultConfig, type Config, type Deps, type Repository } from '../../core/ports.js';
import { apiEvent, inProcessFetch } from '../../core/adapters/in-process-fetch.js';
import { HttpApiClient } from '../../src/api.js';
import { UploadSession } from '../../src/upload-session.js';
import { FakeTagger, FakeTranscoder, MemoryBlobStore, MemoryQueue } from './fakes.js';

export interface User {
  sub: string;
  name: string;
  groups: string[];
}

export const rosa: User = { sub: 'u-rosa', name: 'Aunt Rosa', groups: ['family'] };
export const dan: User = { sub: 'u-dan', name: 'Uncle Dan', groups: ['family'] };
export const stranger: User = { sub: 'u-stranger', name: 'Stranger', groups: [] };

export interface Response<T = any> {
  status: number;
  body: T;
}

const MAX_RECEIVES = 5;
const API_BASE = 'https://api.test';

export async function createHarness(config: Partial<Config> = {}) {
  const store = process.env.ARCHIVE_REPO === 'memory' ? memoryStore() : await dynamoStore();

  const fullConfig: Config = { ...defaultConfig, multipartThreshold: 64 * 1024, ...config };
  const staging = new MemoryBlobStore('staging', fullConfig.multipartThreshold, 32 * 1024);
  const media = new MemoryBlobStore('media');
  const processingQueue = new MemoryQueue<unknown>();
  const taggingQueue = new MemoryQueue<unknown>();
  const tagger = new FakeTagger();
  const transcoder = new FakeTranscoder(media, processingQueue);
  let now = new Date('2026-11-05T12:00:00Z');
  let idCounter = 0;

  const deps: Deps = {
    repo: store.repo,
    staging,
    media,
    processingQueue,
    taggingQueue,
    tagger,
    transcoder,
    images: new SharpImageProcessor(),
    metadata: new FileMetadataReader(),
    clock: { now: () => now },
    ids: { next: () => `id${String(++idCounter).padStart(4, '0')}` },
    config: fullConfig,
  };

  const http = makeHttpHandler(deps);
  const processing = makeProcessingHandler(deps);
  const tagging = makeTaggingHandler(deps);
  const deadLetters: { queue: string; body: string }[] = [];

  async function request<T = any>(user: User | undefined, method: string, path: string, body?: unknown): Promise<Response<T>> {
    const event = apiEvent(method, path, body === undefined ? undefined : JSON.stringify(body), user);
    const res = (await http(event, {} as never, () => undefined)) as { statusCode: number; body?: string };
    return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : undefined };
  }

  /** Storage PUTs that fail before succeeding, like a flaky connection. */
  let failingStorageSends = 0;

  /** The web client as a family member's browser runs it, talking to this backend in-process. */
  function client(user: User): HttpApiClient {
    const fetch = inProcessFetch({
      apiBase: API_BASE,
      api: http,
      caller: (token) => (token === user.sub ? user : undefined),
      store: (url, bytes, contentType) => {
        if (failingStorageSends > 0) {
          failingStorageSends--;
          throw new Error('connection reset');
        }
        return staging.putToUrl(url, Buffer.from(bytes), contentType);
      },
    });
    return new HttpApiClient(API_BASE, async () => user.sub, { fetch, retryDelayMs: 0 });
  }

  type UploadInput = { name: string; type: string; bytes: Buffer; captureDate?: string };
  const asFiles = (files: UploadInput[]) =>
    files.map((f, i) => ({ key: String(i), file: new File([f.bytes], f.name, { type: f.type }), captureDate: f.captureDate }));

  /** An Upload screen session: sending the same files again retries them. */
  function uploader(user: User) {
    const session = new UploadSession(client(user));
    return { send: (files: UploadInput[], albumId?: string) => session.send(asFiles(files), albumId, () => {}) };
  }

  /** Runs both queues until empty, retrying failures like SQS and parking poison messages. */
  async function drain(): Promise<void> {
    const receives = new Map<string, number>();
    for (let round = 0; round < 200; round++) {
      const queue = processingQueue.bodies.length ? 'processing' : taggingQueue.bodies.length ? 'tagging' : undefined;
      if (!queue) return;
      const source = queue === 'processing' ? processingQueue : taggingQueue;
      const body = source.bodies.shift()!;
      const count = (receives.get(body) ?? 0) + 1;
      receives.set(body, count);
      const event = { Records: [{ messageId: `m${round}`, body }] } as unknown as SQSEvent;
      const handler = queue === 'processing' ? processing : tagging;
      const result = await handler(event, {} as never, () => undefined);
      const failed = (result as { batchItemFailures: unknown[] } | undefined)?.batchItemFailures.length;
      if (failed) {
        if (count >= MAX_RECEIVES) deadLetters.push({ queue, body });
        else source.bodies.push(body);
      }
    }
    throw new Error('Queues did not drain');
  }

  async function upload(user: User, files: UploadInput[], albumId?: string) {
    const outcomes = await uploader(user).send(files, albumId);
    const failed = outcomes.find((o) => !o.ok);
    if (failed) throw new Error(`upload failed: ${JSON.stringify(failed)}`);
    return { ids: outcomes.map((o) => (o.ok ? o.itemId : '')) };
  }

  return {
    deps,
    staging,
    media,
    tagger,
    transcoder,
    processingQueue,
    taggingQueue,
    deadLetters,
    request,
    get: <T = any>(user: User | undefined, path: string) => request<T>(user, 'GET', path),
    post: <T = any>(user: User, path: string, body?: unknown) => request<T>(user, 'POST', path, body ?? {}),
    put: <T = any>(user: User, path: string, body?: unknown) => request<T>(user, 'PUT', path, body ?? {}),
    del: <T = any>(user: User, path: string) => request<T>(user, 'DELETE', path),
    drain,
    upload,
    uploader,
    failStorageSends(n: number) {
      failingStorageSends = n;
    },
    setNow(iso: string) {
      now = new Date(iso);
    },
    close: store.close,
  };
}

/** The Repository the suite runs against: DynamoDB (dynalite) by default, or memory with ARCHIVE_REPO=memory. */
function memoryStore(): { repo: Repository; close: () => Promise<void> } {
  return { repo: new MemoryRepository(), close: async () => {} };
}

async function dynamoStore(): Promise<{ repo: Repository; close: () => Promise<void> }> {
  const server = dynalite({ createTableMs: 0, deleteTableMs: 0, updateTableMs: 0 });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as AddressInfo).port;
  const client = new DynamoDBClient({
    endpoint: `http://127.0.0.1:${port}`,
    region: 'local',
    credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
  });
  const table = 'family-archive-test';
  await client.send(
    new CreateTableCommand({
      TableName: table,
      BillingMode: 'PAY_PER_REQUEST',
      AttributeDefinitions: [
        { AttributeName: tableSchema.partitionKey, AttributeType: 'S' },
        { AttributeName: tableSchema.sortKey, AttributeType: 'S' },
        { AttributeName: tableSchema.gsi1.partitionKey, AttributeType: 'S' },
        { AttributeName: tableSchema.gsi1.sortKey, AttributeType: 'S' },
      ],
      KeySchema: [
        { AttributeName: tableSchema.partitionKey, KeyType: 'HASH' },
        { AttributeName: tableSchema.sortKey, KeyType: 'RANGE' },
      ],
      GlobalSecondaryIndexes: [
        {
          IndexName: tableSchema.gsi1.name,
          KeySchema: [
            { AttributeName: tableSchema.gsi1.partitionKey, KeyType: 'HASH' },
            { AttributeName: tableSchema.gsi1.sortKey, KeyType: 'RANGE' },
          ],
          Projection: { ProjectionType: 'ALL' },
        },
      ],
    }),
  );
  return {
    repo: new DynamoRepository(DynamoDBDocumentClient.from(client, { marshallOptions: { removeUndefinedValues: true } }), table),
    async close() {
      client.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

export type Harness = Awaited<ReturnType<typeof createHarness>>;
