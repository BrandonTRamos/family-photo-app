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
export function mp4(opts: { createdUtc?: string; appleCreationDate?: string; payloadBytes?: number } = {}): Buffer {
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
  if (opts.appleCreationDate) {
    children.push(box('meta', Buffer.from(`keys\0com.apple.quicktime.creationdate\0ilst\0${opts.appleCreationDate}`, 'latin1')));
  }
  const moov = box('moov', Buffer.concat(children));
  const mdat = box('mdat', Buffer.alloc(opts.payloadBytes ?? 1024, 7));
  return Buffer.concat([ftyp, moov, mdat]);
}
