import Papa from 'papaparse';
import { describe, expect, it } from 'vitest';
import { INVENTORY_COLUMNS, parseInventoryCsv, serializeInventoryCsv } from '../src/io/inventory-csv';
import { item } from './helpers';

const csv = (rows: string[][]) => Papa.unparse(rows, { newline: '\r\n' });

describe('inventory.csv columns (SPEC v2.0 §7, H1 layout)', () => {
  it('writes the column order', () => {
    const header = serializeInventoryCsv([]).replace(/^﻿/, '').split('\r\n')[0];
    expect(header).toBe(INVENTORY_COLUMNS.join(','));
    expect(INVENTORY_COLUMNS).toEqual(['id', 'name', 'category', 'subcategory', 'location', 'quantity', 'barcode', 'notes', 'photo_file']);
  });

  it('matches columns by header name, not position (shuffled, mixed case, padded)', () => {
    const text = csv([
      [' quantity ', 'NAME', 'id', 'Category', 'location'],
      ['4', 'Wreath', 'x-1', 'Decorations', 'Attic shelf B'],
    ]);
    const r = parseInventoryCsv(text);
    expect(r.problems).toEqual([]);
    expect(r.items[0]).toEqual(item({ id: 'x-1', name: 'Wreath', category: 'Decorations', location: 'Attic shelf B', quantity: 4 }));
  });

  it('ignores extra columns and reports them', () => {
    const r = parseInventoryCsv(csv([['id', 'name', 'category', 'quantity', 'Comment'], ['a', 'A', 'M', '0', 'hi']]));
    expect(r.problems).toEqual([]);
    expect(r.ignoredColumns).toEqual(['Comment']);
  });

  it('reports missing required columns as a whole-file problem', () => {
    const r = parseInventoryCsv(csv([['id', 'name'], ['a', 'A']]));
    expect(r.items).toEqual([]);
    expect(r.problems[0]).toMatchObject({ row: 1 });
    expect(r.problems[0]!.message).toMatch(/category, quantity/);
  });
});

describe('quoting and round-trip', () => {
  it('notes with many semicolons read back (the file isn’t taken for semicolon-separated)', () => {
    const r = parseInventoryCsv(serializeInventoryCsv([item({ id: 'A', notes: 'hooks: S; M; L; XL' }), item({ id: 'B', name: 'B' })]));
    expect([r.problems, r.items.map((i) => i.notes)]).toEqual([[], ['hooks: S; M; L; XL', '']]);
  });

  const tricky = [
    item({ id: 'n1', name: 'Lights, 100-count "warm white"', notes: 'goes on the porch rail, not the tree\nleft strand dim\n  indented "quoted" line' }),
    item({ id: 'n2', name: 'Café ½" ribbon — ×4', notes: 'commas, "quotes", and\r\nCRLF inside', location: 'Attic shelf B', subcategory: 'Ribbon & bows' }),
    item({ id: 'n3', barcode: '012345678905', quantity: 12, hasPhoto: true }),
  ];

  it('notes with commas, quotes and line breaks survive export → import exactly', () => {
    const back = parseInventoryCsv(serializeInventoryCsv(tricky));
    expect(back.problems).toEqual([]);
    expect(back.items.map((i) => ({ ...i, hasPhoto: false }))).toEqual(tricky.map((i) => ({ ...i, hasPhoto: false })));
  });

  it('keeps leading zeros in barcodes', () => {
    expect(parseInventoryCsv(serializeInventoryCsv(tricky)).items[2]!.barcode).toBe('012345678905');
  });

  it('writes photo_file only for items with a photo', () => {
    const back = parseInventoryCsv(serializeInventoryCsv(tricky));
    expect([...back.photoFiles]).toEqual([['n3', 'photos/n3.jpg']]);
  });

  it('starts with a UTF-8 BOM for Excel and reads files with or without one', () => {
    const text = serializeInventoryCsv(tricky);
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(parseInventoryCsv(text.slice(1)).items).toHaveLength(3);
  });
});

describe('row problems', () => {
  const header = ['id', 'name', 'category', 'quantity', 'barcode', 'notes'];
  const good = ['a', 'A', 'Decorations', '1', '', ''];
  const withRow = (over: Record<string, string>, id = 'b') => header.map((h, i) => (h === 'id' ? id : (over[h] ?? good[i]!)));

  it('numbers rows as a spreadsheet does, even after a multi-line note', () => {
    const r = parseInventoryCsv(csv([header, withRow({ notes: 'line 1\nline 2' }, 'a'), withRow({ quantity: '-1' })]));
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0]).toMatchObject({ row: 3 });
    expect(r.problems[0]!.message).toMatch(/negative/);
  });

  it.each([
    [{ quantity: '2.5' }, /whole number/],
    [{ quantity: '' }, /quantity is required/],
    [{ barcode: '6.35964E+11' }, /scientific notation/],
    [{ name: '' }, /name is required/],
    [{ category: '' }, /category is required/],
  ])('%j → error', (over, msg) => {
    const r = parseInventoryCsv(csv([header, withRow(over)]));
    expect(r.items).toHaveLength(0);
    expect(r.problems.map((p) => p.message).join(' | ')).toMatch(msg);
  });

  it('rejects a duplicate id (case-insensitive) and names the first row', () => {
    const r = parseInventoryCsv(csv([header, withRow({}, 'dup'), withRow({}, 'DUP')]));
    expect(r.problems[0]).toMatchObject({ row: 3 });
    expect(r.problems[0]!.message).toMatch(/first on row 2/);
  });
});
