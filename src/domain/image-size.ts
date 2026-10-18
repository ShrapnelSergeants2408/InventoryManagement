// Resize math for photos (SPEC §8) and list thumbnails.

/** Full photos are about 1024 px on the long side (§8). */
export const PHOTO_LONG_SIDE = 1024;
/** List thumbnails: shown at 64 CSS px, so 160 px covers a 2.5× screen. */
export const THUMB_LONG_SIDE = 160;

/** Scales to fit within `max` on the long side, keeping the aspect ratio. Never upscales; at least 1 px. */
export function fitWithin(width: number, height: number, max: number): { width: number; height: number } {
  if (!(width > 0 && height > 0)) throw new RangeError(`bad image size ${width}×${height}`);
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** JPEG quality for full photos and thumbnails. */
export const PHOTO_QUALITY = 0.85;
export const THUMB_QUALITY = 0.82;
/** Larger picked files are refused before decoding (a phone camera JPEG is 3–10 MB). */
export const MAX_PICKED_BYTES = 40 * 1024 * 1024;

/**
 * Why a picked file can't be used as a photo, or null if it can be tried. An empty type is
 * allowed (some gallery apps don't send one); decoding then decides.
 */
export function pickedFileProblem(file: { type: string; size: number }): string | null {
  if (file.size === 0) return 'That file is empty.';
  if (file.type !== '' && !file.type.startsWith('image/')) return 'That file isn’t a picture. Choose a photo (JPEG or PNG).';
  if (file.size > MAX_PICKED_BYTES) return `That picture is too large (over ${MAX_PICKED_BYTES / 1024 / 1024} MB).`;
  return null;
}
