// Browser-only image work (canvas). The size math lives in domain/image-size.ts and is unit-tested.
import { PHOTO_LONG_SIDE, PHOTO_QUALITY, THUMB_LONG_SIDE, THUMB_QUALITY, fitWithin, pickedFileProblem } from '../domain/image-size';

/** Draws `bitmap` scaled to fit `longSide` and encodes it as JPEG. */
async function encodeJpeg(bitmap: ImageBitmap, longSide: number, quality: number): Promise<Blob> {
  const { width, height } = fitWithin(bitmap.width, bitmap.height, longSide);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2D canvas');
  // White behind transparent PNGs, since JPEG has no alpha.
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, width, height);
  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('JPEG encode failed'))), 'image/jpeg', quality),
  );
}

/** A small JPEG of `photo` for list rows. */
export async function makeThumbnail(photo: Blob, longSide = THUMB_LONG_SIDE): Promise<Blob> {
  const bitmap = await createImageBitmap(photo);
  try {
    return await encodeJpeg(bitmap, longSide, THUMB_QUALITY);
  } finally {
    bitmap.close();
  }
}

/**
 * A picked or camera file → the stored photo (JPEG, about 1024 px on the long side, §8) and
 * its thumbnail, decoded once. The camera's EXIF rotation is applied, so the photo is upright.
 * Throws an Error with a message for the user when the file can't be used.
 */
export async function preparePhoto(file: Blob): Promise<{ full: Blob; thumb: Blob }> {
  const problem = pickedFileProblem(file);
  if (problem) throw new Error(problem);
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('This tablet can’t read that picture. Try a JPEG or PNG, or take a new photo.');
  }
  try {
    return { full: await encodeJpeg(bitmap, PHOTO_LONG_SIDE, PHOTO_QUALITY), thumb: await encodeJpeg(bitmap, THUMB_LONG_SIDE, THUMB_QUALITY) };
  } finally {
    bitmap.close();
  }
}
