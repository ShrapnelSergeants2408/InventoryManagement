import { describe, expect, it } from 'vitest';
import { completeCategories, parseCategoriesCsv, serializeCategoriesCsv, spellLikeLists } from '../src/io/lists-csv';
import { item } from './helpers';

describe('categories.csv (spec-questions Q3)', () => {
  it('round-trips order, subcategory order and empty categories', () => {
    const list = [
      { part: 'holiday' as const, name: 'Structure', order: 0, subcategories: ['Tubing', 'Plate & Sheet'] },
      { part: 'holiday' as const, name: 'Motors', order: 1, subcategories: [] },
      { part: 'holiday' as const, name: 'New, empty', order: 2, subcategories: [] },
      { part: 'holiday' as const, name: 'Pit & Safety', order: 3, subcategories: ['Safety', 'Empty sub'] },
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
    { part: 'household' as const, name: 'Electrical', order: 0, subcategories: ['Control System', 'Sensors'] },
    { part: 'household' as const, name: 'Pneumatics', order: 1, subcategories: ['Accumulation', 'Cylinders'] },
    { part: 'household' as const, name: 'Assemblies', order: 2, subcategories: [] },
    { part: 'household' as const, name: 'Public Relations', order: 3, subcategories: ['Labels', 'Buttons'] },
  ];

  it("reads the starter catalog's layout: category order from its first row, subcategories in row order", () => {
    const r = parseCategoriesCsv(seedLayout);
    expect(r.problems).toEqual([]);
    expect(r.list).toEqual(expected);
  });

  it('a file without a part column (0.1.2) reads as Household; written with the part first (§7)', () => {
    const v07 = serializeCategoriesCsv(expected);
    expect(v07.trim().split(/\r?\n/)).toEqual([
      'part,category,subcategory,order',
      'household,Electrical,Control System,0',
      'household,Electrical,Sensors,0',
      'household,Pneumatics,Accumulation,1',
      'household,Pneumatics,Cylinders,1',
      'household,Assemblies,,2',
      'household,Public Relations,Labels,3',
      'household,Public Relations,Buttons,3',
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
    { part: 'holiday' as const, name: 'Motors', order: 0, subcategories: ['Brushless'] },
    { part: 'holiday' as const, name: 'Fasteners', order: 1, subcategories: [] },
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
      { part: 'holiday' as const, name: 'Motion', order: 0, subcategories: ['Bearings', 'Collars'] },
      { part: 'holiday' as const, name: 'Structure', order: 1, subcategories: ['Tubing'] },
    ]);
  });
});
