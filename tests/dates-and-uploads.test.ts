import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHarness, dan, rosa, type Harness } from './support/harness.js';
import { mp4, photo, pngWithoutDate } from './support/fixtures.js';
import type { ItemDetailDto, TimelineDto, UndatedDto, UploadResponse } from '../core/api-types.js';

let h: Harness;
beforeEach(async () => {
  h = await createHarness();
});
afterEach(async () => {
  await h.close();
});

describe('Undated items', () => {
  it('go to the Undated section, not the Timeline', async () => {
    const { ids } = await h.upload(rosa, [{ name: 'scan.png', type: 'image/png', bytes: await pngWithoutDate() }]);
    await h.drain();

    const timeline = await h.get<TimelineDto>(rosa, '/timeline');
    expect(timeline.body.months).toEqual([]);
    expect(timeline.body.undatedCount).toBe(1);

    const undated = await h.get<UndatedDto>(rosa, '/undated');
    expect(undated.body.count).toBe(1);
    expect(undated.body.items.map((i) => i.id)).toEqual(ids);

    const detail = await h.get<ItemDetailDto>(rosa, `/items/${ids[0]}`);
    expect(detail.body.canSetDate).toBe(true);
    expect(detail.body.capture).toBeUndefined();
  });

  it('move onto the Timeline when a family member sets an exact date', async () => {
    const { ids } = await h.upload(rosa, [{ name: 'scan.png', type: 'image/png', bytes: await pngWithoutDate() }]);
    await h.drain();

    const set = await h.put<ItemDetailDto>(dan, `/items/${ids[0]}/capture-date`, { date: '1978-06-10' });
    expect(set.status).toBe(200);
    expect(set.body.capture).toEqual({ date: '1978-06-10', source: 'family' });
    expect(set.body.canSetDate).toBe(false);

    const timeline = await h.get<TimelineDto>(rosa, '/timeline');
    expect(timeline.body.undatedCount).toBe(0);
    expect(timeline.body.months[0]).toMatchObject({ month: '1978-06', count: 1, days: [{ date: '1978-06-10', count: 1 }] });
  });

  it('accept only a full, real, past date', async () => {
    const { ids } = await h.upload(rosa, [{ name: 'scan.png', type: 'image/png', bytes: await pngWithoutDate() }]);
    await h.drain();
    for (const date of ['1970s', '1985', '1985-06', '1985-02-30', '2027-01-01', 1985]) {
      const res = await h.put(dan, `/items/${ids[0]}/capture-date`, { date });
      expect(res.status, String(date)).toBe(400);
      expect(res.body.error).toBe('invalid_date');
    }
  });

  it('never overwrite a date read from the file', async () => {
    const { ids } = await h.upload(rosa, [
      { name: 'a.jpg', type: 'image/jpeg', bytes: await photo({ dateTimeOriginal: '2026:10:26 14:03:00' }) },
    ]);
    await h.drain();
    const res = await h.put(dan, `/items/${ids[0]}/capture-date`, { date: '2001-01-01' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('already_dated');
    expect((await h.get<ItemDetailDto>(rosa, `/items/${ids[0]}`)).body.capture?.date).toBe('2026-10-26');
  });

  it('can be dated at upload time, but the file date wins when there is one', async () => {
    const { ids } = await h.upload(rosa, [
      { name: 'scan.png', type: 'image/png', bytes: await pngWithoutDate(), captureDate: '1985-12-25' },
      { name: 'a.jpg', type: 'image/jpeg', bytes: await photo({ dateTimeOriginal: '2026:10:26 14:03:00' }), captureDate: '1999-01-01' },
    ]);
    await h.drain();
    const [scan, dated] = await Promise.all(ids.map((id) => h.get<ItemDetailDto>(rosa, `/items/${id}`)));
    expect(scan.body.capture).toEqual({ date: '1985-12-25', source: 'family' });
    expect(dated.body.capture).toMatchObject({ date: '2026-10-26', source: 'file' });
  });
});

describe('uploading', () => {
  it('explains files that are too large or not a photo or video, and accepts the rest', async () => {
    const res = await h.post<UploadResponse>(rosa, '/uploads', {
      files: [
        { name: 'huge.jpg', type: 'image/jpeg', size: 60 * 1024 * 1024 },
        { name: 'notes.pdf', type: 'application/pdf', size: 1000 },
        { name: 'ok.jpg', type: 'image/jpeg', size: 1000 },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.results.map((r) => (r.ok ? 'ok' : r.error))).toEqual(['too_large', 'unsupported_type', 'ok']);
    const tooLarge = res.body.results[0];
    expect(!tooLarge.ok && tooLarge.message).toMatch(/huge\.jpg is larger than the 50 MB limit/);
  });

  it('reports a file that could not be read as a photo, and keeps the original for recovery', async () => {
    const { ids } = await h.upload(rosa, [{ name: 'broken.jpg', type: 'image/jpeg', bytes: Buffer.from('not really a jpeg') }]);
    await h.drain();
    const detail = await h.get<ItemDetailDto>(rosa, `/items/${ids[0]}`);
    expect(detail.body.status).toBe('failed');
    expect(detail.body.failureReason).toMatch(/could not be opened/);
    expect(h.staging.objects.has(`uploads/${ids[0]}/original`)).toBe(true);
    expect((await h.get<TimelineDto>(rosa, '/timeline')).body).toEqual({ months: [], undatedCount: 0 });
  });

  it('removes the staged original only after a successful publish', async () => {
    const { ids } = await h.upload(rosa, [
      { name: 'a.jpg', type: 'image/jpeg', bytes: await photo({ dateTimeOriginal: '2026:10:26 14:03:00' }) },
    ]);
    expect(h.staging.objects.size).toBe(1);
    expect((await h.get<ItemDetailDto>(rosa, `/items/${ids[0]}`)).body.status).toBe('processing');
    await h.drain();
    expect(h.staging.objects.size).toBe(0);
    expect((await h.get<ItemDetailDto>(rosa, `/items/${ids[0]}`)).body.status).toBe('ready');
  });

  it('processes a repeated message only once', async () => {
    const { ids } = await h.upload(rosa, [
      { name: 'a.jpg', type: 'image/jpeg', bytes: await photo({ dateTimeOriginal: '2026:10:26 14:03:00' }) },
    ]);
    h.processingQueue.sendRaw(JSON.stringify({ kind: 'ingest', itemId: ids[0] }));
    await h.drain();
    h.processingQueue.sendRaw(JSON.stringify({ kind: 'ingest', itemId: ids[0] }));
    await h.drain();
    const timeline = await h.get<TimelineDto>(rosa, '/timeline');
    expect(timeline.body.months[0].count).toBe(1);
    expect(h.tagger.calls).toBe(1);
    expect(h.deadLetters).toEqual([]);
  });

  it('refuses to process an upload whose bytes did not all arrive', async () => {
    const res = await h.post<UploadResponse>(rosa, '/uploads', { files: [{ name: 'a.jpg', type: 'image/jpeg', size: 5000 }] });
    const result = res.body.results[0];
    if (!result.ok || result.grant.mode !== 'single') throw new Error('expected a single grant');
    h.staging.putToUrl(result.grant.url, Buffer.alloc(100));
    const done = await h.post(rosa, `/uploads/${result.itemId}/complete`);
    expect(done.status).toBe(409);
    expect(done.body.error).toBe('upload_incomplete');
  });

  it('sends large files in parts that can be retried, then assembles them', async () => {
    const big = mp4({ createdUtc: '2026-07-04T18:00:00Z', payloadBytes: 200 * 1024 });
    h.failStorageSends(1);
    const { ids } = await h.upload(rosa, [{ name: 'fireworks.mp4', type: 'video/mp4', bytes: big }]);
    expect(h.staging.multipartCompleted).toBe(1);
    expect(h.staging.objects.get(`uploads/${ids[0]}/original`)?.body.equals(big)).toBe(true);
  });

  it('retrying a failed upload finishes the same item instead of starting another', async () => {
    const files = [{ name: 'a.jpg', type: 'image/jpeg', bytes: await photo({ dateTimeOriginal: '2026:10:26 14:03:00' }) }];
    const screen = h.uploader(rosa);
    h.failStorageSends(4); // more than the client's own retries
    const [first] = await screen.send(files);
    expect(first.ok).toBe(false);
    const [second] = await screen.send(files);
    expect(second).toMatchObject({ ok: true, itemId: first.itemId });
    await h.drain();
    expect((await h.get<TimelineDto>(rosa, '/timeline')).body.months[0].count).toBe(1);
  });

  it('lets only the uploader finish their upload', async () => {
    const res = await h.post<UploadResponse>(rosa, '/uploads', { files: [{ name: 'a.jpg', type: 'image/jpeg', size: 10 }] });
    const result = res.body.results[0];
    if (!result.ok) throw new Error('expected ok');
    expect((await h.post(dan, `/uploads/${result.itemId}/complete`)).status).toBe(404);
  });
});
