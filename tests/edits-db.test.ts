import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { InventoryDb } from '../src/data/db';
import { adjustCount, getItem, loadSnapshot, replaceAll, setCount } from '../src/data/inventory';
import { RECENT_LOCATIONS, addItem, deleteItem, getRecentLocations, updateItem } from '../src/data/items';
import {
  addCategory,
  addLocation,
  addSubcategory,
  addSupplier,
  moveCategory,
  moveLocation,
  moveSubcategory,
  removeCategory,
  removeLocation,
  removeSubcategory,
  removeSupplier,
  renameCategory,
  renameSubcategory,
  updateLocation,
  updateSupplier,
} from '../src/data/lists';
import { getSettings } from '../src/data/settings';
import { buildOrderList } from '../src/domain/order';
import { readSeed } from '../src/io/seed';
import { item, seedBytes, vendor } from './helpers';

let db: InventoryDb;
afterEach(() => db?.close());

const base = {
  suppliers: [
    { name: 'REV', website: 'https://www.revrobotics.com', notes: '' },
    { name: 'WCP', website: '', notes: 'ships fast' },
    { name: 'AndyMark', website: '', notes: '' },
    { name: 'other', website: '', notes: '' },
  ],
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
  item({ id: 'v1', category: 'Pneumatics', subcategory: 'Valves', location: 'Bin 1', vendors: [vendor({ supplier: 'WCP' }), vendor({ supplier: 'REV' }), null] }),
  item({ id: 'a1', category: 'Pneumatics', subcategory: 'Air Supply', location: 'Bin 2', vendors: [vendor({ supplier: 'REV' }), vendor({ supplier: 'WCP' }), null], preferredVendor: 2 }),
  item({ id: 'm1', category: 'Motors', location: '', vendors: [vendor({ supplier: 'REV' }), null, null] }),
];

async function setup(items = seedItems()) {
  db = new InventoryDb(`t-${Math.random()}`);
  await replaceAll(db, { ...base, items, photos: new Map([['m1', new Blob([new Uint8Array([1])])]]) }, 1);
}

const snap = () => loadSnapshot(db);
const lastChange = async () => (await getSettings(db)).lastChangeAt;

describe('adjustCount / setCount (detail card desired & spares, F7)', () => {
  it('steps desired and spares, never below 0, without touching last counted', async () => {
    await setup();
    expect(await adjustCount(db, 'm1', 'desired', 3, 50)).toBe(3);
    expect(await adjustCount(db, 'm1', 'spares', -1, 51)).toBe(0);
    await setCount(db, 'm1', 'spares', 4, 52);
    expect(await getItem(db, 'm1')).toMatchObject({ desired: 3, spares: 4, lastCounted: '' });
    expect(await lastChange()).toBe(52);
  });
});

describe('addItem (F6)', () => {
  it('adds the item, a new subcategory, a new location at the end of the walk order, and remembers the location', async () => {
    await setup();
    const added = await addItem(db, item({ id: 'tm-NEW01', category: 'Pneumatics', subcategory: 'Fittings', location: 'Pit cart', lastCounted: '2026-10-18' }), 99);
    const s = await snap();
    expect(s.items.find((i) => i.id === 'tm-NEW01')).toEqual(added);
    expect(s.categories[0]!.subcategories).toEqual(['Air Supply', 'Valves', 'Fittings']);
    expect(s.locations.map((l) => l.name)).toEqual(['Bin 1', 'Bin 2', 'Shelf', 'Pit cart']);
    expect(await getRecentLocations(db)).toEqual(['Pit cart']);
    expect(await lastChange()).toBe(99);
  });

  it('a location typed with other capitals uses the list’s spelling', async () => {
    await setup();
    const added = await addItem(db, item({ id: 'tm-NEW02', location: 'bin 2' }));
    expect(added.location).toBe('Bin 2');
    expect((await snap()).locations).toHaveLength(3);
  });

  it('rejects a taken id, an unknown supplier or category — and changes nothing', async () => {
    await setup();
    await expect(addItem(db, item({ id: 'm1' }))).rejects.toThrow(/already exists/);
    await expect(addItem(db, item({ id: 'tm-X', vendors: [vendor({ supplier: 'Nope' }), null, null] }))).rejects.toThrow(/Supplier list/);
    await expect(addItem(db, item({ id: 'tm-Y', category: 'Nope', location: 'New place' }))).rejects.toThrow(/category/);
    const s = await snap();
    expect(s.items).toHaveLength(3);
    expect(s.locations).toHaveLength(3);
  });
});

describe('updateItem (F7)', () => {
  it('saves the edited fields onto the stored item and keeps a count changed meanwhile', async () => {
    await setup();
    const loaded = (await getItem(db, 'm1'))!;
    await adjustCount(db, 'm1', 'onHand', 5); // someone taps +5 on the list while the editor is open
    const saved = await updateItem(db, loaded, { ...loaded, name: 'Renamed', notes: 'a, "b"\nc' }, 70);
    expect(saved).toMatchObject({ name: 'Renamed', notes: 'a, "b"\nc', onHand: 5, hasPhoto: true });
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

describe('suppliers (F23)', () => {
  it('add: duplicate names are rejected ignoring capitals; website gets https://', async () => {
    await setup();
    await expect(addSupplier(db, { name: 'wcp', website: '', notes: '' })).rejects.toThrow('“wcp” is already in the list as “WCP”');
    const s = await addSupplier(db, { name: ' Digi-Key ', website: 'digikey.com', notes: ' n ' });
    expect(s).toEqual({ name: 'Digi-Key', website: 'https://digikey.com', notes: 'n' });
    expect((await snap()).suppliers.map((x) => x.name)).toContain('Digi-Key');
  });

  it('rename updates every vendor option that uses it, and the order-list groups', async () => {
    await setup();
    await updateSupplier(db, 'WCP', { name: 'West Coast Products', website: 'wcproducts.com', notes: 'ships fast' }, 60);
    const s = await snap();
    expect(s.suppliers.find((x) => x.name === 'West Coast Products')).toEqual({ name: 'West Coast Products', website: 'https://wcproducts.com', notes: 'ships fast' });
    expect(s.suppliers.some((x) => x.name === 'WCP')).toBe(false);
    const used = s.items.flatMap((i) => i.vendors.flatMap((v) => (v ? [v.supplier] : [])));
    expect(used.filter((n) => n === 'WCP')).toEqual([]);
    expect(used.filter((n) => n === 'West Coast Products')).toHaveLength(2);
    expect((await db.items.where('supplierKeys').equals('west coast products').count())).toBe(2);
    const order = buildOrderList(s.items.map((i) => ({ ...i, desired: 1 })));
    expect(order.groups.map((g) => g.supplier).sort()).toEqual(['REV', 'West Coast Products']);
  });

  it('rename can change only capitals; renaming to another existing name is rejected', async () => {
    await setup();
    await updateSupplier(db, 'WCP', { name: 'Wcp', website: '', notes: '' });
    expect((await getItem(db, 'v1'))!.vendors[0]!.supplier).toBe('Wcp');
    await expect(updateSupplier(db, 'Wcp', { name: 'rev', website: '', notes: '' })).rejects.toThrow(/already in the list/);
  });

  it('other keeps its name and can’t be removed', async () => {
    await setup();
    await expect(updateSupplier(db, 'other', { name: 'Misc', website: '', notes: '' })).rejects.toThrow(/fallback/);
    await expect(removeSupplier(db, 'other', 'REV')).rejects.toThrow(/fallback/);
    await updateSupplier(db, 'other', { name: 'other', website: '', notes: 'anything else' });
    expect((await snap()).suppliers.find((x) => x.name === 'other')!.notes).toBe('anything else');
  });

  it('remove moves its vendor options to the replacement (default other), keeping part # and price', async () => {
    await setup();
    const before = (await getItem(db, 'v1'))!.vendors[0]!;
    expect(await removeSupplier(db, 'WCP', 'other', 61)).toBe(2);
    const s = await snap();
    expect(s.suppliers.map((x) => x.name)).toEqual(expect.not.arrayContaining(['WCP']));
    expect((await getItem(db, 'v1'))!.vendors[0]).toEqual({ ...before, supplier: 'other' });
    expect((await getItem(db, 'a1'))!.vendors[1]!.supplier).toBe('other');
    expect(await lastChange()).toBe(61);
  });

  it('remove rejects the supplier itself or an unknown one as the replacement, changing nothing', async () => {
    await setup();
    await expect(removeSupplier(db, 'WCP', 'wcp')).rejects.toThrow(/different supplier/);
    await expect(removeSupplier(db, 'WCP', 'Nope')).rejects.toThrow(/isn't in the list/);
    expect((await snap()).suppliers).toHaveLength(4);
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

describe('starter catalog: supplier rename and remove at full size', async () => {
  const seed = await readSeed(seedBytes());
  if (!seed.ok) throw new Error('seed');

  it('removing AndyMark moves every one of its options to other, and the order total is unchanged', async () => {
    db = new InventoryDb(`t-${Math.random()}`);
    await replaceAll(db, seed.data);
    const before = buildOrderList((await snap()).items);
    const using = (await snap()).items.flatMap((i) => i.vendors).filter((v) => v?.supplier === 'AndyMark').length;
    expect(using).toBeGreaterThan(0);
    expect(await removeSupplier(db, 'AndyMark', 'other')).toBeGreaterThan(0);
    const s = await snap();
    expect(s.items.flatMap((i) => i.vendors).filter((v) => v?.supplier === 'AndyMark')).toHaveLength(0);
    const after = buildOrderList(s.items);
    expect(after.grandTotalCents).toBe(before.grandTotalCents); // $8,413.66
    expect(after.grandTotalCents).toBe(841366);
    expect(after.groups.some((g) => g.supplier === 'AndyMark')).toBe(false);
  });
});
