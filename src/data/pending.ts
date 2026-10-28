// Pending items on the shop tablet (SPEC §18.5 "Pending items: review"): new items helpers
// added, kept until someone accepts, matches, combines or discards them. They aren't inventory:
// not in the list, the order list, labels or search. No PIN (§6). Every decided id is
// remembered, so importing the same counts file again doesn't bring a decided item back.
import { combinePending, matchCount } from '../domain/import-counts';
import type { PendingRecord } from '../domain/helper-mode';
import type { InventoryDb, PendingItemRow } from './db';

const DECIDED = 'pendingDecided';

const toRow = (p: PendingRecord): PendingItemRow => ({ ...p }) as unknown as PendingItemRow;
const fromRow = (r: PendingItemRow): PendingRecord => ({ ...(r as unknown as PendingRecord) });

/** Pending items, oldest count first. */
export async function loadPending(db: InventoryDb): Promise<PendingRecord[]> {
  return (await db.pendingItems.toArray()).map(fromRow).sort((a, b) => a.countedAt.localeCompare(b.countedAt) || a.id.localeCompare(b.id, 'en-US', { numeric: true }));
}

export async function pendingPhoto(db: InventoryDb, id: string): Promise<Blob | null> {
  return (await db.pendingPhotos.get(id))?.full ?? null;
}

/** Ids accepted, matched, combined away or discarded (inside the caller's transaction for writes). */
export async function decidedPending(db: InventoryDb): Promise<Set<string>> {
  const v = (await db.settings.get(DECIDED))?.value;
  return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
}

async function decide(db: InventoryDb, ids: readonly string[]): Promise<void> {
  const set = await decidedPending(db);
  for (const id of ids) set.add(id);
  await db.settings.put({ key: DECIDED, value: [...set] });
}

/** Adds pending items with their photos (inside the caller's transaction). */
export async function addPendingRows(db: InventoryDb, items: readonly PendingRecord[], photos: ReadonlyMap<string, Blob>): Promise<void> {
  await db.pendingItems.bulkAdd(items.map((p) => toRow({ ...p, hasPhoto: photos.has(p.id) })));
  await db.pendingPhotos.bulkAdd([...photos].filter(([id]) => items.some((p) => p.id === id)).map(([pendingId, full]) => ({ pendingId, full })));
}

/** A full restore (§15 Q7d): the backup's pending items replace the tablet's. */
export async function replacePending(db: InventoryDb, items: readonly PendingRecord[], photos: ReadonlyMap<string, Blob>): Promise<void> {
  await Promise.all([db.pendingItems.clear(), db.pendingPhotos.clear()]);
  await addPendingRows(db, items, photos);
}

/** Removes pending items and records them as decided (inside the caller's transaction). */
export async function removePending(db: InventoryDb, ids: readonly string[]): Promise<void> {
  await db.pendingItems.bulkDelete([...ids]);
  await db.pendingPhotos.bulkDelete([...ids]);
  await decide(db, ids);
}

async function getPending(db: InventoryDb, id: string): Promise<PendingRecord> {
  const row = await db.pendingItems.get(id);
  if (!row) throw new Error('that pending item was already dealt with');
  return fromRow(row);
}

/** Discard (§18.5, after a confirmation). */
export async function discardPending(db: InventoryDb, id: string): Promise<void> {
  await db.transaction('rw', db.pendingItems, db.pendingPhotos, db.settings, async () => {
    await getPending(db, id);
    await removePending(db, [id]);
  });
}

/**
 * Same as an existing item (§18.5): use the pending count as the item's count, or add it. The
 * item's last_counted and counted_by follow; the pending item is removed. Nothing else changes.
 */
export async function matchPending(db: InventoryDb, id: string, itemId: string, how: 'use' | 'add', now = Date.now()): Promise<void> {
  await db.transaction('rw', [db.items, db.pendingItems, db.pendingPhotos, db.settings], async () => {
    const p = await getPending(db, id);
    const row = await db.items.get(itemId);
    if (!row) throw new Error('that item was deleted');
    await db.items.put({ ...row, ...matchCount(row, p, how), updatedAt: now });
    await removePending(db, [id]);
    await db.settings.put({ key: 'lastChangeAt', value: now });
  });
}

/** Combine two pending items into one before accepting (§18.5): `keepId` stays; the other is removed. */
export async function combinePendingItems(db: InventoryDb, keepId: string, otherId: string, how: 'add' | 'keep'): Promise<PendingRecord> {
  if (keepId === otherId) throw new Error('choose two different pending items');
  return db.transaction('rw', db.pendingItems, db.pendingPhotos, db.settings, async () => {
    const keep = await getPending(db, keepId);
    const other = await getPending(db, otherId);
    const merged = combinePending(keep, other, how);
    // The kept item gets the other's photo if it has none.
    if (!keep.hasPhoto && other.hasPhoto) {
      const photo = await db.pendingPhotos.get(otherId);
      if (photo) {
        await db.pendingPhotos.put({ pendingId: keepId, full: photo.full });
        merged.hasPhoto = true;
      }
    }
    await db.pendingItems.put(toRow(merged));
    await removePending(db, [otherId]);
    return merged;
  });
}
