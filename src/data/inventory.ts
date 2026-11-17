// Inventory reads and writes. Multi-table writes run in one transaction so a
// failure leaves the tablet unchanged (stage4-plan §3).
import type { Category, Item, Location, Supplier } from '../domain/types';
import { withoutMissingItems, type NamedOrderList } from '../domain/order-lists';
import { validateItem } from '../domain/validate';
import { fromItemRow, fromOrderListRow, toItemRow, toLocationRow, toOrderListRow, toSupplierRow, type InventoryDb, type ItemRow } from './db';

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
  /** Item ids whose photo the ZIP named but didn't have: the tablet's own is kept (Stage 5 finding 5). */
  missingPhotos?: readonly string[];
}

/**
 * Replaces every item, photo and list in one transaction (starter catalog load, F22;
 * restore, F17). With `keepPhotos` (a CSV-only restore), `photos` is ignored: the tablet's
 * photos are kept for item ids that are still there and the rest are deleted (Q5).
 * Otherwise `photos` replaces them, except that the tablet keeps its photo for an id in
 * `missingPhotos`.
 * Named order lists (F27): `orderLists` replaces them (a full backup); without it they're
 * kept, minus lines for items that are gone (a CSV-only restore, §15 Q7d).
 * Settings — including the PIN — are not touched. Returns how many items have a photo.
 */
export async function replaceAll(
  db: InventoryDb,
  input: ReplaceAllInput,
  now = Date.now(),
  opts: {
    keepPhotos?: boolean;
    orderLists?: readonly NamedOrderList[];
    /**
     * v0.29 (M34): `photos` aren't stored here; the caller stores them after its transaction with
     * savePhotosInBatches. Until then an item keeps the photo it had, if any.
     */
    deferPhotos?: boolean;
  } = {},
): Promise<number> {
  const supplierNames = input.suppliers.map((s) => s.name);
  for (const item of input.items) {
    const errors = validateItem(item, supplierNames);
    if (errors.length > 0) throw new Error(`item ${item.id}: ${errors.map((e) => e.message).join('; ')}`);
  }
  const ids = new Set(input.items.map((i) => i.id));
  return db.transaction('rw', [db.items, db.photos, db.suppliers, db.locations, db.categories, db.orderLists, db.settings], async () => {
    const lists = opts.orderLists ?? (await db.orderLists.toArray()).map(fromOrderListRow);
    await db.orderLists.clear();
    await db.orderLists.bulkAdd(lists.map((l) => toOrderListRow(withoutMissingItems(l, ids))));
    let withPhoto: Set<string>;
    if (opts.keepPhotos) {
      const existing = await db.photos.toCollection().primaryKeys();
      await db.photos.bulkDelete(existing.filter((id) => !ids.has(id)));
      withPhoto = new Set(existing.filter((id) => ids.has(id)));
    } else {
      const keep = new Set((input.missingPhotos ?? []).filter((id) => ids.has(id) && !input.photos.has(id)));
      const existing = await db.photos.toCollection().primaryKeys();
      if (opts.deferPhotos) {
        // The old photo stays until its new one is stored, so a refused batch never loses a photo.
        const stay = new Set(existing.filter((id) => keep.has(id) || (ids.has(id) && input.photos.has(id))));
        await db.photos.bulkDelete(existing.filter((id) => !stay.has(id)));
        withPhoto = stay;
      } else {
        await db.photos.bulkDelete(existing.filter((id) => !keep.has(id)));
        await db.photos.bulkAdd([...input.photos].map(([itemId, full]) => ({ itemId, full, thumb: null, updatedAt: now })));
        withPhoto = new Set([...input.photos.keys(), ...existing.filter((id) => keep.has(id))]);
      }
    }
    await Promise.all([db.items.clear(), db.suppliers.clear(), db.locations.clear(), db.categories.clear()]);
    await db.items.bulkAdd(input.items.map((i) => toItemRow({ ...i, hasPhoto: withPhoto.has(i.id) }, now)));
    await db.suppliers.bulkAdd(input.suppliers.map(toSupplierRow));
    await db.locations.bulkAdd(input.locations.map(toLocationRow));
    await db.categories.bulkAdd(input.categories);
    await db.settings.put({ key: 'lastChangeAt', value: now });
    return input.items.filter((i) => withPhoto.has(i.id)).length;
  });
}

/** How many photos were stored; `error` when the browser refused a batch and it stopped. */
export interface PhotoSave {
  photosSaved: number;
  photosTotal: number;
  error?: string;
}

/** Called after each batch: photos stored so far, of how many. */
export type PhotoSaveProgress = (saved: number, total: number) => void;

export const PHOTO_BATCH = 50;

/**
 * Stores photos PHOTO_BATCH at a time (v0.29, M34), each batch with its items' hasPhoto in its
 * own transaction. Android Chrome refused 1533 photo Blobs in one transaction ("UnknownError:
 * Error preparing Blob/File data to be stored in object store"), which stopped a helper kit
 * opening and would stop a restore. Stops at the first refused batch; what was stored stays, and
 * an item whose new photo wasn't stored keeps its old one (replaceAll deferPhotos).
 */
export async function savePhotosInBatches(db: InventoryDb, photos: ReadonlyMap<string, Blob>, now: number, onProgress?: PhotoSaveProgress): Promise<PhotoSave> {
  const all = [...photos];
  let saved = 0;
  onProgress?.(0, all.length);
  for (let i = 0; i < all.length; i += PHOTO_BATCH) {
    const batch = all.slice(i, i + PHOTO_BATCH);
    try {
      await db.transaction('rw', db.items, db.photos, async () => {
        const there = new Set((await db.items.bulkGet(batch.map(([id]) => id))).flatMap((r) => (r ? [r.id] : [])));
        const rows = batch.filter(([id]) => there.has(id)).map(([itemId, full]) => ({ itemId, full, thumb: null, updatedAt: now }));
        await db.photos.bulkPut(rows);
        await db.items.where('id').anyOf([...there]).modify({ hasPhoto: true });
        saved += rows.length;
      });
    } catch (e) {
      return { photosSaved: saved, photosTotal: all.length, error: e instanceof Error ? e.message : String(e) };
    }
    onProgress?.(saved, all.length);
  }
  return { photosSaved: saved, photosTotal: all.length };
}

/** How many items have a photo now. */
export async function itemsWithPhoto(db: InventoryDb): Promise<number> {
  return db.items.filter((i) => i.hasPhoto).count();
}

/** The counts a stepper can change without the PIN (F3; desired and spares on the detail card, F7). */
export type CountField = 'onHand' | 'desired' | 'spares';

const COUNT_LABEL: Record<CountField, string> = { onHand: 'on hand', desired: 'desired', spares: 'spares' };

function countPatch(field: CountField, value: number, now: number): Partial<ItemRow> {
  const patch: Partial<ItemRow> = { updatedAt: now };
  patch[field] = value;
  return patch;
}

/** Sets one count. Quick adjust does not set last_counted (spec-questions Q7). */
export async function setCount(db: InventoryDb, id: string, field: CountField, value: number, now = Date.now()): Promise<void> {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${COUNT_LABEL[field]} must be a whole number ≥ 0`);
  await db.transaction('rw', db.items, db.settings, async () => {
    const n = await db.items.update(id, countPatch(field, value, now));
    if (n === 0) throw new Error(`no item with id ${id}`);
    await db.settings.put({ key: 'lastChangeAt', value: now });
  });
}

/**
 * ± on one count: read-modify-write in one transaction, so fast repeated taps never lose
 * a step. Never goes below 0. Returns the new value.
 */
export async function adjustCount(db: InventoryDb, id: string, field: CountField, delta: number, now = Date.now()): Promise<number> {
  if (!Number.isSafeInteger(delta)) throw new RangeError('adjustment must be a whole number');
  return db.transaction('rw', db.items, db.settings, async () => {
    const row = await db.items.get(id);
    if (!row) throw new Error(`no item with id ${id}`);
    const value = Math.max(0, row[field] + delta);
    if (value !== row[field]) {
      await db.items.update(id, countPatch(field, value, now));
      await db.settings.put({ key: 'lastChangeAt', value: now });
    }
    return value;
  });
}

/** Quick adjust (F3): sets on_hand only. */
export const setOnHand = (db: InventoryDb, id: string, onHand: number, now = Date.now()) => setCount(db, id, 'onHand', onHand, now);

/** Quick adjust ± (F3). Returns the new on_hand. */
export const adjustOnHand = (db: InventoryDb, id: string, delta: number, now = Date.now()) => adjustCount(db, id, 'onHand', delta, now);
