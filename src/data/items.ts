// Item add, edit and delete (F6, F7, F8). Each runs in one transaction with the list
// updates it implies, so a failure leaves the tablet unchanged.
import { mergeEdit } from '../domain/item-form';
import { pushRecent } from '../domain/lists';
import { QR_PREFIX, barcodeKey, cleanCode } from '../domain/scan';
import { nameKey, type Item } from '../domain/types';
import { validateItem } from '../domain/validate';
import { fromItemRow, toItemRow, toLocationRow, type InventoryDb } from './db';
import { applyPhotoChange, type PhotoChange } from './photos';

export const RECENT_LOCATIONS = 'recentLocations';

export async function getRecentLocations(db: InventoryDb): Promise<string[]> {
  const row = await db.settings.get(RECENT_LOCATIONS);
  return Array.isArray(row?.value) ? row.value.filter((x): x is string => typeof x === 'string') : [];
}

/**
 * Checks the item against the lists and fills them in where the editor may add to them:
 * a new subcategory (F6) and a location typed in the editor (F25: anyone can add one).
 * Returns the item with its category, subcategory and location spelled as in the lists
 * (names match ignoring capitals, §3; Stage 5 finding 2).
 */
async function fitToLists(db: InventoryDb, given: Item): Promise<Item> {
  const suppliers = (await db.suppliers.toArray()).map((s) => s.name);
  const errors = validateItem(given, suppliers);
  if (errors.length > 0) throw new Error(errors.map((e) => e.message).join('; '));

  const cat = (await db.categories.get(given.category)) ?? (await db.categories.toArray()).find((c) => nameKey(c.name) === nameKey(given.category));
  if (!cat) throw new Error(`category "${given.category}" isn't in the category list`);
  let item: Item = { ...given, category: cat.name };
  if (item.subcategory !== '') {
    const listed = cat.subcategories.find((s) => nameKey(s) === nameKey(item.subcategory));
    if (listed) item = { ...item, subcategory: listed };
    else await db.categories.put({ ...cat, subcategories: [...cat.subcategories, item.subcategory] });
  }

  if (item.location === '') return item;
  const loc = await db.locations.get(nameKey(item.location));
  if (loc) return { ...item, location: loc.name };
  const last = await db.locations.orderBy('order').last();
  await db.locations.add(toLocationRow({ name: item.location, notes: '', order: last ? last.order + 1 : 0 }));
  return item;
}

async function touch(db: InventoryDb, item: Item, now: number): Promise<void> {
  await db.settings.put({ key: 'lastChangeAt', value: now });
  if (item.location !== '') {
    await db.settings.put({ key: RECENT_LOCATIONS, value: pushRecent(await getRecentLocations(db), item.location) });
  }
}

const TABLES = (db: InventoryDb) => [db.items, db.photos, db.suppliers, db.categories, db.locations, db.settings];

/** Adds a new item (F6), with its photo if one was taken in the form. The id must be unused. */
export async function addItem(db: InventoryDb, item: Item, now = Date.now(), photo?: PhotoChange): Promise<Item> {
  return db.transaction('rw', TABLES(db), async () => {
    if (await db.items.get(item.id)) throw new Error(`an item with id ${item.id} already exists`);
    const fitted = await fitToLists(db, { ...item, hasPhoto: false });
    await db.items.add(toItemRow(fitted, now));
    await touch(db, fitted, now);
    if (!photo) return fitted;
    await applyPhotoChange(db, fitted.id, photo, now);
    return { ...fitted, hasPhoto: photo !== 'remove' };
  });
}

/**
 * Saves an edit (F7). `base` is the item as the editor loaded it; only the fields that
 * differ from it are applied to the item as stored now (see mergeEdit). A photo change made
 * in the form is saved in the same transaction.
 */
export async function updateItem(db: InventoryDb, base: Item, edited: Item, now = Date.now(), photo?: PhotoChange): Promise<Item> {
  if (base.id !== edited.id) throw new Error('an edit cannot change the item id');
  return db.transaction('rw', TABLES(db), async () => {
    const row = await db.items.get(base.id);
    if (!row) throw new Error('this item was deleted while the editor was open');
    const fitted = await fitToLists(db, mergeEdit(base, edited, fromItemRow(row)));
    await db.items.put(toItemRow(fitted, now));
    await touch(db, fitted, now);
    if (!photo) return fitted;
    await applyPhotoChange(db, fitted.id, photo, now);
    return { ...fitted, hasPhoto: photo !== 'remove' };
  });
}

/** Deletes an item and its photo (F8). No undo: recovery is by restoring a backup. */
export async function deleteItem(db: InventoryDb, id: string, now = Date.now()): Promise<void> {
  await db.transaction('rw', db.items, db.photos, db.settings, async () => {
    if (!(await db.items.get(id))) throw new Error(`no item with id ${id}`);
    await db.items.delete(id);
    await db.photos.delete(id);
    await db.settings.put({ key: 'lastChangeAt', value: now });
  });
}

/**
 * Attaches a scanned manufacturer barcode to an item (F21; no PIN, §6). Refused when another
 * item already has the same code, so a scan never becomes ambiguous by accident.
 */
export async function setBarcode(db: InventoryDb, id: string, code: string, now = Date.now()): Promise<Item> {
  const clean = cleanCode(code);
  if (clean === '') throw new Error('the barcode is empty');
  if (clean.toLowerCase().startsWith(QR_PREFIX)) throw new Error('that is a team QR label, not a manufacturer barcode');
  return db.transaction('rw', db.items, db.settings, async () => {
    const row = await db.items.get(id);
    if (!row) throw new Error(`no item with id ${id}`);
    const key = barcodeKey(clean);
    const other = (await db.items.toArray()).find((i) => i.id !== id && i.barcode !== '' && barcodeKey(i.barcode) === key);
    if (other) throw new Error(`barcode ${clean} is already on “${other.name}”`);
    await db.items.put({ ...row, barcode: clean, updatedAt: now });
    await db.settings.put({ key: 'lastChangeAt', value: now });
    return fromItemRow({ ...row, barcode: clean });
  });
}
