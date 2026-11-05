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
import { placement, tagSearchEntries } from '../item.js';
import type { Page, Repository } from '../ports.js';

/**
 * Single-table layout:
 *   ITEM#id   / ITEM        the item (gsi1: TL by Capture date, UNDATED by created time, or DELETED by deleted time)
 *   ITEM#id   / ALBUM#aid   reverse Album membership
 *   TW#entry␁key / ITEM#id  tag search index, one row per word-start entry of each Tag (gsi1: TAGWORDS,
 *                           prefix-queried; verified against the item on read)
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
      const before = indexEntries(current);
      const after = indexEntries(stored);
      for (const entry of after) if (!before.has(entry)) await this.putIndexRow(entry, id);
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
      for (const entry of before) if (!after.has(entry)) await this.deleteRow(`TW#${entry}`, `ITEM#${id}`);
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

  async deletedItems(): Promise<Item[]> {
    const out: Item[] = [];
    let cursor: Record<string, unknown> | undefined;
    do {
      const res = await this.doc.send(
        new QueryCommand({
          TableName: this.table,
          IndexName: 'gsi1',
          KeyConditionExpression: 'gsi1pk = :p',
          ExpressionAttributeValues: { ':p': 'DELETED' },
          ExclusiveStartKey: cursor,
        }),
      );
      out.push(...(res.Items ?? []).map((r) => r.data as Item));
      cursor = res.LastEvaluatedKey;
    } while (cursor);
    return out;
  }

  async deleteItem(id: string): Promise<void> {
    const item = await this.getItem(id);
    for (const entry of item ? indexEntries(item) : []) await this.deleteRow(`TW#${entry}`, `ITEM#${id}`);
    for (const albumId of await this.albumIdsForItem(id)) await this.removeFromAlbum(albumId, id);
    await this.deleteRow(`ITEM#${id}`, 'ITEM');
  }

  async itemIdsMatching(term: string): Promise<string[]> {
    const ids = new Set<string>();
    let cursor: Record<string, unknown> | undefined;
    do {
      const res = await this.doc.send(
        new QueryCommand({
          TableName: this.table,
          IndexName: 'gsi1',
          KeyConditionExpression: 'gsi1pk = :p AND begins_with(gsi1sk, :t)',
          ExpressionAttributeValues: { ':p': 'TAGWORDS', ':t': term },
          ProjectionExpression: 'sk',
          ExclusiveStartKey: cursor,
        }),
      );
      for (const row of res.Items ?? []) ids.add(String(row.sk).slice('ITEM#'.length));
      cursor = res.LastEvaluatedKey;
    } while (cursor);
    return [...ids];
  }

  async rebuildTagIndex(): Promise<number> {
    let count = 0;
    for (const list of ['TL', 'UNDATED', 'DELETED']) {
      let cursor: Record<string, unknown> | undefined;
      do {
        const res = await this.doc.send(
          new QueryCommand({
            TableName: this.table,
            IndexName: 'gsi1',
            KeyConditionExpression: 'gsi1pk = :p',
            ExpressionAttributeValues: { ':p': list },
            ExclusiveStartKey: cursor,
          }),
        );
        for (const row of res.Items ?? []) {
          const item = row.data as Item;
          for (const entry of indexEntries(item)) await this.putIndexRow(entry, item.id);
          for (const tag of item.tags) await this.deleteRow(`TAG#${tag.key}`, `ITEM#${item.id}`); // the old exact-tag index
          count++;
        }
        cursor = res.LastEvaluatedKey;
      } while (cursor);
    }
    return count;
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
      row.gsi1pk = { timeline: 'TL', undated: 'UNDATED', deleted: 'DELETED' }[where.list];
      row.gsi1sk = where.sortKey;
    }
    return stripUndefined(row);
  }

  private async putIndexRow(entry: string, itemId: string): Promise<void> {
    await this.doc.send(
      new PutCommand({
        TableName: this.table,
        Item: { pk: `TW#${entry}`, sk: `ITEM#${itemId}`, gsi1pk: 'TAGWORDS', gsi1sk: `${entry}${SEP}${itemId}` },
      }),
    );
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

/** Separates the parts of a tag index entry; can't be typed into a Tag. */
const SEP = '\u0001';

/** "word-start entry␁tag key" for each Tag, e.g. "salon␁nail salon". Prefix queries on it find partial words. */
function indexEntries(item: Item): Set<string> {
  return new Set(item.tags.flatMap((t) => tagSearchEntries(t.key).map((entry) => `${entry}${SEP}${t.key}`)));
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
