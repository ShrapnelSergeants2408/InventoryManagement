// Photo reads and writes (SPEC §8, F19). Thumbnails are derived data (not in backups):
// made on save, or on first use for imported photos, and kept.
import type { InventoryDb } from './db';

/** A new photo (already resized, see io/image.ts) or removing the current one. */
export type PhotoChange = { full: Blob; thumb: Blob | null } | 'remove';

/**
 * Applies a photo change to an item that exists. Must run inside a rw transaction over
 * items, photos and settings, so the photo row and the item's hasPhoto always agree.
 */
export async function applyPhotoChange(db: InventoryDb, itemId: string, change: PhotoChange, now: number): Promise<void> {
  const row = await db.items.get(itemId);
  if (!row) throw new Error(`no item with id ${itemId}`);
  if (change === 'remove') {
    await db.photos.delete(itemId);
  } else {
    if (!change.full.size) throw new Error('the photo is empty');
    await db.photos.put({ itemId, full: change.full, thumb: change.thumb, updatedAt: now, taken: now });
  }
  await db.items.put({ ...row, hasPhoto: change !== 'remove', updatedAt: now });
  await db.settings.put({ key: 'lastChangeAt', value: now });
}

/** Takes, replaces or removes an item's photo (F19). No PIN (§6). */
export async function setPhoto(db: InventoryDb, itemId: string, change: PhotoChange, now = Date.now()): Promise<void> {
  await db.transaction('rw', db.items, db.photos, db.settings, () => applyPhotoChange(db, itemId, change, now));
}

/**
 * The item's list thumbnail, or null when it has no photo. A missing thumbnail is made
 * from the full photo with `make` and stored, unless the photo changed meanwhile.
 * Storing a thumbnail is not an inventory change, so lastChangeAt is not touched.
 */
export async function getThumbnail(db: InventoryDb, itemId: string, make: (full: Blob) => Promise<Blob>): Promise<Blob | null> {
  const row = await db.photos.get(itemId);
  if (!row) return null;
  if (row.thumb) return row.thumb;
  const thumb = await make(row.full);
  await db.transaction('rw', db.photos, async () => {
    const now = await db.photos.get(itemId);
    if (now && now.updatedAt === row.updatedAt && !now.thumb) await db.photos.update(itemId, { thumb });
  });
  return thumb;
}
