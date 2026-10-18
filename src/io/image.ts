// Browser-only image work (canvas). The size math lives in domain/image-size.ts and is unit-tested.
import { THUMB_LONG_SIDE, fitWithin } from '../domain/image-size';

/** A small JPEG of `photo` for list rows. */
export async function makeThumbnail(photo: Blob, longSide = THUMB_LONG_SIDE): Promise<Blob> {
  const bitmap = await createImageBitmap(photo);
  try {
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
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('thumbnail encode failed'))), 'image/jpeg', 0.82),
    );
  } finally {
    bitmap.close();
  }
}
