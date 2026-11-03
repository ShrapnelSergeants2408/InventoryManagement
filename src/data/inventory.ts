// Inventory reads and whole-inventory writes. Multi-table writes run in one transaction so a
// failure leaves the phone unchanged.
import { checkData, type HouseholdData } from '../domain/integrity';
import { fromItemRow, fromTagRow, toItemRow, toTagRow, type InventoryDb, type PhotoRow } from './db';

/** Everything the screens show, except photo images. */
export type InventorySnapshot = Omit<HouseholdData, 'photos'>;

const byOrder = <T extends { order: number }>(a: T, b: T) => a.order - b.order;
/** Lists with a part: Household first, then Holiday, each in its order. */
const byPartOrder = <T extends { part: string; order: number }>(a: T, b: T) => (a.part === b.part ? a.order - b.order : a.part === 'household' ? -1 : 1);

/** Both parts' records; a screen takes its part's with `partView`. Lists are in order within each part. */
export async function loadSnapshot(db: InventoryDb): Promise<InventorySnapshot> {
  return db.transaction('r', [db.items, db.areas, db.spots, db.bins, db.seasons, db.tagList, db.categoryList, db.displays, db.seasonTasks, db.seasonRuns], async () => ({
    items: (await db.items.toArray()).map(fromItemRow),
    areas: (await db.areas.toArray()).sort(byPartOrder),
    spots: (await db.spots.toArray()).sort(byOrder),
    bins: await db.bins.toArray(),
    seasons: (await db.seasons.toArray()).sort(byOrder),
    tags: (await db.tagList.toArray()).sort(byPartOrder).map(fromTagRow),
    categories: (await db.categoryList.toArray()).sort(byPartOrder),
    displays: (await db.displays.toArray()).sort(byOrder),
    seasonTasks: (await db.seasonTasks.toArray()).sort(byOrder),
    seasonRuns: await db.seasonRuns.toArray(),
  }));
}

export async function getItem(db: InventoryDb, id: string) {
  const row = await db.items.get(id);
  return row ? fromItemRow(row) : null;
}

export async function itemCount(db: InventoryDb): Promise<number> {
  return db.items.count();
}

export interface ReplaceAllInput extends HouseholdData {
  /** Photo id → image, for the photos in `photos`. */
  images: Map<string, Blob>;
  /** Photo ids the backup named but didn't have: the phone's own image is kept when it has one. */
  missingImages?: readonly string[];
}

/**
 * Replaces every household record and photo in one transaction (first setup, restore F18).
 * A photo with no image (none given, and the phone has none for its id) is dropped. Settings
 * are not touched. Returns how many photos are stored.
 */
export async function replaceAll(db: InventoryDb, input: ReplaceAllInput, now = Date.now()): Promise<number> {
  const problems = checkData(input);
  if (problems.length > 0) throw new Error(problems.slice(0, 5).join('; ') + (problems.length > 5 ? `; and ${problems.length - 5} more` : ''));
  const tables = [db.items, db.areas, db.spots, db.bins, db.seasons, db.tagList, db.pictures, db.categoryList, db.displays, db.seasonTasks, db.seasonRuns, db.settings];
  return db.transaction('rw', tables, async () => {
    const keep = new Set(input.missingImages ?? []);
    const kept = new Map((await db.pictures.bulkGet([...keep])).flatMap((r) => (r ? [[r.id, r] as const] : [])));
    const rows: PhotoRow[] = [];
    for (const p of input.photos) {
      const image = input.images.get(p.id);
      if (image) rows.push({ ...p, full: image, thumb: null, updatedAt: now });
      else {
        const own = kept.get(p.id);
        if (own) rows.push({ ...own, ...p });
      }
    }
    const withPhoto = new Set(rows.filter((r) => r.ownerType === 'item').map((r) => r.ownerId));
    await Promise.all([db.items, db.areas, db.spots, db.bins, db.seasons, db.tagList, db.pictures, db.categoryList, db.displays, db.seasonTasks, db.seasonRuns].map((t) => t.clear()));
    await db.areas.bulkAdd(input.areas);
    await db.spots.bulkAdd(input.spots);
    await db.bins.bulkAdd(input.bins);
    await db.seasons.bulkAdd(input.seasons);
    await db.tagList.bulkAdd(input.tags.map(toTagRow));
    await db.categoryList.bulkAdd(input.categories);
    await db.displays.bulkAdd(input.displays);
    await db.seasonTasks.bulkAdd(input.seasonTasks);
    await db.seasonRuns.bulkAdd(input.seasonRuns);
    await db.items.bulkAdd(input.items.map((i) => toItemRow({ ...i, hasPhoto: withPhoto.has(i.id) }, now)));
    await db.pictures.bulkAdd(rows);
    await db.settings.put({ key: 'lastChangeAt', value: now });
    return rows.length;
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
