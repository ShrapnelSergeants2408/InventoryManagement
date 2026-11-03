// Areas, spots, bins, seasons, tags, Move, Split and Duplicate in the database (SPEC v2.0 F7, F11, F16).
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { InventoryDb } from '../src/data/db';
import { getItem, loadSnapshot, replaceAll } from '../src/data/inventory';
import { duplicateItem, getRecentHomes, moveItemsHome, splitItem } from '../src/data/items';
import { addSeason, addTag, moveSeason, moveTag, nextSeasonColor, removeSeason, removeTag, renameTag, updateSeason } from '../src/data/lists';
import {
  addArea,
  addBin,
  addSpot,
  deleteBin,
  moveArea,
  moveBin,
  moveSpot,
  moveSpotToArea,
  removeArea,
  removeSpot,
  suggestBinCode,
  updateArea,
  updateBin,
  updateSpot,
} from '../src/data/places';
import { getSettings } from '../src/data/settings';
import { checkData } from '../src/domain/integrity';
import { dataset, household, item } from './helpers';

let db: InventoryDb;
afterEach(() => db?.close());

const seed = () => [
  item({ id: 'i-bin', name: 'Snowman lights', binId: 'bn-xmas4', quantity: 40, approx: true, tags: ['Outdoor'] }),
  item({ id: 'i-spot', name: 'Drill', spotId: 'sp-peg' }),
  item({ id: 'i-none', name: 'Wreath', seasonId: 'se-hall', tags: ['outdoor'] }),
];

async function setup() {
  db = new InventoryDb(`pl-${Math.random()}`);
  const h = household();
  await replaceAll(db, dataset({ ...h, bins: h.bins.map((b) => (b.id === 'bn-spare' ? { ...b, tags: ['Outdoor'] } : b)), items: seed(), tags: [{ part: 'holiday', name: 'Outdoor', order: 0 }] }), 1);
}

const snap = () => loadSnapshot(db);
/** After every change the stored household still fits together. */
async function consistent() {
  const s = await snap();
  expect(checkData({ ...s, photos: [] })).toEqual([]);
  return s;
}

describe('areas (F11)', () => {
  it('add: end of walk order, code from the name, names and codes unique', async () => {
    await setup();
    const a = await addArea(db, 'holiday', { name: ' Utility room ', notes: ' furnace ' }, 9);
    expect(a).toMatchObject({ name: 'Utility room', code: 'UTILITY', order: 3, notes: 'furnace' });
    expect((await addArea(db, 'holiday', { name: 'Upstairs', code: ' up stairs ' })).code).toBe('UPSTAIRS');
    expect(await suggestBinCode(db, { areaId: a.id })).toBe('UTILITY-01');
    await expect(addArea(db, 'holiday', { name: 'attic' })).rejects.toThrow(/already in the list/);
    await expect(addArea(db, 'holiday', { name: 'Shed', code: 'g' })).rejects.toThrow(/G is already used by “Garage”/);
    await expect(addArea(db, 'holiday', { name: 'Shed', code: '7' })).rejects.toThrow(/1 to 8 letters/);
    await expect(addArea(db, 'holiday', { name: 'Shed', code: 'BACKYARDSHED' })).rejects.toThrow(/1 to 8 letters/);
    expect((await getSettings(db)).lastChangeAt).toBeGreaterThanOrEqual(9);
    await consistent();
  });

  it('rename and change the code; existing bin codes keep theirs (labels stay true)', async () => {
    await setup();
    await updateArea(db, 'ar-attic', { name: 'Loft', code: 'L', notes: '' });
    const s = await consistent();
    expect(s.areas[0]).toMatchObject({ name: 'Loft', code: 'L' });
    expect(s.bins.find((b) => b.id === 'bn-xmas4')!.code).toBe('A-04');
    expect(await suggestBinCode(db, { spotId: 'sp-shelfB' })).toBe('L-01');
  });

  it('▲/▼ walk order', async () => {
    await setup();
    await moveArea(db, 'ar-base', -1);
    expect((await snap()).areas.map((a) => [a.name, a.order])).toEqual([['Attic', 0], ['Basement', 1], ['Garage', 2]]);
  });

  it('remove: an empty area goes; one with spots needs another area, and its spots move with their contents', async () => {
    await setup();
    expect(await removeArea(db, 'ar-base', null)).toBe(0);
    await expect(removeArea(db, 'ar-attic', null)).rejects.toThrow(/still has 2 spots/);
    expect(await removeArea(db, 'ar-attic', 'ar-garage')).toBe(2);
    const s = await consistent();
    expect(s.areas.map((a) => [a.name, a.order])).toEqual([['Garage', 0]]);
    expect(s.spots.filter((x) => x.areaId === 'ar-garage').map((x) => [x.name, x.order])).toEqual([['Pegboard', 0], ['Shelf A', 1], ['Shelf B', 2]]);
    expect((await getItem(db, 'i-bin'))!.binId).toBe('bn-xmas4');
  });

  it('remove refuses when a spot name clashes in the destination, changing nothing', async () => {
    await setup();
    await addSpot(db, 'ar-garage', { name: 'Shelf A' });
    await expect(removeArea(db, 'ar-attic', 'ar-garage')).rejects.toThrow(/already has a spot called “Shelf A”/);
    expect((await snap()).areas).toHaveLength(3);
  });
});

describe('spots (F11)', () => {
  it('add, rename (unique within the area), ▲/▼', async () => {
    await setup();
    const s1 = await addSpot(db, 'ar-garage', { name: 'Workbench' });
    expect(s1.order).toBe(1);
    await addSpot(db, 'ar-attic', { name: 'Pegboard' }); // same name, other area: fine
    await expect(addSpot(db, 'ar-garage', { name: 'pegboard' })).rejects.toThrow(/already in the list/);
    await expect(updateSpot(db, s1.id, { name: 'Pegboard', notes: '' })).rejects.toThrow(/already in the list/);
    await moveSpot(db, s1.id, -1);
    expect((await snap()).spots.filter((x) => x.areaId === 'ar-garage').map((x) => x.name)).toEqual(['Workbench', 'Pegboard']);
    await consistent();
  });

  it('move to another area: last there, the old area closes up, contents follow', async () => {
    await setup();
    await moveSpotToArea(db, 'sp-shelfA', 'ar-garage');
    const s = await consistent();
    expect(s.spots.map((x) => [x.name, x.areaId, x.order]).sort((a, b) => `${a[1]}${a[2]}`.localeCompare(`${b[1]}${b[2]}`))).toEqual([
      ['Shelf B', 'ar-attic', 0],
      ['Pegboard', 'ar-garage', 0],
      ['Shelf A', 'ar-garage', 1],
    ]);
    await addSpot(db, 'ar-attic', { name: 'Pegboard' });
    await expect(moveSpotToArea(db, 'sp-peg', 'ar-attic')).rejects.toThrow(/already has a spot called “Pegboard”/);
  });

  it('remove: bins and loose items move to another spot, or to no spot', async () => {
    await setup();
    expect(await removeSpot(db, 'sp-shelfB', 'sp-shelfA')).toEqual({ bins: 1, items: 0 });
    expect((await snap()).bins.find((b) => b.id === 'bn-xmas4')!.spotId).toBe('sp-shelfA');
    expect(await removeSpot(db, 'sp-peg', '')).toEqual({ bins: 0, items: 1 });
    expect((await getItem(db, 'i-spot'))).toMatchObject({ spotId: '', binId: '' });
    await expect(removeSpot(db, 'sp-shelfA', 'sp-shelfA')).rejects.toThrow(/different spot/);
    await consistent();
  });
});

describe('bins (§3, F7)', () => {
  it('add: a blank code takes the next in the spot’s area; typed codes are tidied and unique', async () => {
    await setup();
    const b1 = await addBin(db, { code: '', name: 'Christmas 5', spotId: 'sp-shelfA', seasonId: 'se-xmas', tags: ['Fragile'], state: 'stored', notes: '' });
    expect(b1.code).toBe('A-06');
    const b2 = await addBin(db, { code: '', name: 'Tools tote', spotId: '', seasonId: '', tags: [], state: 'stored', notes: '', areaId: 'ar-garage' });
    expect(b2.code).toBe('G-01');
    expect((await addBin(db, { part: 'holiday', code: 'g7', name: 'Odd', spotId: '', seasonId: '', tags: [], state: 'stored', notes: '' })).code).toBe('G-07');
    await expect(addBin(db, { part: 'holiday', code: 'a-4', name: 'Clash', spotId: '', seasonId: '', tags: [], state: 'stored', notes: '' })).rejects.toThrow(/A-04 is already on “Christmas 4”/);
    await expect(addBin(db, { code: '', name: 'Nowhere', spotId: '', seasonId: '', tags: [], state: 'stored', notes: '' })).rejects.toThrow(/Choose a spot or an area/);
    expect((await snap()).tags.map((t) => t.name)).toEqual(['Outdoor', 'Fragile']);
    await consistent();
  });

  it('edit keeps the label fields; Move bin changes only its spot and keeps its code', async () => {
    await setup();
    await db.bins.update('bn-xmas4', { labelPrintedAt: 5, labelContents: 'Snowman lights ~40' });
    const b = await updateBin(db, 'bn-xmas4', { part: 'holiday', code: 'A-04', name: 'Christmas 4: lights', spotId: 'sp-shelfB', seasonId: 'se-xmas', tags: [], state: 'out', notes: '' });
    expect(b).toMatchObject({ name: 'Christmas 4: lights', state: 'out', labelPrintedAt: 5, labelContents: 'Snowman lights ~40' });
    const moved = await moveBin(db, 'bn-xmas4', 'sp-peg');
    expect(moved).toMatchObject({ code: 'A-04', spotId: 'sp-peg' });
    const s = await consistent();
    expect(s.items.find((i) => i.id === 'i-bin')!.binId).toBe('bn-xmas4');
  });

  it('delete: items move to the bin’s spot as loose items (default), or are deleted', async () => {
    await setup();
    expect(await deleteBin(db, 'bn-xmas4', 'to-spot')).toBe(1);
    expect(await getItem(db, 'i-bin')).toMatchObject({ binId: '', spotId: 'sp-shelfB' });
    await moveItemsHome(db, ['i-bin'], { binId: 'bn-spare' });
    expect(await deleteBin(db, 'bn-spare', 'delete')).toBe(1);
    expect(await getItem(db, 'i-bin')).toBeNull();
    await consistent();
  });
});

describe('Move (F7)', () => {
  it('to a bin, a spot or no home; items already there aren’t rewritten; the home becomes a quick pick', async () => {
    await setup();
    expect(await moveItemsHome(db, ['i-bin', 'i-spot', 'i-none'], { binId: 'bn-xmas4' }, 5)).toBe(2);
    expect((await snap()).items.every((i) => i.binId === 'bn-xmas4' && i.spotId === '')).toBe(true);
    expect(await moveItemsHome(db, ['i-none'], { spotId: 'sp-shelfA' })).toBe(1);
    expect(await getItem(db, 'i-none')).toMatchObject({ binId: '', spotId: 'sp-shelfA' });
    expect(await moveItemsHome(db, ['i-none'], 'none')).toBe(1);
    expect(await getRecentHomes(db)).toEqual(['sp-shelfA', 'bn-xmas4']);
    await consistent();
  });

  it('all or nothing: a deleted item or a missing destination moves nothing', async () => {
    await setup();
    await expect(moveItemsHome(db, ['i-bin', 'gone'], { spotId: 'sp-peg' })).rejects.toThrow(/deleted meanwhile/);
    await expect(moveItemsHome(db, ['i-bin'], { binId: 'bn-gone' })).rejects.toThrow(/bin was deleted/);
    await expect(moveItemsHome(db, [], 'none')).rejects.toThrow(/at least one/);
    expect((await getItem(db, 'i-bin'))!.binId).toBe('bn-xmas4');
  });
});

describe('Split a line and Duplicate (F16)', () => {
  it('split takes n into a new line with the same details, in a new home or the same one', async () => {
    await setup();
    const part = await splitItem(db, 'i-bin', 6, { binId: 'bn-spare' });
    expect(part).toMatchObject({ name: 'Snowman lights', quantity: 6, approx: true, binId: 'bn-spare', tags: ['Outdoor'], hasPhoto: false });
    expect((await getItem(db, 'i-bin'))!.quantity).toBe(34);
    expect((await splitItem(db, 'i-bin', 4, null)).binId).toBe('bn-xmas4');
    await expect(splitItem(db, 'i-bin', 30, null)).rejects.toThrow(/fewer than 30/);
    await expect(splitItem(db, 'i-bin', 0, null)).rejects.toThrow(/at least 1/);
    await consistent();
  });

  it('duplicate: new id, “(copy)”, same home, no barcode', async () => {
    await setup();
    await db.items.update('i-spot', { barcode: '012345678905' });
    const copy = await duplicateItem(db, 'i-spot');
    expect(copy).toMatchObject({ name: 'Drill (copy)', spotId: 'sp-peg', barcode: '' });
    expect(copy.id).toMatch(/^it-/);
  });
});

describe('seasons (F11)', () => {
  it('add with the next free color; rename, recolor and setup notes; ▲/▼', async () => {
    await setup();
    const s = await addSeason(db, { name: 'Easter' });
    expect(s).toMatchObject({ color: 'gold', order: 2 });
    await expect(addSeason(db, { name: 'easter' })).rejects.toThrow(/already in the list/);
    await updateSeason(db, s.id, { name: 'Easter', color: 'purple', setupNotes: ' eggs on the porch ', setupFrom: '3/20', takedownBy: 'apr 30' });
    await moveSeason(db, s.id, -2);
    expect((await snap()).seasons.map((x) => [x.name, x.color, x.setupNotes])).toEqual([
      ['Easter', 'purple', 'eggs on the porch'],
      ['Halloween', 'orange', ''],
      ['Christmas', 'red', ''],
    ]);
    expect(nextSeasonColor(['red', 'orange', 'gold', 'green', 'teal', 'blue', 'navy', 'purple', 'pink', 'brown'])).toBe('red');
  });

  it('remove clears it from items and bins', async () => {
    await setup();
    expect(await removeSeason(db, 'se-xmas')).toEqual({ items: 0, bins: 1 });
    expect(await removeSeason(db, 'se-hall')).toEqual({ items: 1, bins: 0 });
    const s = await consistent();
    expect(s.seasons).toEqual([]);
    expect(s.items.every((i) => i.seasonId === '') && s.bins.every((b) => b.seasonId === '')).toBe(true);
  });
});

describe('tags (F11)', () => {
  it('add (no ";"), rename everywhere ignoring capitals, ▲/▼, remove everywhere', async () => {
    await setup();
    await addTag(db, 'holiday', 'Fragile');
    await expect(addTag(db, 'holiday', 'a;b')).rejects.toThrow(/can’t contain ";"/);
    await expect(addTag(db, 'holiday', 'fragile')).rejects.toThrow(/already in the list/);
    await renameTag(db, 'holiday', 'OUTDOOR', 'Yard');
    let s = await snap();
    expect(s.items.map((i) => [i.id, i.tags])).toEqual([['i-bin', ['Yard']], ['i-none', ['Yard']], ['i-spot', []]]);
    expect(s.bins.find((b) => b.id === 'bn-spare')!.tags).toEqual(['Yard']);
    await moveTag(db, 'holiday', 'Fragile', -1);
    expect((await snap()).tags.map((t) => t.name)).toEqual(['Fragile', 'Yard']);
    expect(await removeTag(db, 'holiday', 'yard')).toEqual({ items: 2, bins: 1 });
    s = await snap();
    expect(s.tags.map((t) => t.name)).toEqual(['Fragile']);
    expect(s.items.every((i) => i.tags.length === 0)).toBe(true);
  });
});
