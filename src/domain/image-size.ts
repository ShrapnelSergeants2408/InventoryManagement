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
