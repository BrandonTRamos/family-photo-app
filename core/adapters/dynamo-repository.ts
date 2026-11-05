import {
  BatchGetCommand,
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  type QueryCommandInput,
} from '@aws-sdk/lib-dynamodb';
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import type { Album, Item } from '../domain.js';
import { placement } from '../item.js';
import type { Page, Repository } from '../ports.js';

/**
 * Single-table layout:
 *   ITEM#id   / ITEM        the item (gsi1: TL by Capture date, or UNDATED by created time)
 *   ITEM#id   / ALBUM#aid   reverse Album membership
 *   TAG#key   / ITEM#id     tag index (verified against the item on read)
 *   ALBUM#aid / ALBUM       the Album (gsi1: ALBUMS)
 *   ALBUM#aid / ITEM#id     Album membership
 * Counts are key-only COUNT queries, so there are no counters to drift.
 */
export class DynamoRepository implements Repository {
  constructor(
    private readonly doc: DynamoDBDocumentClient,
    private readonly table: string,
  ) {}

  async createItem(item: Item): Promise<void> {
    await this.doc.send(
      new PutCommand({
        TableName: this.table,
        Item: this.itemRow(item),
        ConditionExpression: 'attribute_not_exists(pk)',
      }),
    );
  }

  async getItem(id: string): Promise<Item | undefined> {
    const res = await this.doc.send(new GetCommand({ TableName: this.table, Key: { pk: `ITEM#${id}`, sk: 'ITEM' } }));
    return res.Item?.data as Item | undefined;
  }

  async getItems(ids: string[]): Promise<Item[]> {
    const unique = [...new Set(ids)];
    const found = new Map<string, Item>();
    for (let i = 0; i < unique.length; i += 100) {
      let keys: Record<string, unknown>[] | undefined = unique.slice(i, i + 100).map((id) => ({ pk: `ITEM#${id}`, sk: 'ITEM' }));
      for (let attempt = 0; keys && keys.length && attempt < 8; attempt++) {
        const res = await this.doc.send(new BatchGetCommand({ RequestItems: { [this.table]: { Keys: keys } } }));
        for (const row of res.Responses?.[this.table] ?? []) {
          const item = row.data as Item;
          found.set(item.id, item);
        }
        keys = res.UnprocessedKeys?.[this.table]?.Keys as Record<string, unknown>[] | undefined;
      }
    }
    return unique.map((id) => found.get(id)).filter((x): x is Item => x !== undefined);
  }

  async updateItem(id: string, mutate: (item: Item) => Item | undefined): Promise<Item | undefined> {
    for (let attempt = 0; attempt < 6; attempt++) {
      const current = await this.getItem(id);
      if (!current) return undefined;
      const next = mutate(structuredClone(current));
      if (!next) return current;
      const stored: Item = { ...next, version: current.version + 1 };
      const before = new Set(current.tags.map((t) => t.key));
      const after = new Set(stored.tags.map((t) => t.key));
      for (const key of after) if (!before.has(key)) await this.putTagRow(key, id);
      try {
        await this.doc.send(
          new PutCommand({
            TableName: this.table,
            Item: this.itemRow(stored),
            ConditionExpression: 'version = :v',
            ExpressionAttributeValues: { ':v': current.version },
          }),
        );
      } catch (err) {
        if (err instanceof ConditionalCheckFailedException) continue;
        throw err;
      }
      for (const key of before) if (!after.has(key)) await this.deleteRow(`TAG#${key}`, `ITEM#${id}`);
      return stored;
    }
    throw new Error(`Item ${id} kept changing; update abandoned`);
  }

  async timeline(opts: { limit: number; cursor?: string; year?: number }): Promise<Page<Item>> {
    const before = opts.year === undefined ? undefined : String(opts.year + 1); // sort keys start with the date
    const input: QueryCommandInput = {
      TableName: this.table,
      IndexName: 'gsi1',
      KeyConditionExpression: before ? 'gsi1pk = :p AND gsi1sk < :b' : 'gsi1pk = :p',
      ExpressionAttributeValues: before ? { ':p': 'TL', ':b': before } : { ':p': 'TL' },
      ScanIndexForward: false,
      Limit: opts.limit,
      ExclusiveStartKey: decodeCursor(opts.cursor),
    };
    const res = await this.doc.send(new QueryCommand(input));
    return { items: (res.Items ?? []).map((r) => r.data as Item), cursor: encodeCursor(res.LastEvaluatedKey) };
  }

  countTimeline(datePrefix: string): Promise<number> {
    return this.count({
      IndexName: 'gsi1',
      KeyConditionExpression: 'gsi1pk = :p AND begins_with(gsi1sk, :s)',
      ExpressionAttributeValues: { ':p': 'TL', ':s': datePrefix },
    });
  }

  async undated(opts: { limit: number; cursor?: string }): Promise<Page<Item>> {
    const res = await this.doc.send(
      new QueryCommand({
        TableName: this.table,
        IndexName: 'gsi1',
        KeyConditionExpression: 'gsi1pk = :p',
        ExpressionAttributeValues: { ':p': 'UNDATED' },
        ScanIndexForward: false,
        Limit: opts.limit,
        ExclusiveStartKey: decodeCursor(opts.cursor),
      }),
    );
    return { items: (res.Items ?? []).map((r) => r.data as Item), cursor: encodeCursor(res.LastEvaluatedKey) };
  }

  countUndated(): Promise<number> {
    return this.count({
      IndexName: 'gsi1',
      KeyConditionExpression: 'gsi1pk = :p',
      ExpressionAttributeValues: { ':p': 'UNDATED' },
    });
  }

  itemIdsWithTag(tagKey: string): Promise<string[]> {
    return this.queryAllSortKeys(`TAG#${tagKey}`, 'ITEM#');
  }

  async createAlbum(album: Album): Promise<void> {
    await this.doc.send(
      new PutCommand({
        TableName: this.table,
        Item: { pk: `ALBUM#${album.id}`, sk: 'ALBUM', gsi1pk: 'ALBUMS', gsi1sk: `${album.createdAt}#${album.id}`, data: album },
        ConditionExpression: 'attribute_not_exists(pk)',
      }),
    );
  }

  async getAlbum(id: string): Promise<Album | undefined> {
    const res = await this.doc.send(new GetCommand({ TableName: this.table, Key: { pk: `ALBUM#${id}`, sk: 'ALBUM' } }));
    return res.Item?.data as Album | undefined;
  }

  async listAlbums(): Promise<Album[]> {
    const albums: Album[] = [];
    let cursor: Record<string, unknown> | undefined;
    do {
      const res = await this.doc.send(
        new QueryCommand({
          TableName: this.table,
          IndexName: 'gsi1',
          KeyConditionExpression: 'gsi1pk = :p',
          ExpressionAttributeValues: { ':p': 'ALBUMS' },
          ScanIndexForward: false,
          ExclusiveStartKey: cursor,
        }),
      );
      albums.push(...(res.Items ?? []).map((r) => r.data as Album));
      cursor = res.LastEvaluatedKey;
    } while (cursor);
    return albums;
  }

  async deleteAlbum(id: string): Promise<void> {
    const itemIds = await this.albumItemIds(id);
    for (const itemId of itemIds) await this.removeFromAlbum(id, itemId);
    await this.deleteRow(`ALBUM#${id}`, 'ALBUM');
  }

  async addToAlbum(albumId: string, itemId: string, at: string): Promise<void> {
    await this.doc.send(new PutCommand({ TableName: this.table, Item: { pk: `ALBUM#${albumId}`, sk: `ITEM#${itemId}`, at } }));
    await this.doc.send(new PutCommand({ TableName: this.table, Item: { pk: `ITEM#${itemId}`, sk: `ALBUM#${albumId}`, at } }));
  }

  async removeFromAlbum(albumId: string, itemId: string): Promise<void> {
    await this.deleteRow(`ALBUM#${albumId}`, `ITEM#${itemId}`);
    await this.deleteRow(`ITEM#${itemId}`, `ALBUM#${albumId}`);
  }

  albumItemIds(albumId: string): Promise<string[]> {
    return this.queryAllSortKeys(`ALBUM#${albumId}`, 'ITEM#');
  }

  albumIdsForItem(itemId: string): Promise<string[]> {
    return this.queryAllSortKeys(`ITEM#${itemId}`, 'ALBUM#');
  }

  private itemRow(item: Item): Record<string, unknown> {
    const row: Record<string, unknown> = { pk: `ITEM#${item.id}`, sk: 'ITEM', version: item.version, data: item };
    const where = placement(item);
    if (where) {
      row.gsi1pk = where.list === 'timeline' ? 'TL' : 'UNDATED';
      row.gsi1sk = where.sortKey;
    }
    return stripUndefined(row);
  }

  private async putTagRow(key: string, itemId: string): Promise<void> {
    await this.doc.send(new PutCommand({ TableName: this.table, Item: { pk: `TAG#${key}`, sk: `ITEM#${itemId}` } }));
  }

  private async deleteRow(pk: string, sk: string): Promise<void> {
    await this.doc.send(new DeleteCommand({ TableName: this.table, Key: { pk, sk } }));
  }

  private async queryAllSortKeys(pk: string, prefix: string): Promise<string[]> {
    const out: string[] = [];
    let cursor: Record<string, unknown> | undefined;
    do {
      const res = await this.doc.send(
        new QueryCommand({
          TableName: this.table,
          KeyConditionExpression: 'pk = :p AND begins_with(sk, :s)',
          ExpressionAttributeValues: { ':p': pk, ':s': prefix },
          ProjectionExpression: 'sk',
          ExclusiveStartKey: cursor,
        }),
      );
      for (const row of res.Items ?? []) out.push(String(row.sk).slice(prefix.length));
      cursor = res.LastEvaluatedKey;
    } while (cursor);
    return out;
  }

  private async count(input: Omit<QueryCommandInput, 'TableName' | 'Select'>): Promise<number> {
    let total = 0;
    let cursor: Record<string, unknown> | undefined;
    do {
      const res = await this.doc.send(
        new QueryCommand({ ...input, TableName: this.table, Select: 'COUNT', ExclusiveStartKey: cursor }),
      );
      total += res.Count ?? 0;
      cursor = res.LastEvaluatedKey;
    } while (cursor);
    return total;
  }
}

function encodeCursor(key: Record<string, unknown> | undefined): string | undefined {
  return key ? Buffer.from(JSON.stringify(key)).toString('base64url') : undefined;
}

function decodeCursor(cursor: string | undefined): Record<string, unknown> | undefined {
  if (!cursor) return undefined;
  try {
    return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    return undefined;
  }
}

function stripUndefined<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Table definition shared by infrastructure and tests. */
export const tableSchema = {
  partitionKey: 'pk',
  sortKey: 'sk',
  gsi1: { name: 'gsi1', partitionKey: 'gsi1pk', sortKey: 'gsi1sk' },
} as const;
