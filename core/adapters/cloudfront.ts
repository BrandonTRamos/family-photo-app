// Photos and videos are served through CloudFront: a nearby copy for every viewer, private behind signed links.
import { createSign } from 'node:crypto';
import type { S3Client } from '@aws-sdk/client-s3';
import { S3BlobStore } from './aws.js';

/**
 * A CloudFront signed URL with a canned policy (what a trusted key group checks).
 * See "Create a signed URL using a canned policy" in the CloudFront developer guide.
 */
export function signCloudFrontUrl(url: string, keyPairId: string, privateKeyPem: string, expiresEpoch: number): string {
  const policy = JSON.stringify({ Statement: [{ Resource: url, Condition: { DateLessThan: { 'AWS:EpochTime': expiresEpoch } } }] });
  const signature = createSign('RSA-SHA1')
    .update(policy)
    .sign(privateKeyPem, 'base64')
    .replace(/\+/g, '-')
    .replace(/=/g, '_')
    .replace(/\//g, '~');
  return `${url}?Expires=${expiresEpoch}&Signature=${signature}&Key-Pair-Id=${keyPairId}`;
}

/**
 * Expiry rounded to a window, valid for between ttl and 2×ttl seconds. Within a window a file's link stays the same,
 * so the phone's own cache can reuse what it already downloaded.
 */
export function windowedExpiry(nowMs: number, ttlSeconds: number): number {
  return (Math.floor(nowMs / 1000 / ttlSeconds) + 2) * ttlSeconds;
}

export interface CloudFrontLinks {
  domain: string;
  keyPairId: string;
  privateKey: () => Promise<string>;
  now?: () => number;
}

/** The media bucket, with links to files going through CloudFront instead of straight to S3. */
export class S3CloudFrontBlobStore extends S3BlobStore {
  constructor(
    s3: S3Client,
    bucket: string,
    private readonly cdn: CloudFrontLinks,
  ) {
    super(s3, bucket);
  }

  override async signedGetUrl(key: string, expiresInSeconds: number): Promise<string> {
    const path = key.split('/').map(encodeURIComponent).join('/');
    const expires = windowedExpiry((this.cdn.now ?? Date.now)(), expiresInSeconds);
    return signCloudFrontUrl(`https://${this.cdn.domain}/${path}`, this.cdn.keyPairId, await this.cdn.privateKey(), expires);
  }
}
