// Category, season and tag list changes (SPEC v2.0 F11). A rename or remove rewrites every
// affected record in the same transaction as the list, so the two never disagree.
import { checkName, itemsIn, moveBy, moveItems, renameCategoryItems, renameSubcategoryItems, renumber, type CategoryPlace } from '../domain/lists';
import { ID_PREFIX, newId } from '../domain/ids';
import { tagProblem } from '../domain/validate';
import { SEASON_COLORS, nameKey, type Item, type Season, type SeasonColor, type Tag } from '../domain/types';
import { fromItemRow, fromTagRow, toItemRow, toTagRow, type InventoryDb } from './db';

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

// ── Categories  ──

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

/**
 * Bulk category change (Select › Category…): moves the chosen items to a category and subcategory in one transaction.
 * Only category and subcategory change. With `create`, a category or subcategory that isn't in
 * the list yet is added first ("+ New category…", "+ New subcategory…"); a typed name that
 * matches one already there (ignoring capitals) just uses it, as in the item editor. Returns how many items were chosen.
 */
export async function changeItemsCategory(db: InventoryDb, ids: readonly string[], to: CategoryPlace, opts: { create?: boolean } = {}, now = Date.now()): Promise<number> {
  return db.transaction('rw', db.categories, db.items, db.settings, async () => {
    if (ids.length === 0) fail('Select at least one item to move.');
    const list = await orderedCategories(db);
    let changed = false;
    let cat = list.find((c) => nameKey(c.name) === nameKey(to.category));
    if (!cat) {
      if (!opts.create) return fail(`category "${to.category}" isn't in the list`);
      const checked = checkName(to.category, list.map((c) => c.name), 'Category');
      if (!checked.ok) return fail(checked.error);
      cat = { name: checked.name, order: list.length, subcategories: [] };
      list.push(cat);
      changed = true;
    }
    let subcategory = '';
    if (to.subcategory.trim() !== '') {
      const listed = cat.subcategories.find((s) => nameKey(s) === nameKey(to.subcategory));
      if (listed) subcategory = listed;
      else {
        if (!opts.create) return fail(`“${to.subcategory}” isn't a subcategory of ${cat.name}`);
        const checked = checkName(to.subcategory, cat.subcategories, 'Subcategory');
        if (!checked.ok) return fail(checked.error);
        subcategory = checked.name;
        cat.subcategories = [...cat.subcategories, subcategory];
        changed = true;
      }
    }
    const unique = [...new Set(ids)];
    const rows = await db.items.bulkGet(unique);
    const gone = rows.filter((r) => !r).length;
    if (gone > 0) fail(`${gone} of the selected items ${gone === 1 ? 'was' : 'were'} deleted meanwhile. Nothing was moved.`);
    const moving = rows.map((r) => fromItemRow(r!)).filter((i) => i.category !== cat!.name || i.subcategory !== subcategory);
    if (changed) await writeCategories(db, list);
    await saveItems(db, moving.map((i) => ({ ...i, category: cat!.name, subcategory })), now);
    await touch(db, now);
    return unique.length;
  });
}

// ── Seasons (F11) ──

async function orderedSeasons(db: InventoryDb): Promise<Season[]> {
  return (await db.seasons.toArray()).sort((a, b) => a.order - b.order);
}

async function writeSeasonOrder(db: InventoryDb, list: readonly Season[]): Promise<void> {
  const changed = renumber(list).filter((s, i) => s !== list[i]);
  if (changed.length) await db.seasons.bulkPut(changed);
}

/** The first palette color no season uses yet, else the palette in turn. */
export function nextSeasonColor(used: readonly SeasonColor[]): SeasonColor {
  return SEASON_COLORS.find((c) => !used.includes(c)) ?? SEASON_COLORS[used.length % SEASON_COLORS.length]!;
}

export async function addSeason(db: InventoryDb, v: { name: string; color?: SeasonColor }, now = Date.now()): Promise<Season> {
  return db.transaction('rw', db.seasons, db.settings, async () => {
    const list = await orderedSeasons(db);
    const checked = checkName(v.name, list.map((s) => s.name), 'Season');
    if (!checked.ok) return fail(checked.error);
    const taken = new Set(list.map((s) => s.id));
    const season: Season = { id: newId(ID_PREFIX.season, (x) => taken.has(x)), name: checked.name, order: list.length, color: v.color ?? nextSeasonColor(list.map((s) => s.color)), setupNotes: '' };
    await db.seasons.add(season);
    await touch(db, now);
    return season;
  });
}

export async function updateSeason(db: InventoryDb, id: string, v: { name: string; color: SeasonColor; setupNotes: string }, now = Date.now()): Promise<Season> {
  return db.transaction('rw', db.seasons, db.settings, async () => {
    const list = await orderedSeasons(db);
    const season = list.find((s) => s.id === id) ?? fail('This season was removed meanwhile.');
    const checked = checkName(v.name, list.map((s) => s.name), 'Season', season.name);
    if (!checked.ok) return fail(checked.error);
    if (!SEASON_COLORS.includes(v.color)) fail(`“${v.color}” isn't one of the season colors.`);
    const next = { ...season, name: checked.name, color: v.color, setupNotes: v.setupNotes.trim() };
    await db.seasons.put(next);
    await touch(db, now);
    return next;
  });
}

export async function moveSeason(db: InventoryDb, id: string, delta: number, now = Date.now()): Promise<void> {
  await db.transaction('rw', db.seasons, db.settings, async () => {
    const list = await orderedSeasons(db);
    const at = list.findIndex((s) => s.id === id);
    if (at < 0) fail('This season was removed meanwhile.');
    await writeSeasonOrder(db, moveBy(list, at, delta));
    await touch(db, now);
  });
}

/** Removes a season (after confirming when in use, §6); it's cleared from the items and bins that had it. */
export async function removeSeason(db: InventoryDb, id: string, now = Date.now()): Promise<{ items: number; bins: number }> {
  return db.transaction('rw', [db.seasons, db.items, db.bins, db.pictures, db.settings], async () => {
    const list = await orderedSeasons(db);
    if (!list.some((s) => s.id === id)) fail('This season was removed meanwhile.');
    const items = await db.items.where('seasonId').equals(id).toArray();
    const bins = await db.bins.where('seasonId').equals(id).toArray();
    await db.items.bulkPut(items.map((i) => ({ ...i, seasonId: '', updatedAt: now })));
    await db.bins.bulkPut(bins.map((b) => ({ ...b, seasonId: '' })));
    await db.seasons.delete(id);
    await db.pictures.where('ownerId').equals(id).delete();
    await writeSeasonOrder(db, list.filter((s) => s.id !== id));
    await touch(db, now);
    return { items: items.length, bins: bins.length };
  });
}

// ── Tags (F11) ──

async function orderedTags(db: InventoryDb): Promise<Tag[]> {
  return (await db.tags.orderBy('order').toArray()).map(fromTagRow);
}

async function writeTags(db: InventoryDb, list: readonly Tag[]): Promise<void> {
  await db.tags.clear();
  await db.tags.bulkAdd(renumber(list).map(toTagRow));
}

function checkTag(raw: string, list: readonly Tag[], self?: string): string {
  const checked = checkName(raw, list.map((t) => t.name), 'Tag', self);
  if (!checked.ok) return fail(checked.error);
  const p = tagProblem(checked.name);
  if (p) fail(p.charAt(0).toUpperCase() + p.slice(1) + '.');
  return checked.name;
}

/** Whether a record's tags include `name`, ignoring capitals. */
const hasTag = (tags: readonly string[], name: string) => tags.some((t) => nameKey(t) === nameKey(name));

export async function addTag(db: InventoryDb, name: string, now = Date.now()): Promise<string> {
  return db.transaction('rw', db.tags, db.settings, async () => {
    const list = await orderedTags(db);
    const tag = checkTag(name, list);
    await writeTags(db, [...list, { name: tag, order: list.length }]);
    await touch(db, now);
    return tag;
  });
}

/** Renames a tag on the list and on every item and bin that has it. */
export async function renameTag(db: InventoryDb, oldName: string, name: string, now = Date.now()): Promise<string> {
  return db.transaction('rw', db.tags, db.items, db.bins, db.settings, async () => {
    const list = await orderedTags(db);
    const at = list.findIndex((t) => nameKey(t.name) === nameKey(oldName));
    if (at < 0) fail(`tag "${oldName}" isn't in the list`);
    const tag = checkTag(name, list, list[at]!.name);
    list[at] = { ...list[at]!, name: tag };
    await writeTags(db, list);
    const swap = (tags: string[]) => tags.map((t) => (nameKey(t) === nameKey(oldName) ? tag : t));
    const items = (await db.items.toArray()).filter((i) => hasTag(i.tags, oldName));
    const bins = (await db.bins.toArray()).filter((b) => hasTag(b.tags, oldName));
    await db.items.bulkPut(items.map((i) => ({ ...i, tags: swap(i.tags), updatedAt: now })));
    await db.bins.bulkPut(bins.map((b) => ({ ...b, tags: swap(b.tags) })));
    await touch(db, now);
    return tag;
  });
}

/** Removes a tag (after confirming when in use, §6) from the list and from every record. */
export async function removeTag(db: InventoryDb, name: string, now = Date.now()): Promise<{ items: number; bins: number }> {
  return db.transaction('rw', db.tags, db.items, db.bins, db.settings, async () => {
    const list = await orderedTags(db);
    if (!list.some((t) => nameKey(t.name) === nameKey(name))) fail(`tag "${name}" isn't in the list`);
    const drop = (tags: string[]) => tags.filter((t) => nameKey(t) !== nameKey(name));
    const items = (await db.items.toArray()).filter((i) => hasTag(i.tags, name));
    const bins = (await db.bins.toArray()).filter((b) => hasTag(b.tags, name));
    await db.items.bulkPut(items.map((i) => ({ ...i, tags: drop(i.tags), updatedAt: now })));
    await db.bins.bulkPut(bins.map((b) => ({ ...b, tags: drop(b.tags) })));
    await writeTags(db, list.filter((t) => nameKey(t.name) !== nameKey(name)));
    await touch(db, now);
    return { items: items.length, bins: bins.length };
  });
}

export async function moveTag(db: InventoryDb, name: string, delta: number, now = Date.now()): Promise<void> {
  await db.transaction('rw', db.tags, db.settings, async () => {
    const list = await orderedTags(db);
    const at = list.findIndex((t) => nameKey(t.name) === nameKey(name));
    if (at < 0) fail(`tag "${name}" isn't in the list`);
    await writeTags(db, moveBy(list, at, delta));
    await touch(db, now);
  });
}
