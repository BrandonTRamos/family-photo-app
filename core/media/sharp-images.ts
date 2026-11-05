import sharp from 'sharp';
import type { ImageProcessor, ProcessedImage } from '../ports.js';

const DISPLAY_MAX = 2048;
const THUMB_SIZE = 400;
const AI_MAX = 768;

/** Sharp drops all metadata (EXIF, GPS, XMP) on output unless asked to keep it. */
export class SharpImageProcessor implements ImageProcessor {
  async process(bytes: Buffer): Promise<ProcessedImage> {
    const oriented = sharp(bytes, { failOn: 'error' }).rotate();
    const display = await oriented
      .clone()
      .resize(DISPLAY_MAX, DISPLAY_MAX, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
    const thumb = await oriented
      .clone()
      .resize(THUMB_SIZE, THUMB_SIZE, { fit: 'cover' })
      .jpeg({ quality: 72, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
    return {
      display: { bytes: display.data, width: display.info.width, height: display.info.height },
      thumb: { bytes: thumb.data, width: thumb.info.width, height: thumb.info.height },
    };
  }

  async forAi(bytes: Buffer): Promise<Buffer> {
    return sharp(bytes).resize(AI_MAX, AI_MAX, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
  }
}
