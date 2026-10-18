import { describe, expect, it } from 'vitest';
import {
  checkName,
  isOtherSupplier,
  locationUsage,
  moveBy,
  moveItems,
  moveTargets,
  placeLabel,
  pushRecent,
  reassignLocation,
  reassignSupplier,
  renameCategoryItems,
  renameSubcategoryItems,
  renumber,
  sortSupplierNames,
  supplierUsage,
} from '../src/domain/lists';
import type { Category } from '../src/domain/types';
import { item, vendor } from './helpers';

describe('checkName (F23, F25, F9; D3)', () => {
  const list = ['AndyMark', 'REV', 'other'];

  it('trims and accepts a new name', () => {
    expect(checkName('  Digi-Key ', list, 'Supplier')).toEqual({ ok: true, name: 'Digi-Key' });
  });

  it('rejects a blank name', () => {
    expect(checkName('   ', list, 'Supplier')).toEqual({ ok: false, error: 'Supplier name is required.' });
  });

  it('rejects a duplicate ignoring capitals and names the existing entry (mockup 7b)', () => {
    expect(checkName('andymark', list, 'Supplier')).toEqual({
      ok: false,
      error: '“andymark” is already in the list as “AndyMark”. Names are compared ignoring capitals.',
    });
  });

  it('renaming to another existing name is rejected (no merge by rename)', () => {
    expect(checkName('rev', list, 'Supplier', 'AndyMark').ok).toBe(false);
  });

  it('renaming an entry to itself with different capitals is allowed', () => {
    expect(checkName('Andymark', list, 'Supplier', 'AndyMark')).toEqual({ ok: true, name: 'Andymark' });
  });
});

describe('suppliers (F23)', () => {
  it('pickers list A–Z ignoring capitals with other last', () => {
    expect(sortSupplierNames(['other', 'WCP', 'amazon', 'AndyMark', 'zip ties'])).toEqual(['amazon', 'AndyMark', 'WCP', 'zip ties', 'other']);
  });

  it('isOtherSupplier ignores capitals and spaces', () => {
    expect(isOtherSupplier(' Other ')).toBe(true);
    expect(isOtherSupplier('others')).toBe(false);
  });

  it('usage counts every vendor option and how many are preferred', () => {
    const items = [
      item({ vendors: [vendor({ supplier: 'WCP' }), vendor({ supplier: 'REV' }), null], preferredVendor: 1 }),
      item({ vendors: [vendor({ supplier: 'REV' }), vendor({ supplier: 'wcp' }), null], preferredVendor: 1 }),
      item({ vendors: [vendor({ supplier: 'REV' }), null, vendor({ supplier: 'WCP' })], preferredVendor: 3 }),
    ];
    const u = supplierUsage(items);
    expect(u.get('wcp')).toEqual({ options: 3, preferred: 2 });
    expect(u.get('rev')).toEqual({ options: 3, preferred: 1 });
    expect(u.get('amazon')).toBeUndefined();
  });

  it('reassign rewrites every option using the supplier (any capitals), keeps part #, link and price, and returns only changed items', () => {
    const a = item({ id: 'a', vendors: [vendor({ supplier: 'WCP', partNo: 'WCP-1', packPriceCents: 199 }), vendor({ supplier: 'wcp', partNo: 'X' }), null] });
    const b = item({ id: 'b', vendors: [vendor({ supplier: 'REV' }), null, null] });
    const changed = reassignSupplier([a, b], 'WCP', 'other');
    expect(changed.map((i) => i.id)).toEqual(['a']);
    expect(changed[0]!.vendors[0]).toEqual({ ...a.vendors[0], supplier: 'other' });
    expect(changed[0]!.vendors[1]!.supplier).toBe('other');
    expect(changed[0]!.vendors[2]).toBeNull();
    expect(a.vendors[0]!.supplier).toBe('WCP'); // input not mutated
  });

  it('a rename that only changes capitals still rewrites the options', () => {
    const a = item({ vendors: [vendor({ supplier: 'Wcp' }), null, null] });
    expect(reassignSupplier([a], 'Wcp', 'WCP')[0]!.vendors[0]!.supplier).toBe('WCP');
    expect(reassignSupplier([a], 'Wcp', 'Wcp')).toEqual([]);
  });
});

describe('locations (F25)', () => {
  it('usage groups items by location ignoring capitals; no location under ""', () => {
    const u = locationUsage([item({ id: 'a', location: 'Bin 1' }), item({ id: 'b', location: 'bin 1' }), item({ id: 'c', location: '' })]);
    expect(u.get('bin 1')!.map((i) => i.id)).toEqual(['a', 'b']);
    expect(u.get('')!.map((i) => i.id)).toEqual(['c']);
  });

  it('reassign moves items to the replacement, or to No location', () => {
    const items = [item({ id: 'a', location: 'Bin 1' }), item({ id: 'b', location: 'Shelf' }), item({ id: 'c', location: '' })];
    expect(reassignLocation(items, 'bin 1', 'Shelf').map((i) => [i.id, i.location])).toEqual([['a', 'Shelf']]);
    expect(reassignLocation(items, 'Bin 1', '').map((i) => [i.id, i.location])).toEqual([['a', '']]);
  });

  it('recent locations: most recent first, no duplicates (ignoring capitals), at most 5', () => {
    expect(pushRecent(['A', 'B', 'C'], 'b')).toEqual(['b', 'A', 'C']);
    expect(pushRecent(['A', 'B', 'C', 'D', 'E'], 'F')).toEqual(['F', 'A', 'B', 'C', 'D']);
    expect(pushRecent(['A'], '')).toEqual(['A']);
  });
});

describe('reorder (▲/▼ Reorder mode, F9/F25)', () => {
  it('moves one place up or down', () => {
    expect(moveBy(['a', 'b', 'c'], 1, -1)).toEqual(['b', 'a', 'c']);
    expect(moveBy(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'c', 'b']);
  });

  it('▲ on the first and ▼ on the last change nothing', () => {
    expect(moveBy(['a', 'b'], 0, -1)).toEqual(['a', 'b']);
    expect(moveBy(['a', 'b'], 1, 1)).toEqual(['a', 'b']);
    expect(moveBy(['a', 'b'], 5, -1)).toEqual(['a', 'b']);
  });

  it('renumber sets order to the list position', () => {
    expect(renumber([{ n: 'x', order: 4 }, { n: 'y', order: 9 }])).toEqual([{ n: 'x', order: 0 }, { n: 'y', order: 1 }]);
  });
});

describe('categories (F9)', () => {
  const cats: Category[] = [
    { name: 'Pneumatics', order: 0, subcategories: ['Air Supply', 'Valves'] },
    { name: 'Motors', order: 1, subcategories: [] },
  ];
  const items = [
    item({ id: 'v', category: 'Pneumatics', subcategory: 'Valves' }),
    item({ id: 'a', category: 'Pneumatics', subcategory: 'Air Supply' }),
    item({ id: 'p', category: 'Pneumatics', subcategory: '' }),
    item({ id: 'm', category: 'Motors' }),
  ];

  it('move targets for a subcategory: every category and subcategory except itself (mockup 7g)', () => {
    expect(moveTargets(cats, { category: 'Pneumatics', subcategory: 'Valves' }).map(placeLabel)).toEqual(['Pneumatics', 'Pneumatics › Air Supply', 'Motors']);
  });

  it('move targets for a category leave out the category and all its subcategories', () => {
    expect(moveTargets(cats, { category: 'Pneumatics' }).map(placeLabel)).toEqual(['Motors']);
  });

  it('moving a subcategory’s items changes only those items', () => {
    const moved = moveItems(items, { category: 'Pneumatics', subcategory: 'Valves' }, { category: 'Pneumatics', subcategory: 'Air Supply' });
    expect(moved.map((i) => [i.id, i.category, i.subcategory])).toEqual([['v', 'Pneumatics', 'Air Supply']]);
  });

  it('moving a category’s items moves every subcategory’s items to the destination', () => {
    const moved = moveItems(items, { category: 'Pneumatics' }, { category: 'Motors', subcategory: '' });
    expect(moved.map((i) => i.id)).toEqual(['v', 'a', 'p']);
    expect(moved.every((i) => i.category === 'Motors' && i.subcategory === '')).toBe(true);
  });

  it('renaming a category keeps each item’s subcategory', () => {
    const r = renameCategoryItems(items, 'Pneumatics', 'Air');
    expect(r.map((i) => [i.id, i.category, i.subcategory])).toEqual([
      ['v', 'Air', 'Valves'],
      ['a', 'Air', 'Air Supply'],
      ['p', 'Air', ''],
    ]);
    expect(renameCategoryItems(items, 'Motors', 'Motors')).toEqual([]);
  });

  it('renaming a subcategory changes only its items', () => {
    expect(renameSubcategoryItems(items, 'Pneumatics', 'Valves', 'Solenoids').map((i) => [i.id, i.subcategory])).toEqual([['v', 'Solenoids']]);
  });
});
