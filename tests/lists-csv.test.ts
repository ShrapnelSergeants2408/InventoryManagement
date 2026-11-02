import { describe, expect, it } from 'vitest';
import { parseH1Locations } from '../src/io/h1-backup';
import { completeCategories, parseCategoriesCsv, serializeCategoriesCsv, spellLikeLists } from '../src/io/lists-csv';
import { item } from './helpers';

describe('H1 locations.csv (read only, for restoring an H1 backup)', () => {
  it('sorts by order, then file position for blank orders, and renumbers from 0; keeps notes', () => {
    const r = parseH1Locations('name,notes,order\r\nB,,5\r\nC,blue tote,\r\nA,,2\r\n');
    expect(r.list).toEqual([
      { name: 'A', notes: '', order: 0 },
      { name: 'B', notes: '', order: 1 },
      { name: 'C', notes: 'blue tote', order: 2 },
    ]);
  });
  it('a name listed twice (ignoring capitals) is a problem', () => {
    expect(parseH1Locations('name\r\nShelf\r\nshelf\r\n').problems.map((p) => p.message)).toEqual(['location "shelf" is listed twice (first on row 2)']);
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

describe('spellLikeLists', () => {
  const categories = [
    { name: 'Motors', order: 0, subcategories: ['Brushless'] },
    { name: 'Fasteners', order: 1, subcategories: [] },
  ];

  it("rewrites category and subcategory to the list's spelling, ignoring capitals", () => {
    const [a] = spellLikeLists([item({ id: 'a', category: 'motors', subcategory: 'BRUSHLESS' })], categories);
    expect(a).toMatchObject({ category: 'Motors', subcategory: 'Brushless' });
  });

  it('leaves matching items as they are (same object) and keeps blank and unlisted names', () => {
    const ok = item({ id: 'b', category: 'Fasteners', subcategory: '' });
    const odd = item({ id: 'c', category: 'Motors', subcategory: 'Brushed' });
    const out = spellLikeLists([ok, odd], categories);
    expect(out[0]).toBe(ok);
    expect(out[1]).toMatchObject({ category: 'Motors', subcategory: 'Brushed' });
  });

  it("never matches a subcategory from another category", () => {
    const [a] = spellLikeLists([item({ id: 'd', category: 'Fasteners', subcategory: 'brushless' })], categories);
    expect(a!.subcategory).toBe('brushless');
  });
});

describe('completing the category list from items (§7)', () => {
  const items = [
    item({ id: 'a', category: 'Motion', subcategory: 'Bearings' }),
    item({ id: 'b', category: 'Structure', subcategory: 'Tubing' }),
    item({ id: 'c', category: 'Motion', subcategory: 'Collars' }),
  ];
  it('appends categories and subcategories in first-appearance order', () => {
    const r = completeCategories([], items);
    expect(r.list).toEqual([
      { name: 'Motion', order: 0, subcategories: ['Bearings', 'Collars'] },
      { name: 'Structure', order: 1, subcategories: ['Tubing'] },
    ]);
  });
});
