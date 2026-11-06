import { createVerify, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { S3Client } from '@aws-sdk/client-s3';
import { S3CloudFrontBlobStore, signCloudFrontUrl, windowedExpiry } from '../core/adapters/cloudfront.js';

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

/** What CloudFront does: rebuild the canned policy from the URL and check the signature with the public key. */
function cloudFrontAccepts(signed: string, nowEpoch: number): boolean {
  const u = new URL(signed);
  const expires = Number(u.searchParams.get('Expires'));
  const signature = u.searchParams.get('Signature')!.replace(/-/g, '+').replace(/_/g, '=').replace(/~/g, '/');
  const resource = `${u.origin}${u.pathname}`;
  const policy = `{"Statement":[{"Resource":"${resource}","Condition":{"DateLessThan":{"AWS:EpochTime":${expires}}}}]}`;
  return nowEpoch < expires && createVerify('RSA-SHA1').update(policy).verify(publicKey, signature, 'base64');
}

describe('links to photos and videos through CloudFront', () => {
  it('are signed so CloudFront accepts them until they expire', () => {
    const url = signCloudFrontUrl('https://d111.cloudfront.net/items/abc/thumb.jpg', 'K2ABC', privateKey, 2_000_000_000);
    expect(url).toMatch(/^https:\/\/d111\.cloudfront\.net\/items\/abc\/thumb\.jpg\?Expires=2000000000&Signature=[^&]+&Key-Pair-Id=K2ABC$/);
    expect(new URL(url).searchParams.get('Signature')).toMatch(/^[A-Za-z0-9~_-]+$/); // URL-safe, as CloudFront wants
    expect(cloudFrontAccepts(url, 1_999_999_999)).toBe(true);
    expect(cloudFrontAccepts(url, 2_000_000_000)).toBe(false);
    expect(cloudFrontAccepts(url.replace('thumb', 'display'), 1_999_999_999)).toBe(false);
  });

  it('stay the same within an hour, so the phone can reuse what it downloaded, and last at least an hour', () => {
    const hour = 3600;
    const at = (iso: string) => windowedExpiry(Date.parse(iso), hour);
    expect(at('2026-11-06T10:05:00Z')).toBe(at('2026-11-06T10:55:00Z'));
    for (const iso of ['2026-11-06T10:00:00Z', '2026-11-06T10:59:59Z']) {
      const left = at(iso) - Date.parse(iso) / 1000;
      expect(left).toBeGreaterThan(hour);
      expect(left).toBeLessThanOrEqual(2 * hour);
    }
  });

  it('point at the file in the CloudFront domain', async () => {
    const store = new S3CloudFrontBlobStore(new S3Client({ region: 'us-east-1' }), 'media', {
      domain: 'd111.cloudfront.net',
      keyPairId: 'K2ABC',
      privateKey: async () => privateKey,
      now: () => Date.parse('2026-11-06T10:00:00Z'),
    });
    const url = await store.signedGetUrl('items/abc/video/original-1080p.mp4', 3600);
    expect(url.startsWith('https://d111.cloudfront.net/items/abc/video/original-1080p.mp4?Expires=')).toBe(true);
    expect(cloudFrontAccepts(url, Date.parse('2026-11-06T10:30:00Z') / 1000)).toBe(true);
  });
});
