// Category, season and tag list changes (SPEC v3.0 F11). Categories and tags belong to a part;
// a rename or remove rewrites that part's affected records in the same transaction as the list,
// so the two never disagree. Seasons are Holiday only.
import { checkName, itemsIn, moveBy, moveItems, renameCategoryItems, renameSubcategoryItems, renumber, type CategoryPlace } from '../domain/lists';
import { ID_PREFIX, newId } from '../domain/ids';
import { tagProblem } from '../domain/validate';
import { defaultDates, isMonthDay, tidyMonthDay } from '../domain/seasons';
import { SEASON_COLORS, nameKey, type Category, type Item, type Part, type Season, type SeasonColor, type Tag } from '../domain/types';
import { fromItemRow, fromTagRow, toItemRow, toTagRow, type InventoryDb } from './db';

function fail(message: string): never {
  throw new Error(message);
}

async function allItems(db: InventoryDb, part: Part): Promise<Item[]> {
  return (await db.items.where('part').equals(part).toArray()).map(fromItemRow);
}

async function saveItems(db: InventoryDb, items: readonly Item[], now: number): Promise<void> {
  if (items.length > 0) await db.items.bulkPut(items.map((i) => toItemRow(i, now)));
}

const touch = (db: InventoryDb, now: number) => db.settings.put({ key: 'lastChangeAt', value: now });

// ── Categories  ──

export async function orderedCategories(db: InventoryDb, part: Part): Promise<Category[]> {
  return (await db.categoryList.where('part').equals(part).toArray()).sort((a, b) => a.order - b.order);
}

async function writeCategories(db: InventoryDb, part: Part, list: readonly Omit<Category, 'part'>[]): Promise<void> {
  await db.categoryList.where('part').equals(part).delete();
  await db.categoryList.bulkAdd(renumber(list).map((c) => ({ ...c, part })));
}

async function categoryOrFail(db: InventoryDb, part: Part, name: string) {
  return (await db.categoryList.get([part, name])) ?? fail(`category "${name}" isn't in the list`);
}

export async function addCategory(db: InventoryDb, part: Part, name: string, now = Date.now()): Promise<string> {
  return db.transaction('rw', db.categoryList, db.settings, async () => {
    const list = await orderedCategories(db, part);
    const checked = checkName(name, list.map((c) => c.name), 'Category');
    if (!checked.ok) return fail(checked.error);
    await writeCategories(db, part, [...list, { name: checked.name, order: list.length, subcategories: [] }]);
    await touch(db, now);
    return checked.name;
  });
}

export async function renameCategory(db: InventoryDb, part: Part, oldName: string, name: string, now = Date.now()): Promise<string> {
  return db.transaction('rw', db.categoryList, db.items, db.settings, async () => {
    const list = await orderedCategories(db, part);
    const at = list.findIndex((c) => c.name === oldName);
    if (at < 0) fail(`category "${oldName}" isn't in the list`);
    const checked = checkName(name, list.map((c) => c.name), 'Category', oldName);
    if (!checked.ok) return fail(checked.error);
    list[at] = { ...list[at]!, name: checked.name };
    await writeCategories(db, part, list);
    await saveItems(db, renameCategoryItems(await allItems(db, part), oldName, checked.name), now);
    await touch(db, now);
    return checked.name;
  });
}

/**
 * Removes a category (F9). One that still holds items needs `moveTo`; its items move
 * there first, in the same transaction.
 */
export async function removeCategory(db: InventoryDb, part: Part, name: string, moveTo: CategoryPlace | null, now = Date.now()): Promise<number> {
  return db.transaction('rw', db.categoryList, db.items, db.settings, async () => {
    const list = await orderedCategories(db, part);
    await categoryOrFail(db, part, name);
    const items = await allItems(db, part);
    const held = itemsIn(items, name).length;
    if (held > 0) {
      if (!moveTo) fail(`“${name}” still holds ${held} item${held === 1 ? '' : 's'}; move ${held === 1 ? 'it' : 'them'} first.`);
      if (moveTo.category === name) fail('Choose a place outside the category being removed.');
      const target = await categoryOrFail(db, part, moveTo.category);
      if (moveTo.subcategory !== '' && !target.subcategories.includes(moveTo.subcategory)) fail(`“${moveTo.subcategory}” isn't a subcategory of ${target.name}`);
      await saveItems(db, moveItems(items, { category: name }, moveTo), now);
    }
    await writeCategories(db, part, list.filter((c) => c.name !== name));
    await touch(db, now);
    return held;
  });
}

/** Reorder mode ▲/▼ (F9) for categories. */
export async function moveCategory(db: InventoryDb, part: Part, name: string, delta: number, now = Date.now()): Promise<void> {
  await db.transaction('rw', db.categoryList, db.settings, async () => {
    const list = await orderedCategories(db, part);
    const at = list.findIndex((c) => c.name === name);
    if (at < 0) fail(`category "${name}" isn't in the list`);
    await writeCategories(db, part, moveBy(list, at, delta));
    await touch(db, now);
  });
}

/** Adds a subcategory at the end of its category (anyone, F6/F9). */
export async function addSubcategory(db: InventoryDb, part: Part, category: string, name: string, now = Date.now()): Promise<string> {
  return db.transaction('rw', db.categoryList, db.settings, async () => {
    const cat = await categoryOrFail(db, part, category);
    const checked = checkName(name, cat.subcategories, 'Subcategory');
    if (!checked.ok) return fail(checked.error);
    await db.categoryList.put({ ...cat, subcategories: [...cat.subcategories, checked.name] });
    await touch(db, now);
    return checked.name;
  });
}

export async function renameSubcategory(db: InventoryDb, part: Part, category: string, oldName: string, name: string, now = Date.now()): Promise<string> {
  return db.transaction('rw', db.categoryList, db.items, db.settings, async () => {
    const cat = await categoryOrFail(db, part, category);
    const at = cat.subcategories.indexOf(oldName);
    if (at < 0) fail(`“${oldName}” isn't a subcategory of ${category}`);
    const checked = checkName(name, cat.subcategories, 'Subcategory', oldName);
    if (!checked.ok) return fail(checked.error);
    const subcategories = [...cat.subcategories];
    subcategories[at] = checked.name;
    await db.categoryList.put({ ...cat, subcategories });
    await saveItems(db, renameSubcategoryItems(await allItems(db, part), category, oldName, checked.name), now);
    await touch(db, now);
    return checked.name;
  });
}

/** Removes a subcategory (F9); one that still holds items needs `moveTo`. */
export async function removeSubcategory(db: InventoryDb, part: Part, category: string, name: string, moveTo: CategoryPlace | null, now = Date.now()): Promise<number> {
  return db.transaction('rw', db.categoryList, db.items, db.settings, async () => {
    const cat = await categoryOrFail(db, part, category);
    if (!cat.subcategories.includes(name)) fail(`“${name}” isn't a subcategory of ${category}`);
    const items = await allItems(db, part);
    const held = itemsIn(items, category, name).length;
    if (held > 0) {
      if (!moveTo) fail(`“${category} › ${name}” still holds ${held} item${held === 1 ? '' : 's'}; move ${held === 1 ? 'it' : 'them'} first.`);
      if (moveTo.category === category && moveTo.subcategory === name) fail('Choose a different place to move its items to.');
      const target = await categoryOrFail(db, part, moveTo.category);
      if (moveTo.subcategory !== '' && !target.subcategories.includes(moveTo.subcategory)) fail(`“${moveTo.subcategory}” isn't a subcategory of ${target.name}`);
      await saveItems(db, moveItems(items, { category, subcategory: name }, moveTo), now);
    }
    await db.categoryList.put({ ...cat, subcategories: cat.subcategories.filter((s) => s !== name) });
    await touch(db, now);
    return held;
  });
}

/** Reorder mode ▲/▼ (F9) for the subcategories of one category. */
export async function moveSubcategory(db: InventoryDb, part: Part, category: string, name: string, delta: number, now = Date.now()): Promise<void> {
  await db.transaction('rw', db.categoryList, db.settings, async () => {
    const cat = await categoryOrFail(db, part, category);
    const at = cat.subcategories.indexOf(name);
    if (at < 0) fail(`“${name}” isn't a subcategory of ${category}`);
    await db.categoryList.put({ ...cat, subcategories: moveBy(cat.subcategories, at, delta) });
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
  return db.transaction('rw', db.categoryList, db.items, db.settings, async () => {
    if (ids.length === 0) fail('Select at least one item to move.');
    const first = await db.items.get(ids[0]!);
    const part: Part = first?.part ?? fail('That item was deleted meanwhile.');
    const list = await orderedCategories(db, part);
    let changed = false;
    let cat = list.find((c) => nameKey(c.name) === nameKey(to.category));
    if (!cat) {
      if (!opts.create) return fail(`category "${to.category}" isn't in the list`);
      const checked = checkName(to.category, list.map((c) => c.name), 'Category');
      if (!checked.ok) return fail(checked.error);
      cat = { part, name: checked.name, order: list.length, subcategories: [] };
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
    if (rows.some((r) => r!.part !== part)) fail('The selected items are in different parts. Nothing was moved.');
    const moving = rows.map((r) => fromItemRow(r!)).filter((i) => i.category !== cat!.name || i.subcategory !== subcategory);
    if (changed) await writeCategories(db, part, list);
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

/** Checks typed season dates: both "MM-DD" (tidied from "11/25" or "Nov 25"), or both blank. */
function checkDates(v: { setupFrom: string; takedownBy: string }): { setupFrom: string; takedownBy: string } {
  const setupFrom = tidyMonthDay(v.setupFrom);
  const takedownBy = tidyMonthDay(v.takedownBy);
  for (const [d, label] of [[setupFrom, 'Setup from'], [takedownBy, 'Take down by']] as const) {
    if (d !== '' && !isMonthDay(d)) fail(`${label} “${d}” isn't a month and day, such as 11-25.`);
  }
  if ((setupFrom === '') !== (takedownBy === '')) fail('Give both dates, or leave both blank.');
  return { setupFrom, takedownBy };
}

/** Adds a season. Without dates, a default season name gets its default dates (§3). */
export async function addSeason(db: InventoryDb, v: { name: string; color?: SeasonColor; setupFrom?: string; takedownBy?: string }, now = Date.now()): Promise<Season> {
  return db.transaction('rw', db.seasons, db.settings, async () => {
    const list = await orderedSeasons(db);
    const checked = checkName(v.name, list.map((s) => s.name), 'Season');
    if (!checked.ok) return fail(checked.error);
    const taken = new Set(list.map((s) => s.id));
    const dates = v.setupFrom === undefined && v.takedownBy === undefined ? defaultDates(checked.name) : checkDates({ setupFrom: v.setupFrom ?? '', takedownBy: v.takedownBy ?? '' });
    const season: Season = { id: newId(ID_PREFIX.season, (x) => taken.has(x)), name: checked.name, order: list.length, color: v.color ?? nextSeasonColor(list.map((s) => s.color)), ...dates, setupNotes: '' };
    await db.seasons.add(season);
    await touch(db, now);
    return season;
  });
}

export async function updateSeason(db: InventoryDb, id: string, v: { name: string; color: SeasonColor; setupNotes: string; setupFrom: string; takedownBy: string }, now = Date.now()): Promise<Season> {
  return db.transaction('rw', db.seasons, db.settings, async () => {
    const list = await orderedSeasons(db);
    const season = list.find((s) => s.id === id) ?? fail('This season was removed meanwhile.');
    const checked = checkName(v.name, list.map((s) => s.name), 'Season', season.name);
    if (!checked.ok) return fail(checked.error);
    if (!SEASON_COLORS.includes(v.color)) fail(`“${v.color}” isn't one of the season colors.`);
    const next = { ...season, name: checked.name, color: v.color, ...checkDates(v), setupNotes: v.setupNotes.trim() };
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

export async function orderedTags(db: InventoryDb, part: Part): Promise<Tag[]> {
  return (await db.tagList.where('part').equals(part).toArray()).sort((a, b) => a.order - b.order).map(fromTagRow);
}

async function writeTags(db: InventoryDb, part: Part, list: readonly Omit<Tag, 'part'>[]): Promise<void> {
  await db.tagList.where('part').equals(part).delete();
  await db.tagList.bulkAdd(renumber(list).map((t) => toTagRow({ ...t, part })));
}

/** A part's items and bins (tags are per part). */
const partItems = (db: InventoryDb, part: Part) => db.items.where('part').equals(part).toArray();
const partBins = (db: InventoryDb, part: Part) => db.bins.where('part').equals(part).toArray();

function checkTag(raw: string, list: readonly Tag[], self?: string): string {
  const checked = checkName(raw, list.map((t) => t.name), 'Tag', self);
  if (!checked.ok) return fail(checked.error);
  const p = tagProblem(checked.name);
  if (p) fail(p.charAt(0).toUpperCase() + p.slice(1) + '.');
  return checked.name;
}

/** Whether a record's tags include `name`, ignoring capitals. */
const hasTag = (tags: readonly string[], name: string) => tags.some((t) => nameKey(t) === nameKey(name));

export async function addTag(db: InventoryDb, part: Part, name: string, now = Date.now()): Promise<string> {
  return db.transaction('rw', db.tagList, db.settings, async () => {
    const list = await orderedTags(db, part);
    const tag = checkTag(name, list);
    await writeTags(db, part, [...list, { name: tag, order: list.length }]);
    await touch(db, now);
    return tag;
  });
}

/** Renames a tag on the list and on every item and bin that has it. */
export async function renameTag(db: InventoryDb, part: Part, oldName: string, name: string, now = Date.now()): Promise<string> {
  return db.transaction('rw', db.tagList, db.items, db.bins, db.settings, async () => {
    const list = await orderedTags(db, part);
    const at = list.findIndex((t) => nameKey(t.name) === nameKey(oldName));
    if (at < 0) fail(`tag "${oldName}" isn't in the list`);
    const tag = checkTag(name, list, list[at]!.name);
    list[at] = { ...list[at]!, name: tag };
    await writeTags(db, part, list);
    const swap = (tags: string[]) => tags.map((t) => (nameKey(t) === nameKey(oldName) ? tag : t));
    const items = (await partItems(db, part)).filter((i) => hasTag(i.tags, oldName));
    const bins = (await partBins(db, part)).filter((b) => hasTag(b.tags, oldName));
    await db.items.bulkPut(items.map((i) => ({ ...i, tags: swap(i.tags), updatedAt: now })));
    await db.bins.bulkPut(bins.map((b) => ({ ...b, tags: swap(b.tags) })));
    await touch(db, now);
    return tag;
  });
}

/** Removes a tag (after confirming when in use, §6) from the list and from every record. */
export async function removeTag(db: InventoryDb, part: Part, name: string, now = Date.now()): Promise<{ items: number; bins: number }> {
  return db.transaction('rw', db.tagList, db.items, db.bins, db.settings, async () => {
    const list = await orderedTags(db, part);
    if (!list.some((t) => nameKey(t.name) === nameKey(name))) fail(`tag "${name}" isn't in the list`);
    const drop = (tags: string[]) => tags.filter((t) => nameKey(t) !== nameKey(name));
    const items = (await partItems(db, part)).filter((i) => hasTag(i.tags, name));
    const bins = (await partBins(db, part)).filter((b) => hasTag(b.tags, name));
    await db.items.bulkPut(items.map((i) => ({ ...i, tags: drop(i.tags), updatedAt: now })));
    await db.bins.bulkPut(bins.map((b) => ({ ...b, tags: drop(b.tags) })));
    await writeTags(db, part, list.filter((t) => nameKey(t.name) !== nameKey(name)));
    await touch(db, now);
    return { items: items.length, bins: bins.length };
  });
}

export async function moveTag(db: InventoryDb, part: Part, name: string, delta: number, now = Date.now()): Promise<void> {
  await db.transaction('rw', db.tagList, db.settings, async () => {
    const list = await orderedTags(db, part);
    const at = list.findIndex((t) => nameKey(t.name) === nameKey(name));
    if (at < 0) fail(`tag "${name}" isn't in the list`);
    await writeTags(db, part, moveBy(list, at, delta));
    await touch(db, now);
  });
}

/**
 * Adds categories the part's list doesn't have (an item or bin moved in from the other part
 * whose category fell back to "Other", §3), at the end. Inside a rw transaction over categoryList.
 */
export async function ensureCategories(db: InventoryDb, part: Part, names: readonly string[]): Promise<void> {
  const list = await orderedCategories(db, part);
  const keys = new Set(list.map((c) => nameKey(c.name)));
  let order = list.length;
  for (const name of names) {
    if (keys.has(nameKey(name))) continue;
    keys.add(nameKey(name));
    await db.categoryList.add({ part, name, order: order++, subcategories: [] });
  }
}
