import sharp from 'sharp';
import { AppError } from './errors.js';

/** About 40 megapixels: plenty for photos, too small for decompression bombs. */
const MAX_PIXELS = 40_000_000;

/**
 * Opens an upload as an image, refusing anything that isn't one or is absurdly large once decoded.
 * Every upload is re-encoded from this, which also drops any payload hidden in the original file.
 */
export async function openImage(data: Buffer) {
  const img = sharp(data, { limitInputPixels: MAX_PIXELS, failOn: 'error' });
  try {
    const meta = await img.metadata();
    if (!meta.width || !meta.height || !['jpeg', 'png', 'webp', 'heif'].includes(meta.format ?? '')) throw new Error('not an image');
  } catch {
    throw new AppError('invalid_image', 'That file isn’t a photo we can read. Upload a JPEG, PNG, WebP or HEIC image.');
  }
  return img;
}
