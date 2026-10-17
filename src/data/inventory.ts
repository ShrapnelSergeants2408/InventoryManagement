// Inventory reads and writes. Multi-table writes run in one transaction so a
// failure leaves the tablet unchanged (stage4-plan §3).
import type { Category, Item, Location, Supplier } from '../domain/types';
import { validateItem } from '../domain/validate';
import { fromItemRow, toItemRow, toLocationRow, toSupplierRow, type InventoryDb } from './db';

export interface InventorySnapshot {
  items: Item[];
  suppliers: Supplier[];
  locations: Location[];
  categories: Category[];
}

export async function loadSnapshot(db: InventoryDb): Promise<InventorySnapshot> {
  return db.transaction('r', [db.items, db.suppliers, db.locations, db.categories], async () => ({
    items: (await db.items.toArray()).map(fromItemRow),
    suppliers: (await db.suppliers.toArray()).map(({ key: _k, ...s }) => s),
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
}

/**
 * Replaces every item, photo and list in one transaction (starter catalog load, F22;
 * restore, F17). Settings — including the PIN — are not touched.
 */
export async function replaceAll(db: InventoryDb, input: ReplaceAllInput, now = Date.now()): Promise<void> {
  const supplierNames = input.suppliers.map((s) => s.name);
  for (const item of input.items) {
    const errors = validateItem(item, supplierNames);
    if (errors.length > 0) throw new Error(`item ${item.id}: ${errors.map((e) => e.message).join('; ')}`);
  }
  await db.transaction('rw', [db.items, db.photos, db.suppliers, db.locations, db.categories, db.settings], async () => {
    await Promise.all([db.items.clear(), db.photos.clear(), db.suppliers.clear(), db.locations.clear(), db.categories.clear()]);
    await db.items.bulkAdd(input.items.map((i) => toItemRow({ ...i, hasPhoto: input.photos.has(i.id) }, now)));
    await db.photos.bulkAdd([...input.photos].map(([itemId, full]) => ({ itemId, full, thumb: null, updatedAt: now })));
    await db.suppliers.bulkAdd(input.suppliers.map(toSupplierRow));
    await db.locations.bulkAdd(input.locations.map(toLocationRow));
    await db.categories.bulkAdd(input.categories);
    await db.settings.put({ key: 'lastChangeAt', value: now });
  });
}

/** Quick adjust (F3): sets on_hand only. Does not set last_counted (spec-questions Q7). */
export async function setOnHand(db: InventoryDb, id: string, onHand: number, now = Date.now()): Promise<void> {
  if (!Number.isSafeInteger(onHand) || onHand < 0) throw new RangeError('on hand must be a whole number ≥ 0');
  await db.transaction('rw', db.items, db.settings, async () => {
    const n = await db.items.update(id, { onHand, updatedAt: now });
    if (n === 0) throw new Error(`no item with id ${id}`);
    await db.settings.put({ key: 'lastChangeAt', value: now });
  });
}
