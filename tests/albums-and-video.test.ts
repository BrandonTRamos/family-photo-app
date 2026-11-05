import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHarness, dan, rosa, type Harness } from './support/harness.js';
import { mp4, photo } from './support/fixtures.js';
import type { AlbumDetailDto, AlbumDto, ItemDetailDto, TimelineDto } from '../core/api-types.js';

let h: Harness;
beforeEach(async () => {
  h = await createHarness();
});
afterEach(async () => {
  await h.close();
});

async function photos(n: number) {
  const files = [];
  for (let i = 1; i <= n; i++) {
    files.push({ name: `p${i}.jpg`, type: 'image/jpeg', bytes: await photo({ dateTimeOriginal: `1978:06:${String(i).padStart(2, '0')} 10:00:00` }) });
  }
  const { ids } = await h.upload(rosa, files);
  await h.drain();
  return ids;
}

describe('Albums', () => {
  it('group items, and one item can be in several Albums', async () => {
    const [a, b] = await photos(2);
    const lake = (await h.post<AlbumDto>(rosa, '/albums', { name: ' Lake trip  1978 ' })).body;
    const grandpa = (await h.post<AlbumDto>(dan, '/albums', { name: 'Grandpa' })).body;
    expect(lake).toMatchObject({ name: 'Lake trip 1978', count: 0 });

    await h.post(rosa, `/albums/${lake.id}/items`, { itemId: a });
    await h.post(rosa, `/albums/${lake.id}/items`, { itemId: b });
    await h.post(dan, `/albums/${grandpa.id}/items`, { itemId: a });

    const list = await h.get<{ albums: AlbumDto[] }>(rosa, '/albums');
    expect(list.body.albums.map((x) => [x.name, x.count])).toEqual(
      expect.arrayContaining([
        ['Lake trip 1978', 2],
        ['Grandpa', 1],
      ]),
    );
    expect(list.body.albums.every((x) => x.coverUrl)).toBe(true);

    const detail = await h.get<ItemDetailDto>(rosa, `/items/${a}`);
    expect(detail.body.albums.map((x) => x.name)).toEqual(['Grandpa', 'Lake trip 1978']);

    const opened = await h.get<AlbumDetailDto>(rosa, `/albums/${lake.id}`);
    expect(opened.body.items.map((i) => i.id)).toEqual([b, a]);
  });

  it('removing an item from an Album keeps it in the Archive', async () => {
    const [a] = await photos(1);
    const album = (await h.post<AlbumDto>(rosa, '/albums', { name: 'Wedding' })).body;
    await h.post(rosa, `/albums/${album.id}/items`, { itemId: a });
    await h.del(rosa, `/albums/${album.id}/items/${a}`);
    expect((await h.get<AlbumDetailDto>(rosa, `/albums/${album.id}`)).body.items).toEqual([]);
    expect((await h.get<ItemDetailDto>(rosa, `/items/${a}`)).body.status).toBe('ready');
  });

  it('deleting an Album never deletes its items', async () => {
    const ids = await photos(3);
    const album = (await h.post<AlbumDto>(rosa, '/albums', { name: 'Christmas 2023' })).body;
    for (const id of ids) await h.post(rosa, `/albums/${album.id}/items`, { itemId: id });

    expect((await h.del(dan, `/albums/${album.id}`)).status).toBe(200);
    expect((await h.get(rosa, `/albums/${album.id}`)).status).toBe(404);
    const timeline = await h.get<TimelineDto>(rosa, '/timeline');
    expect(timeline.body.months[0].count).toBe(3);
    for (const id of ids) expect((await h.get<ItemDetailDto>(rosa, `/items/${id}`)).body.albums).toEqual([]);
  });

  it('can receive a whole upload', async () => {
    const album = (await h.post<AlbumDto>(rosa, '/albums', { name: 'Summer at the coast' })).body;
    const { ids } = await h.upload(
      rosa,
      [{ name: 'p.jpg', type: 'image/jpeg', bytes: await photo({ dateTimeOriginal: '2026:08:16 10:00:00' }) }],
      album.id,
    );
    await h.drain();
    expect((await h.get<AlbumDetailDto>(rosa, `/albums/${album.id}`)).body.items.map((i) => i.id)).toEqual(ids);
  });

  it('need a name', async () => {
    expect((await h.post(rosa, '/albums', { name: '  ' })).status).toBe(400);
    expect((await h.post(rosa, '/albums', { name: 'x'.repeat(61) })).status).toBe(400);
  });

  it('reject uploads into an Album that does not exist', async () => {
    const res = await h.post(rosa, '/uploads', { files: [{ name: 'a.jpg', type: 'image/jpeg', size: 10 }], albumId: 'nope' });
    expect(res.status).toBe(404);
  });
});

describe('videos', () => {
  async function uploadVideo(bytes = mp4({ appleCreationDate: '2026-10-03T17:45:10-0700' })) {
    const { ids } = await h.upload(rosa, [{ name: 'party.mov', type: 'video/quicktime', bytes }]);
    await h.drain();
    const jobId = [...h.transcoder.jobs.keys()].at(-1)!;
    return { id: ids[0], jobId };
  }

  it('play on the Timeline with their length and a poster once converted', async () => {
    const { id, jobId } = await uploadVideo();
    expect((await h.get<ItemDetailDto>(dan, `/items/${id}`)).body.status).toBe('processing');

    await h.transcoder.finish(jobId, { durationMs: 45_000 });
    await h.drain();

    const detail = await h.get<ItemDetailDto>(dan, `/items/${id}`);
    expect(detail.body).toMatchObject({ status: 'ready', kind: 'video', durationMs: 45_000 });
    expect(detail.body.capture).toEqual({ date: '2026-10-03', time: '17:45:10', source: 'file' });
    expect(detail.body.videoUrl).toMatch(/1080p\.mp4/);
    expect(detail.body.posterUrl).toBeTruthy();

    const timeline = await h.get<TimelineDto>(dan, '/timeline');
    expect(timeline.body.months[0].days[0].items[0]).toMatchObject({ id, kind: 'video', durationMs: 45_000 });
    expect(h.staging.objects.size).toBe(0);
  });

  it('are kept at most 1080p, whichever way the phone was held', async () => {
    const sizes: Record<string, unknown> = {};
    const cases = {
      '4K landscape': { width: 3840, height: 2160 },
      '4K portrait (stored sideways)': { width: 3840, height: 2160, rotation: 90 as const },
      '1080p already': { width: 1920, height: 1080 },
      'small': { width: 640, height: 360 },
    };
    for (const [name, video] of Object.entries(cases)) {
      await uploadVideo(mp4({ createdUtc: '2026-07-04T18:00:00Z', video }));
      sizes[name] = [...h.transcoder.jobs.values()].at(-1)!.size;
    }
    expect(sizes).toEqual({
      '4K landscape': { width: 1920, height: 1080 },
      '4K portrait (stored sideways)': { width: 1080, height: 1920 },
      '1080p already': undefined,
      'small': undefined,
    });
  });

  it('read the creation time from a plain MP4', async () => {
    const { id, jobId } = await uploadVideo(mp4({ createdUtc: '2026-07-04T18:00:00Z' }));
    await h.transcoder.finish(jobId);
    await h.drain();
    expect((await h.get<ItemDetailDto>(dan, `/items/${id}`)).body.capture).toMatchObject({ date: '2026-07-04', time: '18:00:00' });
  });

  it('publish once even when the completion event arrives twice', async () => {
    const { id, jobId } = await uploadVideo();
    await h.transcoder.finish(jobId);
    h.processingQueue.sendRaw(h.transcoder.lastCompletionEvent(jobId));
    await h.drain();
    expect((await h.get<TimelineDto>(dan, '/timeline')).body.months[0].count).toBe(1);
    expect(h.deadLetters).toEqual([]);
    expect((await h.get<ItemDetailDto>(dan, `/items/${id}`)).body.status).toBe('ready');
  });

  it('submit one conversion job even when the upload message repeats', async () => {
    const { id } = await uploadVideo();
    h.processingQueue.sendRaw(JSON.stringify({ kind: 'ingest', itemId: id }));
    await h.drain();
    expect(h.transcoder.jobs.size).toBe(1);
  });

  it('recover when the completion event was lost', async () => {
    const { id, jobId } = await uploadVideo();
    await h.transcoder.finish(jobId);
    h.processingQueue.bodies.length = 0; // the event never arrives
    h.processingQueue.sendRaw(JSON.stringify({ kind: 'ingest', itemId: id }));
    await h.drain();
    expect((await h.get<ItemDetailDto>(dan, `/items/${id}`)).body.status).toBe('ready');
  });

  it('report a failed conversion and keep the original', async () => {
    const { id, jobId } = await uploadVideo();
    h.transcoder.fail(jobId);
    await h.drain();
    const detail = await h.get<ItemDetailDto>(dan, `/items/${id}`);
    expect(detail.body).toMatchObject({ status: 'failed', failureReason: 'The video could not be converted.' });
    expect(h.staging.objects.size).toBe(1);
  });

  it('are not published when the converted files are missing', async () => {
    const { id, jobId } = await uploadVideo();
    await h.transcoder.finish(jobId, { writeOutputs: false });
    await h.drain();
    expect((await h.get<ItemDetailDto>(dan, `/items/${id}`)).body.status).toBe('failed');
  });

  it('without a date go to Undated', async () => {
    const { id, jobId } = await uploadVideo(mp4());
    await h.transcoder.finish(jobId);
    await h.drain();
    expect((await h.get<TimelineDto>(dan, '/timeline')).body.undatedCount).toBe(1);
    expect((await h.get<ItemDetailDto>(dan, `/items/${id}`)).body.canSetDate).toBe(true);
  });
});
