import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InventoryDb } from '../src/data/db';
import { adjustQuantity, getItem, loadSnapshot, replaceAll } from '../src/data/inventory';
import { RECENT_LOCATIONS, addItem, deleteItem, getRecentLocations, updateItem } from '../src/data/items';
import {
  addCategory,
  addLocation,
  addSubcategory,
  moveCategory,
  moveLocation,
  moveItemsTo,
  moveSubcategory,
  removeCategory,
  removeLocation,
  removeSubcategory,
  renameCategory,
  renameSubcategory,
  updateLocation,
} from '../src/data/lists';
import { getSettings } from '../src/data/settings';
import { item } from './helpers';

let db: InventoryDb;
afterEach(() => db?.close());

const base = {
  locations: [
    { name: 'Bin 1', notes: '', order: 0 },
    { name: 'Bin 2', notes: 'top shelf', order: 1 },
    { name: 'Shelf', notes: '', order: 2 },
  ],
  categories: [
    { name: 'Pneumatics', order: 0, subcategories: ['Air Supply', 'Valves'] },
    { name: 'Motors', order: 1, subcategories: [] },
    { name: 'Empty', order: 2, subcategories: [] },
  ],
};
const seedItems = () => [
  item({ id: 'v1', category: 'Pneumatics', subcategory: 'Valves', location: 'Bin 1' }),
  item({ id: 'a1', category: 'Pneumatics', subcategory: 'Air Supply', location: 'Bin 2' }),
  item({ id: 'm1', category: 'Motors', location: '' }),
];

async function setup(items = seedItems()) {
  db = new InventoryDb(`t-${Math.random()}`);
  await replaceAll(db, { ...base, items, photos: new Map([['m1', new Blob([new Uint8Array([1])])]]) }, 1);
}

const snap = () => loadSnapshot(db);
const lastChange = async () => (await getSettings(db)).lastChangeAt;

describe('addItem (F6)', () => {
  it('adds the item, a new subcategory, a new location at the end of the walk order, and remembers the location', async () => {
    await setup();
    const added = await addItem(db, item({ id: 'it-NEW00001', category: 'Pneumatics', subcategory: 'Fittings', location: 'Pit cart' }), 99);
    const s = await snap();
    expect(s.items.find((i) => i.id === 'it-NEW00001')).toEqual(added);
    expect(s.categories[0]!.subcategories).toEqual(['Air Supply', 'Valves', 'Fittings']);
    expect(s.locations.map((l) => l.name)).toEqual(['Bin 1', 'Bin 2', 'Shelf', 'Pit cart']);
    expect(await getRecentLocations(db)).toEqual(['Pit cart']);
    expect(await lastChange()).toBe(99);
  });

  it('a location typed with other capitals uses the list’s spelling', async () => {
    await setup();
    const added = await addItem(db, item({ id: 'it-NEW00002', category: 'Motors', location: 'bin 2' }));
    expect(added.location).toBe('Bin 2');
    expect((await snap()).locations).toHaveLength(3);
  });

  it('rejects a taken id, an unknown category or a bad quantity — and changes nothing', async () => {
    await setup();
    await expect(addItem(db, item({ id: 'm1', category: 'Motors' }))).rejects.toThrow(/already exists/);
    await expect(addItem(db, item({ id: 'it-X', category: 'Motors', quantity: -2 }))).rejects.toThrow(/quantity/);
    await expect(addItem(db, item({ id: 'it-Y', category: 'Nope', location: 'New place' }))).rejects.toThrow(/category/);
    const s = await snap();
    expect(s.items).toHaveLength(3);
    expect(s.locations).toHaveLength(3);
  });
});

describe('updateItem (F7)', () => {
  it('saves the edited fields onto the stored item and keeps a quantity changed meanwhile', async () => {
    await setup();
    const loaded = (await getItem(db, 'm1'))!;
    await adjustQuantity(db, 'm1', 5); // someone taps +5 on the list while the editor is open
    const saved = await updateItem(db, loaded, { ...loaded, name: 'Renamed', notes: 'a, "b"\nc' }, 70);
    expect(saved).toMatchObject({ name: 'Renamed', notes: 'a, "b"\nc', quantity: 5, hasPhoto: true });
    expect(await getItem(db, 'm1')).toEqual(saved);
  });

  it('fails cleanly if the item was deleted while the editor was open', async () => {
    await setup();
    const loaded = (await getItem(db, 'm1'))!;
    await deleteItem(db, 'm1');
    await expect(updateItem(db, loaded, { ...loaded, name: 'x' })).rejects.toThrow(/deleted/);
  });
});

describe('deleteItem (F8)', () => {
  it('removes the item and its photo', async () => {
    await setup();
    await deleteItem(db, 'm1', 80);
    expect(await getItem(db, 'm1')).toBeNull();
    expect(await db.photos.get('m1')).toBeUndefined();
    expect(await lastChange()).toBe(80);
    await expect(deleteItem(db, 'm1')).rejects.toThrow(/no item/);
  });
});

describe('locations (F25)', () => {
  it('add goes to the end of the walk order; duplicates rejected', async () => {
    await setup();
    await addLocation(db, 'Pit cart', ' tote ');
    await expect(addLocation(db, 'pit CART')).rejects.toThrow(/already in the list/);
    expect((await snap()).locations).toEqual([
      { name: 'Bin 1', notes: '', order: 0 },
      { name: 'Bin 2', notes: 'top shelf', order: 1 },
      { name: 'Shelf', notes: '', order: 2 },
      { name: 'Pit cart', notes: 'tote', order: 3 },
    ]);
  });

  it('"No location" is reserved for items without one', async () => {
    await setup();
    await expect(addLocation(db, 'no location')).rejects.toThrow('already in the list as “No location”');
    await expect(updateLocation(db, 'Shelf', 'No Location', '')).rejects.toThrow(/No location/);
  });

  it('rename updates every item using it, and the recent quick picks', async () => {
    await setup();
    await db.settings.put({ key: RECENT_LOCATIONS, value: ['Bin 2', 'Shelf'] });
    await updateLocation(db, 'bin 2', 'Bin F2', 'top shelf, left');
    expect((await getItem(db, 'a1'))!.location).toBe('Bin F2');
    expect((await snap()).locations[1]).toEqual({ name: 'Bin F2', notes: 'top shelf, left', order: 1 });
    expect(await getRecentLocations(db)).toEqual(['Bin F2', 'Shelf']);
  });

  it('remove moves items to the replacement or to No location, and renumbers the walk order', async () => {
    await setup();
    expect(await removeLocation(db, 'Bin 1', 'Shelf')).toBe(1);
    expect((await getItem(db, 'v1'))!.location).toBe('Shelf');
    expect(await removeLocation(db, 'Bin 2', '')).toBe(1);
    expect((await getItem(db, 'a1'))!.location).toBe('');
    expect((await snap()).locations).toEqual([{ name: 'Shelf', notes: '', order: 0 }]);
    await expect(removeLocation(db, 'Shelf', 'shelf')).rejects.toThrow(/different location/);
  });

  it('▲/▼ moves one place; the ends don’t move', async () => {
    await setup();
    await moveLocation(db, 'Shelf', -1);
    expect((await snap()).locations.map((l) => l.name)).toEqual(['Bin 1', 'Shelf', 'Bin 2']);
    await moveLocation(db, 'Bin 1', -1);
    await moveLocation(db, 'Bin 2', 1);
    expect((await snap()).locations.map((l) => [l.name, l.order])).toEqual([['Bin 1', 0], ['Shelf', 1], ['Bin 2', 2]]);
  });
});

describe('categories (F9)', () => {
  it('add category and subcategory; duplicates rejected (subcategories within their category)', async () => {
    await setup();
    await addCategory(db, 'Tools');
    await expect(addCategory(db, 'motors')).rejects.toThrow(/already in the list/);
    await addSubcategory(db, 'Motors', 'Brushless');
    await addSubcategory(db, 'Empty', 'Valves'); // same name in another category is fine
    await expect(addSubcategory(db, 'Pneumatics', 'valves')).rejects.toThrow(/already in the list/);
    const s = await snap();
    expect(s.categories.map((c) => [c.name, c.order, c.subcategories])).toEqual([
      ['Pneumatics', 0, ['Air Supply', 'Valves']],
      ['Motors', 1, ['Brushless']],
      ['Empty', 2, ['Valves']],
      ['Tools', 3, []],
    ]);
  });

  it('rename moves the items with it and keeps the list position', async () => {
    await setup();
    await renameCategory(db, 'Pneumatics', 'Air');
    const s = await snap();
    expect(s.categories.map((c) => c.name)).toEqual(['Air', 'Motors', 'Empty']);
    expect(s.categories[0]!.subcategories).toEqual(['Air Supply', 'Valves']);
    expect((await getItem(db, 'v1'))).toMatchObject({ category: 'Air', subcategory: 'Valves' });
  });

  it('rename subcategory moves its items', async () => {
    await setup();
    await renameSubcategory(db, 'Pneumatics', 'Valves', 'Solenoids');
    expect((await snap()).categories[0]!.subcategories).toEqual(['Air Supply', 'Solenoids']);
    expect((await getItem(db, 'v1'))!.subcategory).toBe('Solenoids');
  });

  it('remove is blocked until empty; with a destination the items move first (mockup 7g)', async () => {
    await setup();
    await expect(removeSubcategory(db, 'Pneumatics', 'Valves', null)).rejects.toThrow('still holds 1 item');
    expect(await removeSubcategory(db, 'Pneumatics', 'Valves', { category: 'Pneumatics', subcategory: 'Air Supply' })).toBe(1);
    expect((await getItem(db, 'v1'))!.subcategory).toBe('Air Supply');
    expect((await snap()).categories[0]!.subcategories).toEqual(['Air Supply']);

    await expect(removeCategory(db, 'Pneumatics', null)).rejects.toThrow('still holds 2 items');
    await expect(removeCategory(db, 'Pneumatics', { category: 'Pneumatics', subcategory: '' })).rejects.toThrow(/outside/);
    expect(await removeCategory(db, 'Pneumatics', { category: 'Motors', subcategory: '' })).toBe(2);
    const s = await snap();
    expect(s.categories.map((c) => [c.name, c.order])).toEqual([['Motors', 0], ['Empty', 1]]);
    expect(s.items.filter((i) => i.category === 'Motors')).toHaveLength(3);
  });

  it('an item stored with other capitals still counts, edits and follows a rename', async () => {
    await setup([...seedItems(), item({ id: 'lc', category: 'pneumatics', subcategory: 'valves' })]);
    // Remove is blocked: the item counts as in Pneumatics › Valves.
    await expect(removeSubcategory(db, 'Pneumatics', 'Valves', null)).rejects.toThrow('still holds 2 items');
    await expect(removeCategory(db, 'Pneumatics', null)).rejects.toThrow('still holds 3 items');
    // An edit (notes only) saves, and takes the list's spelling without adding a "valves" subcategory.
    const before = (await getItem(db, 'lc'))!;
    const saved = await updateItem(db, before, { ...before, notes: 'checked' }, 60);
    expect(saved).toMatchObject({ category: 'Pneumatics', subcategory: 'Valves', notes: 'checked' });
    expect((await snap()).categories[0]!.subcategories).toEqual(['Air Supply', 'Valves']);
    // A rename moves it too.
    await renameCategory(db, 'Pneumatics', 'Air');
    expect((await getItem(db, 'lc'))!.category).toBe('Air');
  });

  it('an empty category or subcategory is removed without a destination', async () => {
    await setup();
    expect(await removeCategory(db, 'Empty', null)).toBe(0);
    await addSubcategory(db, 'Motors', 'Brushed');
    expect(await removeSubcategory(db, 'Motors', 'Brushed', null)).toBe(0);
    expect((await snap()).categories.map((c) => c.name)).toEqual(['Pneumatics', 'Motors']);
  });

  it('a failed move leaves everything unchanged', async () => {
    await setup();
    await expect(removeCategory(db, 'Pneumatics', { category: 'Motors', subcategory: 'Nope' })).rejects.toThrow(/isn't a subcategory/);
    const s = await snap();
    expect(s.categories).toHaveLength(3);
    expect(s.items.filter((i) => i.category === 'Pneumatics')).toHaveLength(2);
  });

  it('▲/▼ reorders categories and subcategories', async () => {
    await setup();
    await moveCategory(db, 'Empty', -1);
    await moveSubcategory(db, 'Pneumatics', 'Valves', -1);
    const s = await snap();
    expect(s.categories.map((c) => c.name)).toEqual(['Pneumatics', 'Empty', 'Motors']);
    expect(s.categories[0]!.subcategories).toEqual(['Valves', 'Air Supply']);
  });
});

describe('bulk move (F28, SPEC §19)', () => {
  const fields = (i: Awaited<ReturnType<typeof getItem>>) => {
    const { category: _c, subcategory: _s, ...rest } = i!;
    return rest;
  };

  it('moves the chosen items to a category and subcategory; only those two fields change; reports the count', async () => {
    await setup();
    const before = await snap();
    expect(await moveItemsTo(db, ['v1', 'm1'], { category: 'Pneumatics', subcategory: 'Air Supply' }, {}, 70)).toBe(2);
    const after = await snap();
    for (const id of ['v1', 'm1']) {
      const b = before.items.find((i) => i.id === id)!;
      const a = after.items.find((i) => i.id === id)!;
      expect([a.category, a.subcategory]).toEqual(['Pneumatics', 'Air Supply']);
      expect(fields(a)).toEqual(fields(b));
    }
    // Items not chosen don't change; the lists don't change.
    expect(after.items.find((i) => i.id === 'a1')).toEqual(before.items.find((i) => i.id === 'a1'));
    expect(after.categories).toEqual(before.categories);
    expect(await lastChange()).toBe(70);
  });

  it('to a category with no subcategory', async () => {
    await setup();
    await moveItemsTo(db, ['v1', 'a1'], { category: 'Empty', subcategory: '' });
    expect((await snap()).items.filter((i) => i.category === 'Empty').map((i) => [i.id, i.subcategory]).sort()).toEqual([['a1', ''], ['v1', '']]);
  });

  it('"+ New subcategory…" and "+ New category…" are created in the same step; a name already there (other capitals) is reused', async () => {
    await setup();
    await moveItemsTo(db, ['m1'], { category: 'Motors', subcategory: 'Brushless' }, { create: true });
    await moveItemsTo(db, ['v1'], { category: 'Game Pieces', subcategory: 'Balls' }, { create: true });
    await moveItemsTo(db, ['a1'], { category: 'game pieces', subcategory: 'BALLS' }, { create: true });
    const s = await snap();
    expect(s.categories.map((c) => [c.name, c.order, c.subcategories])).toEqual([
      ['Pneumatics', 0, ['Air Supply', 'Valves']],
      ['Motors', 1, ['Brushless']],
      ['Empty', 2, []],
      ['Game Pieces', 3, ['Balls']],
    ]);
    expect(s.items.map((i) => [i.id, i.category, i.subcategory]).sort()).toEqual([
      ['a1', 'Game Pieces', 'Balls'],
      ['m1', 'Motors', 'Brushless'],
      ['v1', 'Game Pieces', 'Balls'],
    ]);
  });

  it('without create, an unknown category or subcategory is refused and nothing changes', async () => {
    await setup();
    const before = await snap();
    await expect(moveItemsTo(db, ['m1'], { category: 'Nope', subcategory: '' })).rejects.toThrow(/isn't in the list/);
    await expect(moveItemsTo(db, ['m1'], { category: 'Motors', subcategory: 'Nope' })).rejects.toThrow(/isn't a subcategory/);
    await expect(moveItemsTo(db, [], { category: 'Motors', subcategory: '' })).rejects.toThrow(/at least one/);
    expect(await snap()).toEqual(before);
  });

  it('all or nothing: a deleted item, or a failed write, leaves every item and list as it was', async () => {
    await setup();
    const before = await snap();
    await expect(moveItemsTo(db, ['m1', 'gone'], { category: 'Game Pieces', subcategory: '' }, { create: true })).rejects.toThrow(/deleted meanwhile/);
    expect(await snap()).toEqual(before);
    const spy = vi.spyOn(db.items, 'bulkPut').mockRejectedValueOnce(new Error('disk full'));
    await expect(moveItemsTo(db, ['m1', 'v1'], { category: 'Game Pieces', subcategory: 'Balls' }, { create: true })).rejects.toThrow('disk full');
    spy.mockRestore();
    expect(await snap()).toEqual(before);
  });

  it('items already there count but are not rewritten; each item counts once', async () => {
    await setup();
    const row = await db.items.get('a1');
    expect(await moveItemsTo(db, ['a1', 'v1', 'v1'], { category: 'Pneumatics', subcategory: 'Air Supply' }, {}, 80)).toBe(2);
    expect((await db.items.get('a1'))!.updatedAt).toBe(row!.updatedAt);
    expect((await db.items.get('v1'))!.updatedAt).toBe(80);
  });
});
