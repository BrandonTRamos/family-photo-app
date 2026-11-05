import sharp from 'sharp';

interface PhotoOptions {
  dateTimeOriginal?: string; // EXIF format 'YYYY:MM:DD HH:MM:SS'
  offset?: string;
  gps?: boolean;
  orientation?: number;
  width?: number;
  height?: number;
  color?: string;
}

export async function photo(opts: PhotoOptions = {}): Promise<Buffer> {
  const exif: Record<string, Record<string, string>> = {};
  if (opts.dateTimeOriginal) {
    exif.IFD2 = { DateTimeOriginal: opts.dateTimeOriginal };
    if (opts.offset) exif.IFD2.OffsetTimeOriginal = opts.offset;
  }
  if (opts.gps) {
    exif.IFD3 = { GPSLatitudeRef: 'N', GPSLatitude: '51/1 30/1 0/1', GPSLongitudeRef: 'W', GPSLongitude: '0/1 7/1 0/1' };
  }
  let img = sharp({
    create: { width: opts.width ?? 600, height: opts.height ?? 400, channels: 3, background: opts.color ?? '#88aacc' },
  }).jpeg();
  if (Object.keys(exif).length) img = img.withExif(exif);
  if (opts.orientation) img = img.withMetadata({ orientation: opts.orientation });
  return img.toBuffer();
}

export async function pngWithoutDate(): Promise<Buffer> {
  return sharp({ create: { width: 320, height: 240, channels: 3, background: '#c9ad80' } }).png().toBuffer();
}

/** Minimal MP4: ftyp, moov/mvhd with a creation time, and an mdat payload. */
export function mp4(
  opts: {
    createdUtc?: string;
    appleCreationDate?: string;
    payloadBytes?: number;
    /** A video track as phones write it: stored size plus a rotation matrix. */
    video?: { width: number; height: number; rotation?: 0 | 90 | 180 | 270 };
  } = {},
): Buffer {
  const box = (type: string, body: Buffer) => {
    const header = Buffer.alloc(8);
    header.writeUInt32BE(body.length + 8, 0);
    header.write(type, 4, 'latin1');
    return Buffer.concat([header, body]);
  };
  const ftyp = box('ftyp', Buffer.from('isom\0\0\x02\0isomiso2mp41', 'latin1'));
  const mvhd = Buffer.alloc(100);
  const seconds = opts.createdUtc ? Math.floor(Date.parse(opts.createdUtc) / 1000) + 2082844800 : 0;
  mvhd.writeUInt32BE(seconds, 4);
  mvhd.writeUInt32BE(seconds, 8);
  mvhd.writeUInt32BE(1000, 12);
  mvhd.writeUInt32BE(45000, 16);
  const children = [box('mvhd', mvhd)];
  if (opts.video) {
    const tkhd = Buffer.alloc(84);
    const [a, b] = { 0: [1, 0], 90: [0, 1], 180: [-1, 0], 270: [0, -1] }[opts.video.rotation ?? 0];
    const fixed = (n: number) => (n * 0x10000) | 0;
    tkhd.writeInt32BE(fixed(a), 40); // matrix a
    tkhd.writeInt32BE(fixed(b), 44); // matrix b
    tkhd.writeInt32BE(fixed(-b), 52); // matrix c
    tkhd.writeInt32BE(fixed(a), 56); // matrix d
    tkhd.writeInt32BE(0x40000000, 72); // matrix w
    tkhd.writeUInt32BE(opts.video.width * 0x10000, 76);
    tkhd.writeUInt32BE(opts.video.height * 0x10000, 80);
    const soundTkhd = Buffer.alloc(84); // audio tracks have no size
    children.push(box('trak', box('tkhd', soundTkhd)), box('trak', box('tkhd', tkhd)));
  }
  if (opts.appleCreationDate) {
    children.push(box('meta', Buffer.from(`keys\0com.apple.quicktime.creationdate\0ilst\0${opts.appleCreationDate}`, 'latin1')));
  }
  const moov = box('moov', Buffer.concat(children));
  const mdat = box('mdat', Buffer.alloc(opts.payloadBytes ?? 1024, 7));
  return Buffer.concat([ftyp, moov, mdat]);
}
