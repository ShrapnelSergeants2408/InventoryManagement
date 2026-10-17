// Photo reads. Thumbnails are derived data (not in backups): made on first use and kept.
import type { InventoryDb } from './db';

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
