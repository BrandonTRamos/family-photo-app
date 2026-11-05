import exifr from 'exifr';

/** The Capture date a photo carries (YYYY-MM-DD), or null if it has none. */
export async function readFileDate(file: Blob): Promise<string | null> {
  if (!file.type.startsWith('image/')) return null;
  try {
    const tags = await exifr.parse(file, { pick: ['DateTimeOriginal', 'CreateDate'], reviveValues: false });
    const raw = (tags?.DateTimeOriginal ?? tags?.CreateDate) as string | undefined;
    const m = raw && /^(\d{4}):(\d{2}):(\d{2})/.exec(raw);
    return m && m[1] !== '0000' ? `${m[1]}-${m[2]}-${m[3]}` : null;
  } catch {
    return null;
  }
}
