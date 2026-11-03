// The two parts in the data layer (SPEC v3.0 §3 "Parts", F7, F10, F11): names per part, letters
// and codes across parts, no links across, and moving items and bins to the other part.
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { InventoryDb } from '../src/data/db';
import { loadSnapshot, replaceAll } from '../src/data/inventory';
import { addItem, moveItemsHome } from '../src/data/items';
import { recordBinLabels } from '../src/data/labels';
import { addTag, changeItemsCategory, removeTag, renameTag } from '../src/data/lists';
import { addArea, addBin, moveBin, moveSpotToArea, removeArea, removeSpot, updateBin } from '../src/data/places';
import { binLabelState } from '../src/domain/labels';
import { checkData } from '../src/domain/integrity';
import { area, bin, categories, dataset, item, season, spot } from './helpers';

let db: InventoryDb;
afterEach(() => db?.close());

/** Holiday: Storage room (S) › Rack 1 › S-02. Household: Garage (G) › Pegboard › G-03. */
async function setup() {
  db = new InventoryDb(`pdb-${Math.random()}`);
  await replaceAll(
    db,
    dataset({
      areas: [area({ id: 'ar-store', part: 'holiday', name: 'Storage room', letter: 'S' }), area({ id: 'ar-garage', part: 'household', name: 'Garage', letter: 'G' }), area({ id: 'ar-shed', part: 'household', name: 'Shed', letter: 'H' })],
      spots: [spot({ id: 'sp-rack', areaId: 'ar-store', name: 'Rack 1' }), spot({ id: 'sp-peg', areaId: 'ar-garage', name: 'Pegboard' }), spot({ id: 'sp-shelf', areaId: 'ar-shed', name: 'Shelf' })],
      seasons: [season({ id: 'se-xmas' })],
      bins: [bin({ id: 'bn-s2', part: 'holiday', code: 'S-02', spotId: 'sp-rack', seasonId: 'se-xmas', tags: ['Fragile'] }), bin({ id: 'bn-g3', part: 'household', code: 'G-03', name: 'Cords', spotId: 'sp-peg' })],
      items: [
        item({ id: 'i-lights', name: 'Lights', category: 'Lights', binId: 'bn-s2', seasonId: 'se-xmas', tags: ['Fragile'], quantity: 3 }),
        item({ id: 'i-drill', part: 'household', name: 'Drill', category: 'Tools', spotId: 'sp-peg', tags: ['Fragile'] }),
      ],
      tags: [
        { part: 'holiday', name: 'Fragile', order: 0 },
        { part: 'household', name: 'Fragile', order: 0 },
      ],
      categories: [...categories(['Lights', 'Tools']), { part: 'holiday', name: 'Ornaments', order: 9, subcategories: [] }],
    }),
    1,
  );
}
const snap = () => loadSnapshot(db);
const consistent = async () => expect(checkData({ ...(await snap()), photos: [] })).toEqual([]);

describe('areas: names per part, letters across both (§3)', () => {
  it('the same name in each part is fine; a letter used in the other part is refused, naming the part', async () => {
    await setup();
    const a = await addArea(db, 'household', { name: 'Storage room' });
    // S is Holiday's; the next free letter of the name is T.
    expect([a.part, a.letter]).toEqual(['household', 'T']);
    await expect(addArea(db, 'household', { name: 'storage ROOM' })).rejects.toThrow(/already in the list/);
    await expect(addArea(db, 'holiday', { name: 'Attic', letter: 'g' })).rejects.toThrow(/G is already used by “Garage” in Household/);
    await consistent();
  });

  it('removing an area moves its spots only within the part; spots never change part', async () => {
    await setup();
    await expect(removeArea(db, 'ar-garage', 'ar-store')).rejects.toThrow(/other part/);
    await expect(moveSpotToArea(db, 'sp-peg', 'ar-store')).rejects.toThrow(/Holiday; a spot stays in its part/);
    await expect(removeSpot(db, 'sp-peg', 'sp-rack')).rejects.toThrow(/same part/);
    expect(await removeArea(db, 'ar-garage', 'ar-shed')).toBe(1);
    await consistent();
  });
});

describe('bins and items stay in their part', () => {
  it('a new bin takes its spot’s part; a household bin can’t have a season', async () => {
    await setup();
    const b = await addBin(db, { code: '', name: 'Tote', spotId: 'sp-peg', seasonId: '', tags: ['Heavy'], state: 'stored', notes: '' });
    expect([b.part, b.code]).toEqual(['household', 'G-04']);
    expect((await snap()).tags.filter((t) => t.part === 'household').map((t) => t.name)).toEqual(['Fragile', 'Heavy']);
    await expect(addBin(db, { code: '', name: 'X', spotId: 'sp-peg', seasonId: 'se-xmas', tags: [], state: 'stored', notes: '' })).rejects.toThrow(/household bin has no season/);
    // An edit can't put a bin on the other part's spot; Move bin does that.
    await expect(updateBin(db, 'bn-g3', { part: 'household', code: 'G-03', name: 'Cords', spotId: 'sp-rack', seasonId: '', tags: [], state: 'stored', notes: '' })).rejects.toThrow(/use Move bin/);
    await consistent();
  });

  it('an item’s home and category must be in its part', async () => {
    await setup();
    await expect(addItem(db, item({ id: 'i-x', part: 'household', category: 'Tools', binId: 'bn-s2' }))).rejects.toThrow(/That home is in Holiday/);
    await expect(addItem(db, item({ id: 'i-y', part: 'household', category: 'Ornaments' }))).rejects.toThrow(/isn't in the Household category list/);
    await expect(addItem(db, item({ id: 'i-z', part: 'household', category: 'Tools', seasonId: 'se-xmas' }))).rejects.toThrow(/household item has no season/);
    await consistent();
  });

  it('Select › Category… refuses a mix of parts', async () => {
    await setup();
    await expect(changeItemsCategory(db, ['i-lights', 'i-drill'], { category: 'Tools', subcategory: '' })).rejects.toThrow(/different parts/);
  });
});

describe('moving to the other part (§3, F7)', () => {
  it('an item moved to a Household home becomes Household: season and tags cleared, category by name', async () => {
    await setup();
    expect(await moveItemsHome(db, ['i-lights'], { binId: 'bn-g3' })).toBe(1);
    expect((await snap()).items.find((i) => i.id === 'i-lights')).toMatchObject({ part: 'household', binId: 'bn-g3', category: 'Lights', seasonId: '', tags: [] });
    await consistent();
  });

  it('a category the new part lacks falls back to "Other", which is added if needed', async () => {
    await setup();
    await addItem(db, item({ id: 'i-orn', name: 'Glass balls', category: 'Ornaments', spotId: 'sp-rack' }));
    await moveItemsHome(db, ['i-orn'], { spotId: 'sp-shelf' });
    const s = await snap();
    expect(s.items.find((i) => i.id === 'i-orn')).toMatchObject({ part: 'household', category: 'Other', spotId: 'sp-shelf' });
    expect(s.categories.filter((c) => c.part === 'household').map((c) => c.name)).toContain('Other');
    await consistent();
  });

  it('a bin moved to the other part takes everything in it along; its code stays', async () => {
    await setup();
    const b = await moveBin(db, 'bn-s2', 'sp-shelf');
    expect(b).toMatchObject({ part: 'household', code: 'S-02', spotId: 'sp-shelf', seasonId: '', tags: [] });
    expect((await snap()).items.find((i) => i.id === 'i-lights')).toMatchObject({ part: 'household', binId: 'bn-s2', seasonId: '', tags: [] });
    // To no spot: it stays in its (new) part.
    expect((await moveBin(db, 'bn-s2', '')).part).toBe('household');
    await consistent();
  });
});

describe('tags are per part (F11)', () => {
  it('rename and remove touch only that part’s records', async () => {
    await setup();
    await addTag(db, 'household', 'Kids');
    await renameTag(db, 'holiday', 'Fragile', 'Glass');
    let s = await snap();
    expect(s.items.find((i) => i.id === 'i-lights')!.tags).toEqual(['Glass']);
    expect(s.items.find((i) => i.id === 'i-drill')!.tags).toEqual(['Fragile']);
    expect(s.bins.find((b) => b.id === 'bn-s2')!.tags).toEqual(['Glass']);
    await removeTag(db, 'household', 'Fragile');
    s = await snap();
    expect(s.items.find((i) => i.id === 'i-drill')!.tags).toEqual([]);
    expect(s.tags.map((t) => `${t.part}:${t.name}`)).toEqual(['household:Kids', 'holiday:Glass']);
    await consistent();
  });
});

describe('bin labels (F10, §4)', () => {
  it('printing records the contents, so a later change shows "Label out of date"', async () => {
    await setup();
    await recordBinLabels(db, ['bn-s2', 'gone'], 77);
    let s = await snap();
    const b = s.bins.find((x) => x.id === 'bn-s2')!;
    expect(b).toMatchObject({ labelPrintedAt: 77, labelContents: 'Lights ×3' });
    expect(binLabelState(b, s.items)).toBe('current');
    await addItem(db, item({ id: 'i-star', name: 'Star', category: 'Lights', binId: 'bn-s2', quantity: 1 }));
    s = await snap();
    expect(binLabelState(s.bins.find((x) => x.id === 'bn-s2')!, s.items)).toBe('stale');
  });
});
