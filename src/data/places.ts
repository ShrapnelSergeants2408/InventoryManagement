// Areas, spots and bins (SPEC v2.0 §3, F7, F11). Each change runs in one transaction with the
// records it moves, so a failure leaves the phone unchanged.
import { checkName, moveBy, renumber } from '../domain/lists';
import { ID_PREFIX, newId } from '../domain/ids';
import { binCodeKey, defaultLetter, nextBinCode, tidyBinCode } from '../domain/places';
import { nameKey, type Area, type Bin, type Spot } from '../domain/types';
import { isAreaLetter, validateBin } from '../domain/validate';
import type { InventoryDb } from './db';
import { deletePhotosOf } from './photos';

function fail(message: string): never {
  throw new Error(message);
}

const touch = (db: InventoryDb, now: number) => db.settings.put({ key: 'lastChangeAt', value: now });

async function freshId(db: InventoryDb, prefix: string): Promise<string> {
  const table = prefix === ID_PREFIX.area ? db.areas : prefix === ID_PREFIX.spot ? db.spots : db.bins;
  const taken = new Set((await table.toCollection().primaryKeys()) as string[]);
  return newId(prefix, (x) => taken.has(x));
}

// ── Areas ──

async function orderedAreas(db: InventoryDb): Promise<Area[]> {
  return (await db.areas.toArray()).sort((a, b) => a.order - b.order);
}

async function writeAreaOrder(db: InventoryDb, list: readonly Area[]): Promise<void> {
  const changed = renumber(list).filter((a, i) => a !== list[i]);
  if (changed.length) await db.areas.bulkPut(changed);
}

function checkLetter(letter: string, list: readonly Area[], selfId?: string): string {
  const l = letter.trim().toUpperCase();
  if (!isAreaLetter(l)) fail(`The area letter must be one letter A–Z.`);
  const other = list.find((a) => a.letter === l && a.id !== selfId);
  if (other) fail(`The letter ${l} is already used by “${other.name}”.`);
  return l;
}

/** Adds an area at the end of the walk order. Its letter defaults to the first free one in its name. */
export async function addArea(db: InventoryDb, v: { name: string; letter?: string; notes?: string }, now = Date.now()): Promise<Area> {
  return db.transaction('rw', db.areas, db.settings, async () => {
    const list = await orderedAreas(db);
    const checked = checkName(v.name, list.map((a) => a.name), 'Area');
    if (!checked.ok) return fail(checked.error);
    const letter = v.letter?.trim() ? checkLetter(v.letter, list) : (defaultLetter(checked.name, list.map((a) => a.letter)) ?? fail('All 26 area letters are used.'));
    const area: Area = { id: await freshId(db, ID_PREFIX.area), name: checked.name, letter, order: list.length, notes: (v.notes ?? '').trim() };
    await db.areas.add(area);
    await touch(db, now);
    return area;
  });
}

/** Renames an area or changes its letter or notes. Existing bin codes keep their letter (§3). */
export async function updateArea(db: InventoryDb, id: string, v: { name: string; letter: string; notes: string }, now = Date.now()): Promise<Area> {
  return db.transaction('rw', db.areas, db.settings, async () => {
    const list = await orderedAreas(db);
    const area = list.find((a) => a.id === id) ?? fail('This area was removed meanwhile.');
    const checked = checkName(v.name, list.map((a) => a.name), 'Area', area.name);
    if (!checked.ok) return fail(checked.error);
    const next: Area = { ...area, name: checked.name, letter: checkLetter(v.letter, list, id), notes: v.notes.trim() };
    await db.areas.put(next);
    await touch(db, now);
    return next;
  });
}

/** Reorder mode ▲/▼: moves an area one place in the walk order. */
export async function moveArea(db: InventoryDb, id: string, delta: number, now = Date.now()): Promise<void> {
  await db.transaction('rw', db.areas, db.settings, async () => {
    const list = await orderedAreas(db);
    const at = list.findIndex((a) => a.id === id);
    if (at < 0) fail('This area was removed meanwhile.');
    await writeAreaOrder(db, moveBy(list, at, delta));
    await touch(db, now);
  });
}

/**
 * Removes an area (F11). One that still has spots needs `moveTo`, another area: its spots move
 * there, after that area's own, keeping their bins and items. Returns how many spots moved.
 */
export async function removeArea(db: InventoryDb, id: string, moveTo: string | null, now = Date.now()): Promise<number> {
  return db.transaction('rw', db.areas, db.spots, db.settings, async () => {
    const list = await orderedAreas(db);
    const area = list.find((a) => a.id === id) ?? fail('This area was removed meanwhile.');
    const spots = (await db.spots.where('areaId').equals(id).toArray()).sort((a, b) => a.order - b.order);
    if (spots.length > 0) {
      if (!moveTo) fail(`“${area.name}” still has ${spots.length === 1 ? '1 spot' : `${spots.length} spots`}; choose an area to move ${spots.length === 1 ? 'it' : 'them'} to.`);
      if (moveTo === id) fail('Choose a different area to move its spots to.');
      const target = list.find((a) => a.id === moveTo) ?? fail('The area to move to was removed meanwhile.');
      const there = await db.spots.where('areaId').equals(moveTo).toArray();
      const clash = spots.find((s) => there.some((t) => nameKey(t.name) === nameKey(s.name)));
      if (clash) fail(`“${target.name}” already has a spot called “${clash.name}”. Rename one of them first.`);
      await db.spots.bulkPut(spots.map((s, k) => ({ ...s, areaId: moveTo, order: there.length + k })));
    }
    await db.areas.delete(id);
    await writeAreaOrder(db, list.filter((a) => a.id !== id));
    await touch(db, now);
    return spots.length;
  });
}

// ── Spots ──

async function spotsIn(db: InventoryDb, areaId: string): Promise<Spot[]> {
  return (await db.spots.where('areaId').equals(areaId).toArray()).sort((a, b) => a.order - b.order);
}

async function writeSpotOrder(db: InventoryDb, list: readonly Spot[]): Promise<void> {
  const changed = renumber(list).filter((s, i) => s !== list[i]);
  if (changed.length) await db.spots.bulkPut(changed);
}

/** Adds a spot at the end of its area's walk order. */
export async function addSpot(db: InventoryDb, areaId: string, v: { name: string; notes?: string }, now = Date.now()): Promise<Spot> {
  return db.transaction('rw', db.areas, db.spots, db.settings, async () => {
    if (!(await db.areas.get(areaId))) fail('That area was removed meanwhile.');
    const list = await spotsIn(db, areaId);
    const checked = checkName(v.name, list.map((s) => s.name), 'Spot');
    if (!checked.ok) return fail(checked.error);
    const spot: Spot = { id: await freshId(db, ID_PREFIX.spot), areaId, name: checked.name, order: list.length, notes: (v.notes ?? '').trim() };
    await db.spots.add(spot);
    await touch(db, now);
    return spot;
  });
}

export async function updateSpot(db: InventoryDb, id: string, v: { name: string; notes: string }, now = Date.now()): Promise<Spot> {
  return db.transaction('rw', db.spots, db.settings, async () => {
    const spot = (await db.spots.get(id)) ?? fail('This spot was removed meanwhile.');
    const list = await spotsIn(db, spot.areaId);
    const checked = checkName(v.name, list.map((s) => s.name), 'Spot', spot.name);
    if (!checked.ok) return fail(checked.error);
    const next = { ...spot, name: checked.name, notes: v.notes.trim() };
    await db.spots.put(next);
    await touch(db, now);
    return next;
  });
}

/** Reorder mode ▲/▼ within the spot's area. */
export async function moveSpot(db: InventoryDb, id: string, delta: number, now = Date.now()): Promise<void> {
  await db.transaction('rw', db.spots, db.settings, async () => {
    const spot = (await db.spots.get(id)) ?? fail('This spot was removed meanwhile.');
    const list = await spotsIn(db, spot.areaId);
    await writeSpotOrder(db, moveBy(list, list.findIndex((s) => s.id === id), delta));
    await touch(db, now);
  });
}

/**
 * Move spot to another area (sorting the H1 "Unsorted" spots, Dan 2026-11-02). It goes last in
 * the new area, and its bins and items go with it.
 */
export async function moveSpotToArea(db: InventoryDb, id: string, areaId: string, now = Date.now()): Promise<Spot> {
  return db.transaction('rw', db.areas, db.spots, db.settings, async () => {
    const spot = (await db.spots.get(id)) ?? fail('This spot was removed meanwhile.');
    if (spot.areaId === areaId) return spot;
    const area = (await db.areas.get(areaId)) ?? fail('That area was removed meanwhile.');
    const there = await spotsIn(db, areaId);
    if (there.some((s) => nameKey(s.name) === nameKey(spot.name))) fail(`“${area.name}” already has a spot called “${spot.name}”. Rename one of them first.`);
    const next = { ...spot, areaId, order: there.length };
    await db.spots.put(next);
    await writeSpotOrder(db, (await spotsIn(db, spot.areaId)).filter((s) => s.id !== id));
    await touch(db, now);
    return next;
  });
}

/**
 * Removes a spot (F11). Its bins and loose items move to `moveTo` (another spot), or to no
 * spot when it's '' (bins then have "no spot", loose items "No home yet"). Returns how many
 * bins and items moved.
 */
export async function removeSpot(db: InventoryDb, id: string, moveTo: string, now = Date.now()): Promise<{ bins: number; items: number }> {
  return db.transaction('rw', [db.spots, db.bins, db.items, db.pictures, db.settings], async () => {
    const spot = (await db.spots.get(id)) ?? fail('This spot was removed meanwhile.');
    if (moveTo === id) fail('Choose a different spot to move its contents to.');
    if (moveTo !== '' && !(await db.spots.get(moveTo))) fail('The spot to move to was removed meanwhile.');
    const bins = await db.bins.where('spotId').equals(id).toArray();
    const items = await db.items.where('spotId').equals(id).toArray();
    await db.bins.bulkPut(bins.map((b) => ({ ...b, spotId: moveTo })));
    await db.items.bulkPut(items.map((i) => ({ ...i, spotId: moveTo, updatedAt: now })));
    await db.spots.delete(id);
    await deletePhotosOf(db, [id]);
    await writeSpotOrder(db, await spotsIn(db, spot.areaId));
    await touch(db, now);
    return { bins: bins.length, items: items.length };
  });
}

// ── Bins ──

/** The code a new bin on this spot gets (or in this area, for a bin with no spot). */
export async function suggestBinCode(db: InventoryDb, place: { spotId: string } | { areaId: string }): Promise<string | null> {
  const areaId = 'areaId' in place ? place.areaId : (await db.spots.get(place.spotId))?.areaId;
  const area = areaId ? await db.areas.get(areaId) : undefined;
  if (!area) return null;
  return nextBinCode(area.letter, (await db.bins.toArray()).map((b) => b.code));
}

export type BinFields = Omit<Bin, 'id' | 'labelPrintedAt' | 'labelContents'>;

async function checkBin(db: InventoryDb, bin: Bin): Promise<Bin> {
  const tidy: Bin = { ...bin, code: tidyBinCode(bin.code), name: bin.name.trim(), notes: bin.notes.trim() };
  const errors = validateBin(tidy);
  if (errors.length) fail(errors.map((e) => e.message).join('; '));
  if (tidy.spotId && !(await db.spots.get(tidy.spotId))) fail('That spot was removed meanwhile.');
  if (tidy.seasonId && !(await db.seasons.get(tidy.seasonId))) fail('That season was removed meanwhile.');
  const other = (await db.bins.toArray()).find((b) => b.id !== tidy.id && binCodeKey(b.code) === binCodeKey(tidy.code));
  if (other) fail(`The code ${tidy.code} is already on “${other.name}”.`);
  return tidy;
}

const binTables = (db: InventoryDb) => [db.bins, db.spots, db.seasons, db.tags, db.settings];

/** Adds a bin. A blank code takes the next free one in the spot's area (§3, D4). */
export async function addBin(db: InventoryDb, v: BinFields & { areaId?: string }, now = Date.now()): Promise<Bin> {
  return db.transaction('rw', [...binTables(db), db.areas], async () => {
    let code = v.code.trim();
    if (code === '') code = (await suggestBinCode(db, v.spotId ? { spotId: v.spotId } : { areaId: v.areaId ?? '' })) ?? fail('Choose a spot or an area, so the bin gets a code.');
    const { areaId: _a, ...fields } = v;
    const bin = await checkBin(db, { ...fields, code, id: await freshId(db, ID_PREFIX.bin), labelPrintedAt: null, labelContents: null });
    await db.bins.add(bin);
    await addTagsToList(db, bin.tags);
    await touch(db, now);
    return bin;
  });
}

/** Saves a bin edit. Moving it is `moveBin`; this keeps its spot unless the form changed it. */
export async function updateBin(db: InventoryDb, id: string, v: BinFields, now = Date.now()): Promise<Bin> {
  return db.transaction('rw', binTables(db), async () => {
    const row = (await db.bins.get(id)) ?? fail('This bin was deleted meanwhile.');
    const bin = await checkBin(db, { ...row, ...v, id });
    await db.bins.put(bin);
    await addTagsToList(db, bin.tags);
    await touch(db, now);
    return bin;
  });
}

/** Move bin (F7): to another spot, or to no spot (''). Its items go with it; its code stays. */
export async function moveBin(db: InventoryDb, id: string, spotId: string, now = Date.now()): Promise<Bin> {
  return db.transaction('rw', db.bins, db.spots, db.settings, async () => {
    const row = (await db.bins.get(id)) ?? fail('This bin was deleted meanwhile.');
    if (spotId && !(await db.spots.get(spotId))) fail('That spot was removed meanwhile.');
    const next = { ...row, spotId };
    await db.bins.put(next);
    await touch(db, now);
    return next;
  });
}

/**
 * Deletes a bin (§6). Its items move to the bin's spot as loose items (the default), or are
 * deleted too, with their photos. Returns how many items moved or were deleted.
 */
export async function deleteBin(db: InventoryDb, id: string, items: 'to-spot' | 'delete', now = Date.now()): Promise<number> {
  return db.transaction('rw', [db.bins, db.items, db.pictures, db.settings], async () => {
    const bin = (await db.bins.get(id)) ?? fail('This bin was deleted meanwhile.');
    const inside = await db.items.where('binId').equals(id).toArray();
    if (items === 'delete') {
      await db.items.bulkDelete(inside.map((i) => i.id));
      await deletePhotosOf(db, inside.map((i) => i.id));
    } else {
      await db.items.bulkPut(inside.map((i) => ({ ...i, binId: '', spotId: bin.spotId, updatedAt: now })));
    }
    await db.bins.delete(id);
    await deletePhotosOf(db, [id]);
    await touch(db, now);
    return inside.length;
  });
}

/** Appends tag names the Tags list doesn't have yet (a tag typed on a record). Inside a rw transaction over tags. */
export async function addTagsToList(db: InventoryDb, tags: readonly string[]): Promise<void> {
  if (tags.length === 0) return;
  const list = await db.tags.toArray();
  const keys = new Set(list.map((t) => t.key));
  let order = list.length;
  for (const name of tags) {
    const key = nameKey(name);
    if (keys.has(key)) continue;
    keys.add(key);
    await db.tags.add({ key, name: name.trim(), order: order++ });
  }
}
