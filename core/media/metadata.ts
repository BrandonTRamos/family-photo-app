import exifr from 'exifr';
import type { CaptureDate } from '../domain.js';
import type { MetadataReader, VideoSize } from '../ports.js';

const EXIF_DATE = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/;
const OFFSET = /^[+-]\d{2}:\d{2}$/;
const MAX_MOOV_BYTES = 32 * 1024 * 1024;
const MP4_EPOCH_OFFSET_SECONDS = 2082844800; // 1904-01-01 to 1970-01-01

export class FileMetadataReader implements MetadataReader {
  async photoCapture(bytes: Buffer): Promise<CaptureDate | undefined> {
    let tags: Record<string, unknown> | undefined;
    try {
      tags = await exifr.parse(bytes, {
        tiff: true,
        exif: true,
        gps: false,
        reviveValues: false,
        pick: ['DateTimeOriginal', 'OffsetTimeOriginal', 'CreateDate', 'OffsetTimeDigitized'],
      });
    } catch {
      return undefined;
    }
    if (!tags) return undefined;
    const raw = (tags.DateTimeOriginal ?? tags.CreateDate) as unknown;
    if (typeof raw !== 'string') return undefined;
    const m = EXIF_DATE.exec(raw);
    if (!m || m[1] === '0000') return undefined;
    const offset = (tags.OffsetTimeOriginal ?? tags.OffsetTimeDigitized) as unknown;
    return {
      date: `${m[1]}-${m[2]}-${m[3]}`,
      time: `${m[4]}:${m[5]}:${m[6]}`,
      offset: typeof offset === 'string' && OFFSET.test(offset) ? offset : undefined,
      source: 'file',
    };
  }

  async videoInfo(
    read: (start: number, endInclusive: number) => Promise<Buffer>,
    size: number,
  ): Promise<{ capture?: CaptureDate; size?: VideoSize }> {
    const moov = await findTopLevelBox(read, size, 'moov');
    if (!moov) return {};
    return { capture: appleCreationDate(moov) ?? mvhdCreationDate(moov), size: displaySize(moov) };
  }
}

async function findTopLevelBox(
  read: (start: number, endInclusive: number) => Promise<Buffer>,
  size: number,
  type: string,
): Promise<Buffer | undefined> {
  let offset = 0;
  for (let guard = 0; offset + 8 <= size && guard < 64; guard++) {
    const header = await read(offset, Math.min(offset + 15, size - 1));
    let boxSize = header.readUInt32BE(0);
    const boxType = header.toString('latin1', 4, 8);
    let headerLen = 8;
    if (boxSize === 1) {
      if (header.length < 16) return undefined;
      boxSize = Number(header.readBigUInt64BE(8));
      headerLen = 16;
    } else if (boxSize === 0) {
      boxSize = size - offset;
    }
    if (boxSize < headerLen) return undefined;
    if (boxType === type) {
      if (boxSize > MAX_MOOV_BYTES) return undefined;
      return read(offset + headerLen, offset + boxSize - 1);
    }
    offset += boxSize;
  }
  return undefined;
}

/** iPhone videos store local time with offset under com.apple.quicktime.creationdate. */
function appleCreationDate(moov: Buffer): CaptureDate | undefined {
  const text = moov.toString('latin1');
  if (!text.includes('com.apple.quicktime.creationdate')) return undefined;
  const m = /(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})([+-]\d{2}):?(\d{2})/.exec(text);
  if (!m) return undefined;
  return { date: `${m[1]}-${m[2]}-${m[3]}`, time: `${m[4]}:${m[5]}:${m[6]}`, offset: `${m[7]}:${m[8]}`, source: 'file' };
}

function mvhdCreationDate(moov: Buffer): CaptureDate | undefined {
  let offset = 0;
  while (offset + 8 <= moov.length) {
    const boxSize = moov.readUInt32BE(offset);
    const boxType = moov.toString('latin1', offset + 4, offset + 8);
    if (boxSize < 8) return undefined;
    if (boxType === 'mvhd') {
      const version = moov.readUInt8(offset + 8);
      const seconds =
        version === 1 ? Number(moov.readBigUInt64BE(offset + 12)) : moov.readUInt32BE(offset + 12);
      if (!seconds) return undefined;
      const iso = new Date((seconds - MP4_EPOCH_OFFSET_SECONDS) * 1000).toISOString();
      return { date: iso.slice(0, 10), time: iso.slice(11, 19), offset: '+00:00', source: 'file' };
    }
    offset += boxSize;
  }
  return undefined;
}

/** The first track with a picture: its stored size, swapped when the track is rotated a quarter turn. */
function displaySize(moov: Buffer): VideoSize | undefined {
  for (const trak of childBoxes(moov, 'trak')) {
    const tkhd = childBoxes(trak, 'tkhd')[0];
    if (!tkhd) continue;
    const version = tkhd.readUInt8(0);
    const matrixAt = version === 1 ? 52 : 40;
    if (tkhd.length < matrixAt + 44) continue;
    const a = tkhd.readInt32BE(matrixAt);
    const b = tkhd.readInt32BE(matrixAt + 4);
    const width = tkhd.readUInt32BE(matrixAt + 36) >>> 16;
    const height = tkhd.readUInt32BE(matrixAt + 40) >>> 16;
    if (!width || !height) continue; // audio
    const quarterTurn = a === 0 && b !== 0;
    return quarterTurn ? { width: height, height: width } : { width, height };
  }
  return undefined;
}

/** Bodies of the direct child boxes of the given type. */
function childBoxes(parent: Buffer, type: string): Buffer[] {
  const out: Buffer[] = [];
  let offset = 0;
  while (offset + 8 <= parent.length) {
    const boxSize = parent.readUInt32BE(offset);
    if (boxSize < 8 || offset + boxSize > parent.length) break;
    if (parent.toString('latin1', offset + 4, offset + 8) === type) out.push(parent.subarray(offset + 8, offset + boxSize));
    offset += boxSize;
  }
  return out;
}
