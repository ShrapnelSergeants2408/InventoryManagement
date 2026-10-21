import { describe, expect, it } from 'vitest';
import {
  completeCategories,
  completeLocations,
  completeSuppliers,
  parseCategoriesCsv,
  parseLocationsCsv,
  parseSuppliersCsv,
  serializeCategoriesCsv,
  serializeLocationsCsv,
  serializeSuppliersCsv,
  spellLikeLists,
} from '../src/io/lists-csv';
import { item, vendor } from './helpers';

describe('suppliers.csv', () => {
  it('round-trips name, website and notes with commas and line breaks; sorted A–Z with other last', () => {
    const list = [
      { name: 'other', website: '', notes: 'Fallback, always present' },
      { name: 'WCP', website: 'https://wcproducts.com', notes: 'acct # in\nthe binder' },
      { name: 'AndyMark', website: 'https://www.andymark.com', notes: '' },
    ];
    const back = parseSuppliersCsv(serializeSuppliersCsv(list));
    expect(back.problems).toEqual([]);
    expect(back.list.map((s) => s.name)).toEqual(['AndyMark', 'WCP', 'other']);
    expect(back.list).toEqual(expect.arrayContaining(list));
  });
  it('rejects duplicate names case-insensitively', () => {
    const r = parseSuppliersCsv('name\r\nREV\r\nrev\r\n');
    expect(r.problems[0]).toMatchObject({ row: 3 });
  });
});

describe('locations.csv', () => {
  it('round-trips walk order and notes', () => {
    const list = [
      { name: 'Shelf C1', notes: '', order: 1 },
      { name: 'Bin F3', notes: 'blue tote, under the bench', order: 0 },
      { name: 'Pit cart', notes: '', order: 2 },
    ];
    const back = parseLocationsCsv(serializeLocationsCsv(list));
    expect(back.problems).toEqual([]);
    expect(back.list).toEqual([...list].sort((a, b) => a.order - b.order));
  });
  it('sorts by order, then file position for blank orders, and renumbers from 0', () => {
    const r = parseLocationsCsv('name,notes,order\r\nB,,5\r\nC,,\r\nA,,2\r\n');
    expect(r.list.map((l) => [l.name, l.order])).toEqual([['A', 0], ['B', 1], ['C', 2]]);
  });
});

describe('categories.csv (spec-questions Q3)', () => {
  it('round-trips order, subcategory order and empty categories', () => {
    const list = [
      { name: 'Structure', order: 0, subcategories: ['Tubing', 'Plate & Sheet'] },
      { name: 'Motors', order: 1, subcategories: [] },
      { name: 'New, empty', order: 2, subcategories: [] },
      { name: 'Pit & Safety', order: 3, subcategories: ['Safety', 'Empty sub'] },
    ];
    const back = parseCategoriesCsv(serializeCategoriesCsv(list));
    expect(back.problems).toEqual([]);
    expect(back.list).toEqual(list);
  });

  // §7 (v0.8): the starter catalog writes a blank-subcategory row for every category with the
  // category's position, then subcategory rows numbered by subcategory position.
  const seedLayout = [
    'category,subcategory,order',
    'Electrical,,1',
    'Electrical,Control System,1',
    'Electrical,Sensors,2',
    'Pneumatics,,2',
    'Pneumatics,Accumulation,1',
    'Pneumatics,Cylinders,2',
    'Assemblies,,3',
    'Public Relations,,4',
    'Public Relations,Labels,1',
    'Public Relations,Buttons,2',
  ].join('\n');
  const expected = [
    { name: 'Electrical', order: 0, subcategories: ['Control System', 'Sensors'] },
    { name: 'Pneumatics', order: 1, subcategories: ['Accumulation', 'Cylinders'] },
    { name: 'Assemblies', order: 2, subcategories: [] },
    { name: 'Public Relations', order: 3, subcategories: ['Labels', 'Buttons'] },
  ];

  it("reads the starter catalog's layout: category order from its first row, subcategories in row order", () => {
    const r = parseCategoriesCsv(seedLayout);
    expect(r.problems).toEqual([]);
    expect(r.list).toEqual(expected);
  });

  it('reads the v0.7 backup layout to the same list, and writes the v0.7 layout', () => {
    const v07 = serializeCategoriesCsv(expected);
    expect(v07.trim().split(/\r?\n/)).toEqual([
      'category,subcategory,order',
      'Electrical,Control System,0',
      'Electrical,Sensors,0',
      'Pneumatics,Accumulation,1',
      'Pneumatics,Cylinders,1',
      'Assemblies,,2',
      'Public Relations,Labels,3',
      'Public Relations,Buttons,3',
    ]);
    expect(parseCategoriesCsv(v07).list).toEqual(parseCategoriesCsv(seedLayout).list);
  });

  it('a later row of the seed layout never moves its category (subcategory numbers are not category positions)', () => {
    // Sensors is subcategory 9 of Electrical; Electrical must stay first.
    const r = parseCategoriesCsv(['category,subcategory,order', 'Electrical,,1', 'Electrical,Sensors,9', 'Tools,,2', 'Tools,Hammers,1'].join('\n'));
    expect(r.list.map((c) => c.name)).toEqual(['Electrical', 'Tools']);
  });
});

describe('spellLikeLists (Stage 5 finding 2)', () => {
  const categories = [
    { name: 'Motors', order: 0, subcategories: ['Brushless'] },
    { name: 'Fasteners', order: 1, subcategories: [] },
  ];
  const locations = [{ name: 'Bin F3', notes: '', order: 0 }];

  it("rewrites category, subcategory and location to the lists' spelling, ignoring capitals", () => {
    const [a] = spellLikeLists([item({ id: 'a', category: 'motors', subcategory: 'BRUSHLESS', location: 'bin f3' })], categories, locations);
    expect(a).toMatchObject({ category: 'Motors', subcategory: 'Brushless', location: 'Bin F3' });
  });

  it('leaves matching items as they are (same object) and keeps blank and unlisted names', () => {
    const ok = item({ id: 'b', category: 'Fasteners', subcategory: '', location: '' });
    const odd = item({ id: 'c', category: 'Motors', subcategory: 'Brushed', location: 'Shelf Z' });
    const out = spellLikeLists([ok, odd], categories, locations);
    expect(out[0]).toBe(ok);
    expect(out[1]).toMatchObject({ category: 'Motors', subcategory: 'Brushed', location: 'Shelf Z' });
  });

  it("never matches a subcategory from another category", () => {
    const [a] = spellLikeLists([item({ id: 'd', category: 'Fasteners', subcategory: 'brushless' })], categories, locations);
    expect(a!.subcategory).toBe('brushless');
  });
});

describe('rebuilding lists from items (§7 CSV-only restore, seed)', () => {
  const items = [
    item({ id: 'a', category: 'Motion', subcategory: 'Bearings', location: 'Bin 2', vendors: [vendor({ supplier: 'REV' }), vendor({ supplier: 'FIRST' }), null] }),
    item({ id: 'b', category: 'Structure', subcategory: 'Tubing', location: 'bin 2', vendors: [vendor({ supplier: 'rev' }), null, null] }),
    item({ id: 'c', category: 'Motion', subcategory: 'Collars', location: '' }),
  ];
  it('adds missing suppliers (case-insensitive) and always keeps other', () => {
    const r = completeSuppliers([{ name: 'REV', website: '', notes: '' }], items);
    expect(r.list.map((s) => s.name)).toEqual(['REV', 'FIRST', 'other']);
    expect(r.added).toEqual(['FIRST']);
  });
  it('appends missing locations to the end of the walk order', () => {
    const r = completeLocations([{ name: 'Shelf', notes: '', order: 0 }], items);
    expect(r.list.map((l) => [l.name, l.order])).toEqual([['Shelf', 0], ['Bin 2', 1]]);
  });
  it('appends categories and subcategories in first-appearance order', () => {
    const r = completeCategories([], items);
    expect(r.list).toEqual([
      { name: 'Motion', order: 0, subcategories: ['Bearings', 'Collars'] },
      { name: 'Structure', order: 1, subcategories: ['Tubing'] },
    ]);
  });
});
