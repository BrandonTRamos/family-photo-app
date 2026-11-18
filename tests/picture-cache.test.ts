import { describe, expect, it } from 'vitest';
import { mediaConvertOutputKeys } from '../core/adapters/mediaconvert';
import { signCloudFrontUrl } from '../core/adapters/cloudfront';
import { mediaLayout } from '../core/media-layout';
import { isPicture, isThumb, keepByPath } from '../src/media-cache';
import { generateKeyPairSync } from 'node:crypto';

const key = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' }) as string;
const link = (path: string, expires = 1_800_000_000) => new URL(signCloudFrontUrl(`https://media.test/${path}`, 'K1', key, expires));

describe('pictures kept on the phone', () => {
  const video = mediaConvertOutputKeys(mediaLayout.videoFolder('v1'), mediaLayout.original('v1'));

  it('keeps thumbnails, display pictures and video posters, each in its own cache', () => {
    expect(isThumb({ url: link(mediaLayout.thumb('a1')) })).toBe(true);
    expect(isPicture({ url: link(mediaLayout.thumb('a1')) })).toBe(false);
    for (const path of [mediaLayout.display('a1'), video.posterKey]) {
      expect(isPicture({ url: link(path) })).toBe(true);
      expect(isThumb({ url: link(path) })).toBe(false);
    }
  });

  it('leaves videos and anything unsigned to the browser', () => {
    const url = link(video.videoKey);
    expect(isThumb({ url }) || isPicture({ url })).toBe(false);
    const unsigned = new URL('https://media.test/items/a1/thumb.jpg');
    expect(isThumb({ url: unsigned }) || isPicture({ url: unsigned })).toBe(false);
  });

  it('files a picture under the same name whichever hour its link is from', async () => {
    const keyFor = (url: URL) => keepByPath.cacheKeyWillBeUsed({ request: new Request(url) });
    const now = await keyFor(link(mediaLayout.thumb('a1'), 1_800_000_000));
    const later = await keyFor(link(mediaLayout.thumb('a1'), 1_800_003_600));
    expect(now).toBe('https://media.test/items/a1/thumb.jpg');
    expect(later).toBe(now);
    expect(await keyFor(link(mediaLayout.thumb('a2')))).not.toBe(now);
  });
});
