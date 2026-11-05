import type { ProcessingMessage, TranscodeStatus } from './ports.js';

const STATUSES: TranscodeStatus[] = ['SUBMITTED', 'PROGRESSING', 'COMPLETE', 'ERROR', 'CANCELED'];

/** Turns an EventBridge "MediaConvert Job State Change" event into a processing message. */
export function parseMediaConvertEvent(event: unknown): ProcessingMessage | undefined {
  const e = event as { source?: string; 'detail-type'?: string; detail?: Record<string, any> };
  if (e?.source !== 'aws.mediaconvert' || e['detail-type'] !== 'MediaConvert Job State Change' || !e.detail) {
    return undefined;
  }
  const { jobId, status, userMetadata, outputGroupDetails, errorMessage } = e.detail;
  const itemId = userMetadata?.itemId;
  if (typeof jobId !== 'string' || typeof itemId !== 'string' || !STATUSES.includes(status)) return undefined;

  let videoKey: string | undefined;
  let posterKey: string | undefined;
  let durationMs = 0;
  for (const group of Array.isArray(outputGroupDetails) ? outputGroupDetails : []) {
    for (const output of group?.outputDetails ?? []) {
      for (const path of output?.outputFilePaths ?? []) {
        const key = s3Key(path);
        if (!key) continue;
        if (key.endsWith('.mp4')) {
          videoKey = key;
          durationMs = Number(output.durationInMs) || 0;
        } else if (key.endsWith('.jpg')) {
          posterKey = key;
        }
      }
    }
  }
  return {
    kind: 'video',
    itemId,
    jobId,
    status,
    outputs: status === 'COMPLETE' && videoKey && posterKey ? { videoKey, posterKey, durationMs } : undefined,
    error: typeof errorMessage === 'string' ? errorMessage : undefined,
  };
}

function s3Key(path: unknown): string | undefined {
  if (typeof path !== 'string') return undefined;
  const m = /^s3:\/\/[^/]+\/(.+)$/.exec(path);
  return m?.[1];
}
