// Inventory reads and writes. Multi-table writes run in one transaction so a failure leaves
// the phone unchanged.
import type { Category, Item, Location } from '../domain/types';
import { validateItem } from '../domain/validate';
import { fromItemRow, toItemRow, toLocationRow, type InventoryDb } from './db';

export interface InventorySnapshot {
  items: Item[];
  locations: Location[];
  categories: Category[];
}

export async function loadSnapshot(db: InventoryDb): Promise<InventorySnapshot> {
  return db.transaction('r', [db.items, db.locations, db.categories], async () => ({
    items: (await db.items.toArray()).map(fromItemRow),
    locations: (await db.locations.orderBy('order').toArray()).map(({ key: _k, ...l }) => l),
    categories: await db.categories.orderBy('order').toArray(),
  }));
}

export async function getItem(db: InventoryDb, id: string): Promise<Item | null> {
  const row = await db.items.get(id);
  return row ? fromItemRow(row) : null;
}

export async function itemCount(db: InventoryDb): Promise<number> {
  return db.items.count();
}

export interface ReplaceAllInput extends InventorySnapshot {
  photos: Map<string, Blob>;
  /** Item ids whose photo the ZIP named but didn't have: the phone's own is kept. */
  missingPhotos?: readonly string[];
}

/**
 * Replaces every item, photo and list in one transaction (first setup, restore F18). With
 * `keepPhotos` (a CSV-only restore), `photos` is ignored: the phone's photos are kept for item
 * ids that are still there and the rest are deleted. Otherwise `photos` replaces them, except
 * that the phone keeps its photo for an id in `missingPhotos`. Settings are not touched.
 * Returns how many items have a photo.
 */
export async function replaceAll(db: InventoryDb, input: ReplaceAllInput, now = Date.now(), opts: { keepPhotos?: boolean } = {}): Promise<number> {
  for (const item of input.items) {
    const errors = validateItem(item);
    if (errors.length > 0) throw new Error(`item ${item.id}: ${errors.map((e) => e.message).join('; ')}`);
  }
  const ids = new Set(input.items.map((i) => i.id));
  return db.transaction('rw', [db.items, db.photos, db.locations, db.categories, db.settings], async () => {
    let withPhoto: Set<string>;
    if (opts.keepPhotos) {
      const existing = await db.photos.toCollection().primaryKeys();
      await db.photos.bulkDelete(existing.filter((id) => !ids.has(id)));
      withPhoto = new Set(existing.filter((id) => ids.has(id)));
    } else {
      const keep = new Set((input.missingPhotos ?? []).filter((id) => ids.has(id) && !input.photos.has(id)));
      const existing = await db.photos.toCollection().primaryKeys();
      await db.photos.bulkDelete(existing.filter((id) => !keep.has(id)));
      await db.photos.bulkAdd([...input.photos].map(([itemId, full]) => ({ itemId, full, thumb: null, updatedAt: now })));
      withPhoto = new Set([...input.photos.keys(), ...existing.filter((id) => keep.has(id))]);
    }
    await Promise.all([db.items.clear(), db.locations.clear(), db.categories.clear()]);
    await db.items.bulkAdd(input.items.map((i) => toItemRow({ ...i, hasPhoto: withPhoto.has(i.id) }, now)));
    await db.locations.bulkAdd(input.locations.map(toLocationRow));
    await db.categories.bulkAdd(input.categories);
    await db.settings.put({ key: 'lastChangeAt', value: now });
    return input.items.filter((i) => withPhoto.has(i.id)).length;
  });
}

/** Sets an item's quantity (the stepper's typed value). */
export async function setQuantity(db: InventoryDb, id: string, value: number, now = Date.now()): Promise<void> {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('quantity must be a whole number ≥ 0');
  await db.transaction('rw', db.items, db.settings, async () => {
    const n = await db.items.update(id, { quantity: value, updatedAt: now });
    if (n === 0) throw new Error(`no item with id ${id}`);
    await db.settings.put({ key: 'lastChangeAt', value: now });
  });
}

/**
 * ± on the quantity: read-modify-write in one transaction, so fast repeated taps never lose a
 * step. Never goes below 0. Returns the new value.
 */
export async function adjustQuantity(db: InventoryDb, id: string, delta: number, now = Date.now()): Promise<number> {
  if (!Number.isSafeInteger(delta)) throw new RangeError('adjustment must be a whole number');
  return db.transaction('rw', db.items, db.settings, async () => {
    const row = await db.items.get(id);
    if (!row) throw new Error(`no item with id ${id}`);
    const value = Math.max(0, row.quantity + delta);
    if (value !== row.quantity) {
      await db.items.update(id, { quantity: value, updatedAt: now });
      await db.settings.put({ key: 'lastChangeAt', value: now });
    }
    return value;
  });
}
