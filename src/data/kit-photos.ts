// Photos for a count kit, made small (v0.27, M32). Dan, 2026-11-17: "with images included the
// helper kits are very large (220+ mb)". A kit holds every item's photo (search and scan reach any
// item), and the tablet keeps its photos at about 1024 px, but a helper phone shows the count
// photo at most 96 CSS px tall and a helper tablet at most 300. So each photo goes in the kit at
// KIT_PHOTO_LONG_SIDE (320 px). The tablet's own photos are never changed.
import type { PhotoRow } from './db';

/** Makes one photo small (a browser canvas: io/image.ts makeKitPhoto). Throws when it can't read it. */
export type Shrink = (full: Blob) => Promise<Blob>;

/** Called after each photo, so a dialog can say how far it got. */
export type KitPhotoProgress = (done: number, total: number) => void;

// Small copies already made this session, by item id, with the photo's save time: Send all kits
// makes each one once, and a second kit soon after is quick. A changed photo has a new updatedAt.
const made = new Map<string, { updatedAt: number; blob: Blob }>();

/**
 * Forgets the small copies (tests). A restore needn't call it: it saves every photo with a new
 * updatedAt, so no copy matches.
 */
export function forgetKitPhotos(): void {
  made.clear();
}

/**
 * Item id → the photo to put in the kit: the small copy, or the stored photo when that is smaller
 * already or can't be read (as before M32, so a photo is never lost from a kit).
 */
export async function kitPhotos(rows: readonly Pick<PhotoRow, 'itemId' | 'full' | 'updatedAt'>[], shrink: Shrink, onProgress?: KitPhotoProgress): Promise<Map<string, Blob>> {
  const out = new Map<string, Blob>();
  let done = 0;
  for (const row of rows) {
    const cached = made.get(row.itemId);
    let blob: Blob;
    if (cached && cached.updatedAt === row.updatedAt) blob = cached.blob;
    else {
      try {
        const small = await shrink(row.full);
        blob = small.size < row.full.size ? small : row.full;
      } catch {
        blob = row.full;
      }
      made.set(row.itemId, { updatedAt: row.updatedAt, blob });
    }
    out.set(row.itemId, blob);
    onProgress?.(++done, rows.length);
  }
  return out;
}
