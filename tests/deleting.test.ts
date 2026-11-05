import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHarness, dan, rosa, type Harness } from './support/harness.js';
import { photo } from './support/fixtures.js';
import type { AlbumDetailDto, AlbumDto, ItemDetailDto, RecentlyDeletedDto, SearchDto, TimelineDto } from '../core/api-types.js';

let h: Harness;
beforeEach(async () => {
  h = await createHarness();
});
afterEach(async () => {
  await h.close();
});

/** Rosa's tagged photo, in an Album. */
async function rosasPhoto() {
  h.tagger.tags = ['beach'];
  const { ids } = await h.upload(rosa, [{ name: 'a.jpg', type: 'image/jpeg', bytes: await photo({ dateTimeOriginal: '2026:08:16 10:00:00' }) }]);
  await h.drain();
  const album = (await h.post<AlbumDto>(rosa, '/albums', { name: 'Coast' })).body;
  await h.post(rosa, `/albums/${album.id}/items`, { itemId: ids[0] });
  return { id: ids[0], albumId: album.id };
}

const mediaFor = (id: string) => [...h.media.objects.keys()].filter((k) => k.startsWith(`items/${id}/`));

describe('deleting an item', () => {
  it('moves it to the uploader’s Recently deleted and hides it everywhere else', async () => {
    const { id, albumId } = await rosasPhoto();
    const res = await h.del<ItemDetailDto>(rosa, `/items/${id}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'deleted', canRestore: true, purgeOn: '2026-12-05' });

    expect((await h.get<TimelineDto>(dan, '/timeline')).body.months).toEqual([]);
    expect((await h.get<SearchDto>(dan, '/search?tags=beach')).body.count).toBe(0);
    expect((await h.get<AlbumDetailDto>(dan, `/albums/${albumId}`)).body.album.count).toBe(0);
    expect((await h.get(dan, `/items/${id}`)).status).toBe(404);

    const mine = (await h.get<RecentlyDeletedDto>(rosa, '/recently-deleted')).body;
    expect(mine.items.map((i) => [i.id, i.purgeOn])).toEqual([[id, '2026-12-05']]);
    expect((await h.get<RecentlyDeletedDto>(dan, '/recently-deleted')).body.items).toEqual([]);
  });

  it('is only for the person who uploaded it', async () => {
    const { id } = await rosasPhoto();
    const res = await h.del(dan, `/items/${id}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('not_yours');
    expect((await h.get<ItemDetailDto>(dan, `/items/${id}`)).body).toMatchObject({ status: 'ready', canDelete: false });
    expect((await h.get<ItemDetailDto>(rosa, `/items/${id}`)).body.canDelete).toBe(true);
  });

  it('can be undone, bringing back its Tags and Albums', async () => {
    const { id, albumId } = await rosasPhoto();
    await h.del(rosa, `/items/${id}`);
    expect((await h.post(dan, `/items/${id}/restore`)).status).toBe(404);
    const res = await h.post<ItemDetailDto>(rosa, `/items/${id}/restore`);
    expect(res.body).toMatchObject({ status: 'ready', tags: [{ key: 'beach' }], albums: [{ id: albumId }] });
    expect((await h.get<TimelineDto>(dan, '/timeline')).body.months[0].count).toBe(1);
    expect((await h.get<RecentlyDeletedDto>(rosa, '/recently-deleted')).body.items).toEqual([]);
  });

  it('is permanent after 30 days, files included', async () => {
    const { id, albumId } = await rosasPhoto();
    await h.del(rosa, `/items/${id}`);
    h.setNow('2026-12-04T12:00:00Z');
    await h.purge();
    expect((await h.get(rosa, `/items/${id}`)).status).toBe(200);
    expect(mediaFor(id).length).toBeGreaterThan(0);

    h.setNow('2026-12-05T12:00:01Z');
    await h.purge();
    expect((await h.get(rosa, `/items/${id}`)).status).toBe(404);
    expect(mediaFor(id)).toEqual([]);
    expect((await h.get<RecentlyDeletedDto>(rosa, '/recently-deleted')).body.items).toEqual([]);
    expect((await h.get<AlbumDetailDto>(rosa, `/albums/${albumId}`)).body.album.count).toBe(0);
    expect((await h.get<SearchDto>(rosa, '/search?tags=beach')).body.count).toBe(0);
  });

  it('can be made permanent straight away from Recently deleted', async () => {
    const { id } = await rosasPhoto();
    expect((await h.del(rosa, `/recently-deleted/${id}`)).status).toBe(409); // not deleted yet
    await h.del(rosa, `/items/${id}`);
    expect((await h.del(dan, `/recently-deleted/${id}`)).status).toBe(404);
    expect((await h.del(rosa, `/recently-deleted/${id}`)).status).toBe(200);
    expect((await h.get(rosa, `/items/${id}`)).status).toBe(404);
    expect(mediaFor(id)).toEqual([]);
  });

  it('waits until the item has finished processing', async () => {
    const { ids } = await h.upload(rosa, [{ name: 'a.jpg', type: 'image/jpeg', bytes: await photo({ dateTimeOriginal: '2026:08:16 10:00:00' }) }]);
    const res = await h.del(rosa, `/items/${ids[0]}`);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('not_ready');
  });
});
