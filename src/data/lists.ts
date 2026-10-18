// Supplier, location and category list changes (F23, F25, F9). A rename or remove rewrites
// every affected item in the same transaction as the list, so the two never disagree.
import {
  checkName,
  isOtherSupplier,
  itemsIn,
  moveBy,
  moveItems,
  reassignLocation,
  reassignSupplier,
  renameCategoryItems,
  renameSubcategoryItems,
  renumber,
  type CategoryPlace,
} from '../domain/lists';
import { nameKey, type Item, type Location, type Supplier } from '../domain/types';
import { normalizeUrl } from '../domain/url';
import { fromItemRow, toItemRow, toLocationRow, toSupplierRow, type InventoryDb } from './db';
import { RECENT_LOCATIONS, getRecentLocations } from './items';

function fail(message: string): never {
  throw new Error(message);
}

async function allItems(db: InventoryDb): Promise<Item[]> {
  return (await db.items.toArray()).map(fromItemRow);
}

async function saveItems(db: InventoryDb, items: readonly Item[], now: number): Promise<void> {
  if (items.length > 0) await db.items.bulkPut(items.map((i) => toItemRow(i, now)));
}

const touch = (db: InventoryDb, now: number) => db.settings.put({ key: 'lastChangeAt', value: now });

// ── Suppliers (F23; PIN required for add, rename and remove — the UI asks first) ──

function cleanSupplier(s: Supplier, existing: readonly string[], self?: string): Supplier {
  const name = checkName(s.name, existing, 'Supplier', self);
  if (!name.ok) return fail(name.error);
  const site = normalizeUrl(s.website, 'Website');
  if (!site.ok) return fail(`${site.error}.`);
  return { name: name.name, website: site.url, notes: s.notes.trim() };
}

export async function addSupplier(db: InventoryDb, s: Supplier, now = Date.now()): Promise<Supplier> {
  return db.transaction('rw', db.suppliers, db.settings, async () => {
    const clean = cleanSupplier(s, (await db.suppliers.toArray()).map((x) => x.name));
    await db.suppliers.add(toSupplierRow(clean));
    await touch(db, now);
    return clean;
  });
}

/** Changes a supplier's name, website and notes. A new name is written into every vendor option that used the old one. */
export async function updateSupplier(db: InventoryDb, oldName: string, next: Supplier, now = Date.now()): Promise<Supplier> {
  return db.transaction('rw', db.suppliers, db.items, db.settings, async () => {
    const row = (await db.suppliers.get(nameKey(oldName))) ?? fail(`supplier "${oldName}" isn't in the list`);
    const clean = cleanSupplier(next, (await db.suppliers.toArray()).map((x) => x.name), row.name);
    if (isOtherSupplier(row.name) && clean.name !== row.name) fail('“other” is the fallback supplier and keeps its name.');
    await db.suppliers.delete(row.key);
    await db.suppliers.add(toSupplierRow(clean));
    await saveItems(db, reassignSupplier(await allItems(db), row.name, clean.name), now);
    await touch(db, now);
    return clean;
  });
}

/** Removes a supplier; vendor options that used it move to `replacement` (default `other`, F23). */
export async function removeSupplier(db: InventoryDb, name: string, replacement: string, now = Date.now()): Promise<number> {
  return db.transaction('rw', db.suppliers, db.items, db.settings, async () => {
    const row = (await db.suppliers.get(nameKey(name))) ?? fail(`supplier "${name}" isn't in the list`);
    if (isOtherSupplier(row.name)) fail('“other” is the fallback supplier and can’t be removed.');
    const to = (await db.suppliers.get(nameKey(replacement))) ?? fail(`replacement supplier "${replacement}" isn't in the list`);
    if (to.key === row.key) fail('Choose a different supplier to move its vendor options to.');
    const changed = reassignSupplier(await allItems(db), row.name, to.name);
    await saveItems(db, changed, now);
    await db.suppliers.delete(row.key);
    await touch(db, now);
    return changed.length;
  });
}

// ── Locations (F25; add and reorder for anyone, rename and remove with the PIN) ──

async function orderedLocations(db: InventoryDb): Promise<Location[]> {
  return (await db.locations.orderBy('order').toArray()).map(({ key: _k, ...l }) => l);
}

async function writeLocations(db: InventoryDb, list: readonly Location[]): Promise<void> {
  await db.locations.clear();
  await db.locations.bulkAdd(renumber(list).map(toLocationRow));
}

/** Adds a location at the end of the walk order. Returns it as stored. */
export async function addLocation(db: InventoryDb, name: string, notes = '', now = Date.now()): Promise<Location> {
  return db.transaction('rw', db.locations, db.settings, async () => {
    const list = await orderedLocations(db);
    const checked = checkName(name, list.map((l) => l.name), 'Location');
    if (!checked.ok) return fail(checked.error);
    const loc = { name: checked.name, notes: notes.trim(), order: list.length };
    await writeLocations(db, [...list, loc]);
    await touch(db, now);
    return loc;
  });
}

/** Renames a location and/or changes its notes; items that used the old name follow. */
export async function updateLocation(db: InventoryDb, oldName: string, name: string, notes: string, now = Date.now()): Promise<void> {
  await db.transaction('rw', db.locations, db.items, db.settings, async () => {
    const list = await orderedLocations(db);
    const at = list.findIndex((l) => nameKey(l.name) === nameKey(oldName));
    if (at < 0) fail(`location "${oldName}" isn't in the list`);
    const checked = checkName(name, list.map((l) => l.name), 'Location', list[at]!.name);
    if (!checked.ok) return fail(checked.error);
    const old = list[at]!.name;
    list[at] = { ...list[at]!, name: checked.name, notes: notes.trim() };
    await writeLocations(db, list);
    await saveItems(db, reassignLocation(await allItems(db), old, checked.name), now);
    const recent = await getRecentLocations(db);
    await db.settings.put({ key: RECENT_LOCATIONS, value: recent.map((r) => (nameKey(r) === nameKey(old) ? checked.name : r)) });
    await touch(db, now);
  });
}

/** Removes a location; its items move to `replacement`, or to "No location" when it is ''. */
export async function removeLocation(db: InventoryDb, name: string, replacement: string, now = Date.now()): Promise<number> {
  return db.transaction('rw', db.locations, db.items, db.settings, async () => {
    const list = await orderedLocations(db);
    const gone = list.find((l) => nameKey(l.name) === nameKey(name)) ?? fail(`location "${name}" isn't in the list`);
    let to = '';
    if (replacement !== '') {
      const target = list.find((l) => nameKey(l.name) === nameKey(replacement)) ?? fail(`location "${replacement}" isn't in the list`);
      if (target === gone) fail('Choose a different location to move its items to.');
      to = target.name;
    }
    const changed = reassignLocation(await allItems(db), gone.name, to);
    await saveItems(db, changed, now);
    await writeLocations(db, list.filter((l) => l !== gone));
    const recent = await getRecentLocations(db);
    await db.settings.put({ key: RECENT_LOCATIONS, value: recent.filter((r) => nameKey(r) !== nameKey(gone.name)) });
    await touch(db, now);
    return changed.length;
  });
}

/** Reorder mode ▲/▼ (F25): moves a location one place in the walk order. */
export async function moveLocation(db: InventoryDb, name: string, delta: number, now = Date.now()): Promise<void> {
  await db.transaction('rw', db.locations, db.settings, async () => {
    const list = await orderedLocations(db);
    const at = list.findIndex((l) => nameKey(l.name) === nameKey(name));
    if (at < 0) fail(`location "${name}" isn't in the list`);
    await writeLocations(db, moveBy(list, at, delta));
    await touch(db, now);
  });
}

// ── Categories (F9; add and reorder for anyone, rename and remove with the PIN) ──

async function orderedCategories(db: InventoryDb) {
  return db.categories.orderBy('order').toArray();
}

async function writeCategories(db: InventoryDb, list: readonly { name: string; order: number; subcategories: string[] }[]): Promise<void> {
  await db.categories.clear();
  await db.categories.bulkAdd(renumber(list));
}

async function categoryOrFail(db: InventoryDb, name: string) {
  return (await db.categories.get(name)) ?? fail(`category "${name}" isn't in the list`);
}

export async function addCategory(db: InventoryDb, name: string, now = Date.now()): Promise<string> {
  return db.transaction('rw', db.categories, db.settings, async () => {
    const list = await orderedCategories(db);
    const checked = checkName(name, list.map((c) => c.name), 'Category');
    if (!checked.ok) return fail(checked.error);
    await writeCategories(db, [...list, { name: checked.name, order: list.length, subcategories: [] }]);
    await touch(db, now);
    return checked.name;
  });
}

export async function renameCategory(db: InventoryDb, oldName: string, name: string, now = Date.now()): Promise<string> {
  return db.transaction('rw', db.categories, db.items, db.settings, async () => {
    const list = await orderedCategories(db);
    const at = list.findIndex((c) => c.name === oldName);
    if (at < 0) fail(`category "${oldName}" isn't in the list`);
    const checked = checkName(name, list.map((c) => c.name), 'Category', oldName);
    if (!checked.ok) return fail(checked.error);
    list[at] = { ...list[at]!, name: checked.name };
    await writeCategories(db, list);
    await saveItems(db, renameCategoryItems(await allItems(db), oldName, checked.name), now);
    await touch(db, now);
    return checked.name;
  });
}

/**
 * Removes a category (F9). One that still holds items needs `moveTo`; its items move
 * there first, in the same transaction.
 */
export async function removeCategory(db: InventoryDb, name: string, moveTo: CategoryPlace | null, now = Date.now()): Promise<number> {
  return db.transaction('rw', db.categories, db.items, db.settings, async () => {
    const list = await orderedCategories(db);
    await categoryOrFail(db, name);
    const items = await allItems(db);
    const held = itemsIn(items, name).length;
    if (held > 0) {
      if (!moveTo) fail(`“${name}” still holds ${held} item${held === 1 ? '' : 's'}; move ${held === 1 ? 'it' : 'them'} first.`);
      if (moveTo.category === name) fail('Choose a place outside the category being removed.');
      const target = await categoryOrFail(db, moveTo.category);
      if (moveTo.subcategory !== '' && !target.subcategories.includes(moveTo.subcategory)) fail(`“${moveTo.subcategory}” isn't a subcategory of ${target.name}`);
      await saveItems(db, moveItems(items, { category: name }, moveTo), now);
    }
    await writeCategories(db, list.filter((c) => c.name !== name));
    await touch(db, now);
    return held;
  });
}

/** Reorder mode ▲/▼ (F9) for categories. */
export async function moveCategory(db: InventoryDb, name: string, delta: number, now = Date.now()): Promise<void> {
  await db.transaction('rw', db.categories, db.settings, async () => {
    const list = await orderedCategories(db);
    const at = list.findIndex((c) => c.name === name);
    if (at < 0) fail(`category "${name}" isn't in the list`);
    await writeCategories(db, moveBy(list, at, delta));
    await touch(db, now);
  });
}

/** Adds a subcategory at the end of its category (anyone, F6/F9). */
export async function addSubcategory(db: InventoryDb, category: string, name: string, now = Date.now()): Promise<string> {
  return db.transaction('rw', db.categories, db.settings, async () => {
    const cat = await categoryOrFail(db, category);
    const checked = checkName(name, cat.subcategories, 'Subcategory');
    if (!checked.ok) return fail(checked.error);
    await db.categories.put({ ...cat, subcategories: [...cat.subcategories, checked.name] });
    await touch(db, now);
    return checked.name;
  });
}

export async function renameSubcategory(db: InventoryDb, category: string, oldName: string, name: string, now = Date.now()): Promise<string> {
  return db.transaction('rw', db.categories, db.items, db.settings, async () => {
    const cat = await categoryOrFail(db, category);
    const at = cat.subcategories.indexOf(oldName);
    if (at < 0) fail(`“${oldName}” isn't a subcategory of ${category}`);
    const checked = checkName(name, cat.subcategories, 'Subcategory', oldName);
    if (!checked.ok) return fail(checked.error);
    const subcategories = [...cat.subcategories];
    subcategories[at] = checked.name;
    await db.categories.put({ ...cat, subcategories });
    await saveItems(db, renameSubcategoryItems(await allItems(db), category, oldName, checked.name), now);
    await touch(db, now);
    return checked.name;
  });
}

/** Removes a subcategory (F9); one that still holds items needs `moveTo`. */
export async function removeSubcategory(db: InventoryDb, category: string, name: string, moveTo: CategoryPlace | null, now = Date.now()): Promise<number> {
  return db.transaction('rw', db.categories, db.items, db.settings, async () => {
    const cat = await categoryOrFail(db, category);
    if (!cat.subcategories.includes(name)) fail(`“${name}” isn't a subcategory of ${category}`);
    const items = await allItems(db);
    const held = itemsIn(items, category, name).length;
    if (held > 0) {
      if (!moveTo) fail(`“${category} › ${name}” still holds ${held} item${held === 1 ? '' : 's'}; move ${held === 1 ? 'it' : 'them'} first.`);
      if (moveTo.category === category && moveTo.subcategory === name) fail('Choose a different place to move its items to.');
      const target = await categoryOrFail(db, moveTo.category);
      if (moveTo.subcategory !== '' && !target.subcategories.includes(moveTo.subcategory)) fail(`“${moveTo.subcategory}” isn't a subcategory of ${target.name}`);
      await saveItems(db, moveItems(items, { category, subcategory: name }, moveTo), now);
    }
    await db.categories.put({ ...cat, subcategories: cat.subcategories.filter((s) => s !== name) });
    await touch(db, now);
    return held;
  });
}

/** Reorder mode ▲/▼ (F9) for the subcategories of one category. */
export async function moveSubcategory(db: InventoryDb, category: string, name: string, delta: number, now = Date.now()): Promise<void> {
  await db.transaction('rw', db.categories, db.settings, async () => {
    const cat = await categoryOrFail(db, category);
    const at = cat.subcategories.indexOf(name);
    if (at < 0) fail(`“${name}” isn't a subcategory of ${category}`);
    await db.categories.put({ ...cat, subcategories: moveBy(cat.subcategories, at, delta) });
    await touch(db, now);
  });
}
