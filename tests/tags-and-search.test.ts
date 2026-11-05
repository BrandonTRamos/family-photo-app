import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHarness, dan, rosa, type Harness } from './support/harness.js';
import { mp4, photo } from './support/fixtures.js';
import type { ItemDetailDto, SearchDto } from '../core/api-types.js';

let h: Harness;
beforeEach(async () => {
  h = await createHarness();
});
afterEach(async () => {
  await h.close();
});

async function onePhoto(tags: string[], date = '2026:08:16 10:00:00') {
  h.tagger.tags = tags;
  const { ids } = await h.upload(rosa, [{ name: 'p.jpg', type: 'image/jpeg', bytes: await photo({ dateTimeOriginal: date }) }]);
  await h.drain();
  return ids[0];
}

describe('AI tags', () => {
  it('describe the photo and are marked as automatic', async () => {
    const id = await onePhoto(['Beach', 'beach umbrella', 'ocean']);
    const detail = await h.get<ItemDetailDto>(dan, `/items/${id}`);
    expect(detail.body.tags).toEqual([
      { key: 'beach', label: 'beach', source: 'ai' },
      { key: 'beach umbrella', label: 'beach umbrella', source: 'ai' },
      { key: 'ocean', label: 'ocean', source: 'ai' },
    ]);
  });

  it('are kept short, unique and few', async () => {
    const many = Array.from({ length: 30 }, (_, i) => `thing ${i}`);
    const id = await onePhoto(['dog', 'DOG', '  dog ', 'x'.repeat(80), '', ...many]);
    const tags = (await h.get<ItemDetailDto>(dan, `/items/${id}`)).body.tags.map((t) => t.key);
    expect(tags[0]).toBe('dog');
    expect(tags.filter((t) => t === 'dog')).toHaveLength(1);
    expect(tags.every((t) => t.length <= 40)).toBe(true);
    expect(tags).toHaveLength(6);
  });

  it('never block a photo from being seen when tagging fails', async () => {
    h.tagger.failuresLeft = 100;
    const id = await onePhoto(['beach']);
    const detail = await h.get<ItemDetailDto>(dan, `/items/${id}`);
    expect(detail.body.status).toBe('ready');
    expect(detail.body.tags).toEqual([]);
    expect(h.deadLetters.map((d) => d.queue)).toEqual(['tagging']);
  });

  it('recover from a temporary tagging failure', async () => {
    h.tagger.failuresLeft = 2;
    const id = await onePhoto(['beach']);
    expect((await h.get<ItemDetailDto>(dan, `/items/${id}`)).body.tags.map((t) => t.key)).toEqual(['beach']);
    expect(h.deadLetters).toEqual([]);
  });

  it('are never added to videos', async () => {
    const { ids } = await h.upload(rosa, [{ name: 'v.mp4', type: 'video/mp4', bytes: mp4({ createdUtc: '2026-07-04T18:00:00Z' }) }]);
    await h.drain();
    await h.transcoder.finish([...h.transcoder.jobs.keys()][0]);
    await h.drain();
    expect((await h.get<ItemDetailDto>(dan, `/items/${ids[0]}`)).body).toMatchObject({ status: 'ready', tags: [] });
    expect(h.tagger.calls).toBe(0);
  });
});

describe('editing tags', () => {
  it('lets anyone add a Family tag, keeping its capitals and who added it', async () => {
    const id = await onePhoto(['beach']);
    const res = await h.post<ItemDetailDto>(dan, `/items/${id}/tags`, { label: '  Cousins ' });
    expect(res.status).toBe(200);
    expect(res.body.tags).toContainEqual({ key: 'cousins', label: 'Cousins', source: 'family', addedBy: 'Uncle Dan' });
    const again = await h.post<ItemDetailDto>(rosa, `/items/${id}/tags`, { label: 'cousins' });
    expect(again.body.tags.filter((t) => t.key === 'cousins')).toHaveLength(1);
  });

  it('rejects empty or overly long tags', async () => {
    const id = await onePhoto([]);
    for (const label of ['', '   ', 'x'.repeat(41), 42, 'a,b']) {
      const res = await h.post(dan, `/items/${id}/tags`, { label });
      expect(res.status, String(label)).toBe(400);
    }
  });

  it('removes a wrong AI tag for good, leaving the photo alone', async () => {
    const id = await onePhoto(['lion', 'grass']);
    const res = await h.del<ItemDetailDto>(dan, `/items/${id}/tags/lion`);
    expect(res.status).toBe(200);
    expect(res.body.tags.map((t) => t.key)).toEqual(['grass']);
    expect(res.body.status).toBe('ready');

    h.taggingQueue.sendRaw(JSON.stringify({ kind: 'tag', itemId: id }));
    await h.drain();
    expect((await h.get<ItemDetailDto>(dan, `/items/${id}`)).body.tags.map((t) => t.key)).toEqual(['grass']);
    expect((await h.get<SearchDto>(dan, '/search?tags=lion')).body.count).toBe(0);
  });

  it('says so when the tag is not there', async () => {
    const id = await onePhoto(['grass']);
    expect((await h.del(dan, `/items/${id}/tags/lion`)).status).toBe(404);
  });

  it('removes a tag only once when two people remove it at the same moment', async () => {
    const id = await onePhoto(['lion']);
    const results = await Promise.all([h.del(dan, `/items/${id}/tags/lion`), h.del(rosa, `/items/${id}/tags/lion`)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 404]);
  });
});

describe('search', () => {
  it('finds photos by what is in them, newest first, with a count and related tags', async () => {
    const lake = await onePhoto(['outdoors', 'lake', 'sunset'], '2026:09:12 19:00:00');
    const beach = await onePhoto(['outdoors', 'beach', 'sunset'], '2026:08:16 10:00:00');
    const park = await onePhoto(['outdoors', 'park'], '2026:10:19 12:00:00');
    await onePhoto(['kitchen'], '2026:10:20 12:00:00');

    const res = await h.get<SearchDto>(dan, '/search?tags=Outdoors');
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(3);
    expect(res.body.items.map((i) => i.id)).toEqual([park, lake, beach]);
    expect(res.body.related[0]).toEqual({ key: 'sunset', label: 'sunset' });
    expect(res.body.related.map((r) => r.key)).not.toContain('outdoors');
  });

  it('combines tags, including Family tags', async () => {
    const withCousins = await onePhoto(['beach']);
    await onePhoto(['beach']);
    await h.post(dan, `/items/${withCousins}/tags`, { label: 'Cousins' });
    const res = await h.get<SearchDto>(dan, '/search?tags=beach,cousins');
    expect(res.body.items.map((i) => i.id)).toEqual([withCousins]);
  });

  it('pages through many results', async () => {
    for (let i = 1; i <= 5; i++) await onePhoto(['dog'], `2026:01:0${i} 10:00:00`);
    const first = await h.get<SearchDto>(dan, '/search?tags=dog&limit=3');
    expect(first.body.items).toHaveLength(3);
    const second = await h.get<SearchDto>(dan, `/search?tags=dog&limit=3&cursor=${first.body.cursor}`);
    expect(second.body.items).toHaveLength(2);
    expect(second.body.cursor).toBeUndefined();
  });

  it('matches the start of any word in a tag, so part of a tag is enough', async () => {
    const salon = await onePhoto(['nail salon', 'child']);
    await onePhoto(['kitchen']);
    for (const typed of ['nail', 'Nai', 'salon', 'nail sal', 'nail salon']) {
      const res = await h.get<SearchDto>(dan, `/search?tags=${encodeURIComponent(typed)}`);
      expect([typed, res.body.items.map((i) => i.id)]).toEqual([typed, [salon]]);
    }
    expect((await h.get<SearchDto>(dan, '/search?tags=ail')).body.count).toBe(0);
    expect((await h.get<SearchDto>(dan, '/search?tags=nail,chi')).body.count).toBe(1);
    expect((await h.get<SearchDto>(dan, '/search?tags=nail,kitchen')).body.count).toBe(0);
  });

  it('suggests other tags, not the ones that matched', async () => {
    await onePhoto(['sunset', 'sunny day', 'lake']);
    const res = await h.get<SearchDto>(dan, '/search?tags=sun');
    expect(res.body.related.map((r) => r.key)).toEqual(['lake']);
  });

  it('stops finding a tag once it is removed', async () => {
    const id = await onePhoto(['nail salon']);
    await h.del(dan, `/items/${id}/tags/${encodeURIComponent('nail salon')}`);
    expect((await h.get<SearchDto>(dan, '/search?tags=salon')).body.count).toBe(0);
  });

  it('still finds everything after the search index is rebuilt', async () => {
    const id = await onePhoto(['nail salon']);
    expect(await h.janitor({ task: 'rebuild-tag-index' })).toEqual({ reindexed: 1 });
    expect((await h.get<SearchDto>(dan, '/search?tags=salon')).body.items.map((i) => i.id)).toEqual([id]);
  });

  it('asks for something to look for', async () => {
    expect((await h.get(dan, '/search?tags=')).status).toBe(400);
  });
});
