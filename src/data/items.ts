// Item add, edit, delete, move, split and duplicate (SPEC v2.0 F7, F16). Each runs in one
// transaction with the list updates it implies, so a failure leaves the phone unchanged.
import { ID_PREFIX, newId } from '../domain/ids';
import { mergeEdit } from '../domain/item-form';
import { pushRecent } from '../domain/lists';
import { QR_PREFIX, barcodeKey, cleanCode } from '../domain/scan';
import { nameKey, type Item } from '../domain/types';
import { validateItem } from '../domain/validate';
import { fromItemRow, toItemRow, type InventoryDb } from './db';
import { addTagsToList } from './places';
import { NO_PHOTO_EDITS, applyPhotoEdits, copyPhotos, deletePhotosOf, type PhotoEdits } from './photos';

function fail(message: string): never {
  throw new Error(message);
}

/** Bins and spots used lately as homes (ids, newest first), for the home picker's quick picks. */
export const RECENT_HOMES = 'recentHomes';

export async function getRecentHomes(db: InventoryDb): Promise<string[]> {
  const row = await db.settings.get(RECENT_HOMES);
  return Array.isArray(row?.value) ? row.value.filter((x): x is string => typeof x === 'string') : [];
}

/** An item's home as one id: its bin, else its spot, else ''. */
export const homeId = (i: Pick<Item, 'binId' | 'spotId'>) => i.binId || i.spotId;

/**
 * Checks the item and fills in the lists where the editor may add to them: a new subcategory
 * and new tags. Its bin, spot and season must exist. Returns the item with its category and
 * subcategory spelled as in the list (names match ignoring capitals, §3).
 */
async function fitToLists(db: InventoryDb, given: Item): Promise<Item> {
  const errors = validateItem(given);
  if (errors.length > 0) fail(errors.map((e) => e.message).join('; '));
  if (given.binId && !(await db.bins.get(given.binId))) fail('That bin was deleted meanwhile.');
  if (given.spotId && !(await db.spots.get(given.spotId))) fail('That spot was removed meanwhile.');
  if (given.seasonId && !(await db.seasons.get(given.seasonId))) fail('That season was removed meanwhile.');

  const cat = (await db.categories.get(given.category)) ?? (await db.categories.toArray()).find((c) => nameKey(c.name) === nameKey(given.category));
  if (!cat) fail(`category "${given.category}" isn't in the category list`);
  let item: Item = { ...given, category: cat.name };
  if (item.subcategory !== '') {
    const listed = cat.subcategories.find((s) => nameKey(s) === nameKey(item.subcategory));
    if (listed) item = { ...item, subcategory: listed };
    else await db.categories.put({ ...cat, subcategories: [...cat.subcategories, item.subcategory] });
  }
  await addTagsToList(db, item.tags);
  return item;
}

async function touch(db: InventoryDb, now: number, home = ''): Promise<void> {
  await db.settings.put({ key: 'lastChangeAt', value: now });
  if (home !== '') await db.settings.put({ key: RECENT_HOMES, value: pushRecent(await getRecentHomes(db), home, 6) });
}

const TABLES = (db: InventoryDb) => [db.items, db.pictures, db.categories, db.bins, db.spots, db.seasons, db.tags, db.settings];

/** Adds a new item, with photos taken in the form. The id must be unused. */
export async function addItem(db: InventoryDb, item: Item, now = Date.now(), photos: PhotoEdits = NO_PHOTO_EDITS): Promise<Item> {
  return db.transaction('rw', TABLES(db), async () => {
    if (await db.items.get(item.id)) fail(`an item with id ${item.id} already exists`);
    const fitted = await fitToLists(db, { ...item, hasPhoto: false });
    await db.items.add(toItemRow(fitted, now));
    await applyPhotoEdits(db, 'item', fitted.id, { add: photos.add, remove: [] }, now);
    await touch(db, now, homeId(fitted));
    return fromItemRow((await db.items.get(fitted.id))!);
  });
}

/**
 * Saves an edit. `base` is the item as the editor loaded it; only the fields that differ from
 * it are applied to the item as stored now (see mergeEdit). Photo changes made in the form are
 * saved in the same transaction.
 */
export async function updateItem(db: InventoryDb, base: Item, edited: Item, now = Date.now(), photos: PhotoEdits = NO_PHOTO_EDITS): Promise<Item> {
  if (base.id !== edited.id) fail('an edit cannot change the item id');
  return db.transaction('rw', TABLES(db), async () => {
    const row = await db.items.get(base.id);
    if (!row) fail('this item was deleted while the editor was open');
    const fitted = await fitToLists(db, mergeEdit(base, edited, fromItemRow(row)));
    await db.items.put(toItemRow(fitted, now));
    await applyPhotoEdits(db, 'item', fitted.id, photos, now);
    await touch(db, now, homeId(fitted) !== homeId(base) ? homeId(fitted) : '');
    return fromItemRow((await db.items.get(fitted.id))!);
  });
}

/** Deletes an item and its photos. No undo: recovery is by restoring a backup (§6). */
export async function deleteItem(db: InventoryDb, id: string, now = Date.now()): Promise<void> {
  await db.transaction('rw', [db.items, db.pictures, db.settings], async () => {
    if (!(await db.items.get(id))) fail(`no item with id ${id}`);
    await db.items.delete(id);
    await deletePhotosOf(db, [id]);
    await db.settings.put({ key: 'lastChangeAt', value: now });
  });
}

/** Where items move to (F7): a bin, a spot (loose), or no home. */
export type Home = { binId: string } | { spotId: string } | 'none';

export const homeFields = (to: Home): Pick<Item, 'binId' | 'spotId'> =>
  to === 'none' ? { binId: '', spotId: '' } : 'binId' in to ? { binId: to.binId, spotId: '' } : { binId: '', spotId: to.spotId };

/**
 * Move (F7): gives the chosen items a new home in one transaction. Items already there stay
 * as they are. Returns how many items changed.
 */
export async function moveItemsHome(db: InventoryDb, ids: readonly string[], to: Home, now = Date.now()): Promise<number> {
  return db.transaction('rw', [db.items, db.bins, db.spots, db.settings], async () => {
    if (ids.length === 0) fail('Choose at least one item to move.');
    const fields = homeFields(to);
    if (fields.binId && !(await db.bins.get(fields.binId))) fail('That bin was deleted meanwhile.');
    if (fields.spotId && !(await db.spots.get(fields.spotId))) fail('That spot was removed meanwhile.');
    const unique = [...new Set(ids)];
    const rows = await db.items.bulkGet(unique);
    const gone = rows.filter((r) => !r).length;
    if (gone > 0) fail(`${gone} of the chosen items ${gone === 1 ? 'was' : 'were'} deleted meanwhile. Nothing was moved.`);
    const moving = rows.filter((r) => r!.binId !== fields.binId || r!.spotId !== fields.spotId).map((r) => ({ ...r!, ...fields, updatedAt: now }));
    await db.items.bulkPut(moving);
    await touch(db, now, homeId(fields));
    return moving.length;
  });
}

async function freshItemId(db: InventoryDb): Promise<string> {
  const taken = new Set((await db.items.toCollection().primaryKeys()) as string[]);
  return newId(ID_PREFIX.item, (x) => taken.has(x));
}

/**
 * Split a line (F16): takes `count` out of an item into a new item with the same details, in
 * `to` (or the same home). The original keeps the rest. Photos are not copied. Returns the new item.
 */
export async function splitItem(db: InventoryDb, id: string, count: number, to: Home | null, now = Date.now()): Promise<Item> {
  return db.transaction('rw', TABLES(db), async () => {
    const row = (await db.items.get(id)) ?? fail('This item was deleted meanwhile.');
    if (!Number.isSafeInteger(count) || count < 1) fail('Take out at least 1.');
    if (count >= row.quantity) fail(`Take out fewer than ${row.quantity}, so some stay in this line.`);
    const home = to === null ? { binId: row.binId, spotId: row.spotId } : homeFields(to);
    const part: Item = { ...fromItemRow(row), ...home, id: await freshItemId(db), quantity: count, hasPhoto: false, barcode: '' };
    const fitted = await fitToLists(db, part);
    await db.items.put({ ...row, quantity: row.quantity - count, updatedAt: now });
    await db.items.add(toItemRow(fitted, now));
    await touch(db, now, to === null ? '' : homeId(home));
    return fitted;
  });
}

/**
 * Duplicate (F16): a copy with a new id and the same home, details and photos. The barcode
 * isn't copied, so a scan stays unambiguous. Returns the copy.
 */
export async function duplicateItem(db: InventoryDb, id: string, now = Date.now()): Promise<Item> {
  return db.transaction('rw', TABLES(db), async () => {
    const row = (await db.items.get(id)) ?? fail('This item was deleted meanwhile.');
    const copy: Item = { ...fromItemRow(row), id: await freshItemId(db), name: `${row.name} (copy)`, barcode: '' };
    await db.items.add(toItemRow(copy, now));
    await copyPhotos(db, id, 'item', copy.id, now);
    await touch(db, now);
    return copy;
  });
}

/**
 * Attaches a scanned product barcode to an item (F3). Refused when another item already has
 * the same code, so a scan never becomes ambiguous by accident.
 */
export async function setBarcode(db: InventoryDb, id: string, code: string, now = Date.now()): Promise<Item> {
  const clean = cleanCode(code);
  if (clean === '') fail('the barcode is empty');
  if (clean.toLowerCase().startsWith(QR_PREFIX)) fail('that is a household QR label, not a product barcode');
  return db.transaction('rw', [db.items, db.settings], async () => {
    const row = await db.items.get(id);
    if (!row) fail(`no item with id ${id}`);
    const key = barcodeKey(clean);
    const other = (await db.items.toArray()).find((i) => i.id !== id && i.barcode !== '' && barcodeKey(i.barcode) === key);
    if (other) fail(`barcode ${clean} is already on “${other.name}”`);
    await db.items.put({ ...row, barcode: clean, updatedAt: now });
    await db.settings.put({ key: 'lastChangeAt', value: now });
    return fromItemRow({ ...row, barcode: clean });
  });
}
