// Everything MediaConvert-specific: submitting jobs, reading them back, and its EventBridge events.
import { CreateJobCommand, GetJobCommand, MediaConvertClient } from '@aws-sdk/client-mediaconvert';
import type { TranscodeStatus, VideoEvent, VideoOutputs, VideoSize, VideoTranscoder } from '../ports.js';

export interface MediaConvertConfig {
  roleArn: string;
  stagingBucket: string;
  mediaBucket: string;
  appTag: string;
}

/** One 30 fps H.264 + AAC MP4 (8 Mbps cap) and one poster frame per video. */
export class MediaConvertTranscoder implements VideoTranscoder {
  constructor(
    private readonly client: MediaConvertClient,
    private readonly cfg: MediaConvertConfig,
  ) {}

  async submit(req: { itemId: string; inputKey: string; outputFolder: string; size?: VideoSize }): Promise<{ jobId: string }> {
    const destination = `s3://${this.cfg.mediaBucket}/${req.outputFolder}`;
    const res = await this.client.send(
      new CreateJobCommand({
        Role: this.cfg.roleArn,
        ClientRequestToken: `item-${req.itemId}`,
        UserMetadata: { app: this.cfg.appTag, itemId: req.itemId },
        Settings: {
          TimecodeConfig: { Source: 'ZEROBASED' },
          Inputs: [
            {
              FileInput: `s3://${this.cfg.stagingBucket}/${req.inputKey}`,
              TimecodeSource: 'ZEROBASED',
              VideoSelector: { Rotate: 'AUTO' },
              AudioSelectors: { 'Audio Selector 1': { DefaultSelection: 'DEFAULT' } },
            },
          ],
          OutputGroups: [
            {
              Name: 'Video',
              OutputGroupSettings: { Type: 'FILE_GROUP_SETTINGS', FileGroupSettings: { Destination: destination } },
              Outputs: [
                {
                  NameModifier: '-1080p',
                  ContainerSettings: { Container: 'MP4', Mp4Settings: { MoovPlacement: 'PROGRESSIVE_DOWNLOAD' } },
                  VideoDescription: {
                    // Rotation is applied on input, so the size is in on-screen orientation.
                    ...(req.size ? { Width: req.size.width, Height: req.size.height } : {}),
                    CodecSettings: {
                      Codec: 'H_264',
                      H264Settings: {
                        RateControlMode: 'QVBR',
                        QvbrSettings: { QvbrQualityLevel: 7 },
                        MaxBitrate: 8_000_000,
                        CodecProfile: 'HIGH',
                        SceneChangeDetect: 'TRANSITION_DETECTION',
                        FramerateControl: 'SPECIFIED',
                        FramerateNumerator: 30,
                        FramerateDenominator: 1,
                        FramerateConversionAlgorithm: 'DUPLICATE_DROP',
                      },
                    },
                  },
                  AudioDescriptions: [
                    {
                      AudioSourceName: 'Audio Selector 1',
                      CodecSettings: {
                        Codec: 'AAC',
                        AacSettings: { Bitrate: 128_000, CodingMode: 'CODING_MODE_2_0', SampleRate: 48_000 },
                      },
                    },
                  ],
                },
              ],
            },
            {
              Name: 'Poster',
              OutputGroupSettings: { Type: 'FILE_GROUP_SETTINGS', FileGroupSettings: { Destination: destination } },
              Outputs: [
                {
                  NameModifier: '-poster',
                  ContainerSettings: { Container: 'RAW' },
                  VideoDescription: {
                    CodecSettings: {
                      Codec: 'FRAME_CAPTURE',
                      FrameCaptureSettings: { FramerateNumerator: 1, FramerateDenominator: 1, MaxCaptures: 1, Quality: 80 },
                    },
                  },
                },
              ],
            },
          ],
        },
      }),
    );
    return { jobId: res.Job!.Id! };
  }

  async getJob(jobId: string): Promise<{ status: TranscodeStatus; outputs?: VideoOutputs; error?: string }> {
    const { Job: job } = await this.client.send(new GetJobCommand({ Id: jobId }));
    const status = (job?.Status ?? 'SUBMITTED') as TranscodeStatus;
    if (status !== 'COMPLETE') return { status, error: job?.ErrorMessage };
    const destination = job?.Settings?.OutputGroups?.[0]?.OutputGroupSettings?.FileGroupSettings?.Destination ?? '';
    const input = job?.Settings?.Inputs?.[0]?.FileInput ?? '';
    const durationMs = job?.OutputGroupDetails?.[0]?.OutputDetails?.[0]?.DurationInMs ?? 0;
    return { status, outputs: { ...mediaConvertOutputKeys(withoutBucket(destination), withoutBucket(input)), durationMs } };
  }

  parseEvent(event: unknown): VideoEvent | undefined {
    return parseMediaConvertEvent(event);
  }
}

/** MediaConvert names outputs <folder><input name without extension><NameModifier>; frame captures add a counter. */
export function mediaConvertOutputKeys(outputFolder: string, inputKey: string): { videoKey: string; posterKey: string } {
  const base = inputKey.split('/').pop()!.replace(/\.[^.]+$/, '');
  return { videoKey: `${outputFolder}${base}-1080p.mp4`, posterKey: `${outputFolder}${base}-poster.0000000.jpg` };
}

function withoutBucket(s3Url: string): string {
  return s3Url.replace(/^s3:\/\/[^/]+\//, '');
}

const STATUSES: TranscodeStatus[] = ['SUBMITTED', 'PROGRESSING', 'COMPLETE', 'ERROR', 'CANCELED'];

/** Turns an EventBridge "MediaConvert Job State Change" event into a processing message. */
export function parseMediaConvertEvent(event: unknown): VideoEvent | undefined {
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
