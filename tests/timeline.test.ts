import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import exifr from 'exifr';
import sharp from 'sharp';
import { createHarness, dan, rosa, stranger, type Harness } from './support/harness.js';
import { photo } from './support/fixtures.js';
import type { ItemDetailDto, TimelineDto } from '../core/api-types.js';

let h: Harness;
beforeEach(async () => {
  h = await createHarness();
});
afterEach(async () => {
  await h.close();
});

describe('membership', () => {
  it('refuses requests without a signed-in user', async () => {
    expect((await h.get(undefined, '/timeline')).status).toBe(401);
  });

  it('refuses signed-in people who are not in the family', async () => {
    const res = await h.get(stranger, '/timeline');
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('not_a_member');
  });

  it('lets family members in', async () => {
    const res = await h.get<TimelineDto>(rosa, '/timeline');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ months: [], undatedCount: 0 });
  });
});

describe('a photo on the Timeline', () => {
  it('appears under its month and day, newest first, with counts', async () => {
    await h.upload(rosa, [
      { name: 'a.jpg', type: 'image/jpeg', bytes: await photo({ dateTimeOriginal: '2026:10:26 14:03:00', offset: '+02:00' }) },
      { name: 'b.jpg', type: 'image/jpeg', bytes: await photo({ dateTimeOriginal: '2026:10:26 09:00:00' }) },
      { name: 'c.jpg', type: 'image/jpeg', bytes: await photo({ dateTimeOriginal: '2026:10:19 12:00:00' }) },
      { name: 'd.jpg', type: 'image/jpeg', bytes: await photo({ dateTimeOriginal: '2026:09:20 08:30:00' }) },
    ]);
    await h.drain();

    const res = await h.get<TimelineDto>(dan, '/timeline');
    expect(res.status).toBe(200);
    const shape = res.body.months.map((m) => ({
      month: m.month,
      count: m.count,
      days: m.days.map((d) => [d.date, d.count, d.items.map((i) => i.capture?.time)]),
    }));
    expect(shape).toEqual([
      {
        month: '2026-10',
        count: 3,
        days: [
          ['2026-10-26', 2, ['14:03:00', '09:00:00']],
          ['2026-10-19', 1, ['12:00:00']],
        ],
      },
      { month: '2026-09', count: 1, days: [['2026-09-20', 1, ['08:30:00']]] },
    ]);
    expect(res.body.months[0].days[0].items[0].thumbUrl).toMatch(/^https:\/\/media\.test\//);
  });

  it('shows who added it and serves an auto-oriented copy with no location data', async () => {
    const { ids } = await h.upload(rosa, [
      {
        name: 'portrait.jpg',
        type: 'image/jpeg',
        bytes: await photo({ dateTimeOriginal: '2026:08:16 10:00:00', gps: true, orientation: 6, width: 600, height: 400 }),
      },
    ]);
    await h.drain();

    const res = await h.get<ItemDetailDto>(dan, `/items/${ids[0]}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ready', kind: 'photo', addedBy: 'Aunt Rosa', width: 400, height: 600 });
    expect(res.body.capture).toEqual({ date: '2026-08-16', time: '10:00:00', source: 'file' });

    for (const object of h.media.objects.values()) {
      expect(await exifr.gps(object.body).catch(() => undefined)).toBeUndefined();
      expect((await sharp(object.body).metadata()).exif).toBeUndefined();
    }
  });

  it('pages through a long Timeline and can jump to a year', async () => {
    const files = [];
    for (let day = 1; day <= 9; day++) {
      files.push({ name: `p${day}.jpg`, type: 'image/jpeg', bytes: await photo({ dateTimeOriginal: `2025:03:0${day} 10:00:00` }) });
    }
    files.push({ name: 'old.jpg', type: 'image/jpeg', bytes: await photo({ dateTimeOriginal: '1999:07:04 18:00:00' }) });
    await h.upload(rosa, files);
    await h.drain();

    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const res = await h.get<TimelineDto>(rosa, `/timeline?limit=4${cursor ? `&cursor=${cursor}` : ''}`);
      for (const m of res.body.months) for (const d of m.days) for (const i of d.items) seen.push(i.capture!.date);
      cursor = res.body.cursor;
    } while (cursor);
    expect(seen).toHaveLength(10);
    expect(seen[0]).toBe('2025-03-09');
    expect(seen.at(-1)).toBe('1999-07-04');

    const jumped = await h.get<TimelineDto>(rosa, '/timeline?year=2000');
    expect(jumped.body.months.map((m) => m.month)).toEqual(['1999-07']);
  });
});
