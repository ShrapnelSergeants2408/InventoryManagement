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
