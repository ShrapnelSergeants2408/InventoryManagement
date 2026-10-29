import Papa from 'papaparse';
import { describe, expect, it } from 'vitest';
import { INVENTORY_COLUMNS, parseInventoryCsv, serializeInventoryCsv } from '../src/io/inventory-csv';
import { item, vendor } from './helpers';

const csv = (rows: string[][]) => Papa.unparse(rows, { newline: '\r\n' });

describe('inventory.csv columns (SPEC §7)', () => {
  it('writes the §7 column order, with last_counted and counted_by after photo_file', () => {
    const header = serializeInventoryCsv([]).replace(/^﻿/, '').split('\r\n')[0];
    expect(header).toBe(INVENTORY_COLUMNS.join(','));
    expect(INVENTORY_COLUMNS.slice(0, 16)).toEqual([
      'id', 'name', 'category', 'subcategory', 'location', 'unit', 'on_hand', 'desired', 'spares',
      'barcode', 'notes', 'source', 'preferred_vendor', 'photo_file', 'last_counted', 'counted_by',
    ]);
    expect(INVENTORY_COLUMNS).toHaveLength(16 + 18);
  });

  it('matches columns by header name, not position (shuffled, mixed case, padded)', () => {
    const text = csv([
      ['V1_Pack_Price', ' desired ', 'NAME', 'unit', 'v1_supplier', 'id', 'on_hand', 'category', 'v1_pack_size'],
      ['9.99', '4', 'Bolt', 'each', 'REV', 'x-1', '1', 'Fasteners', '10'],
    ]);
    const r = parseInventoryCsv(text);
    expect(r.problems).toEqual([]);
    expect(r.items[0]).toMatchObject({ id: 'x-1', name: 'Bolt', desired: 4, onHand: 1, spares: 0 });
    expect(r.items[0]!.vendors[0]).toMatchObject({ supplier: 'REV', packSize: 10, packPriceCents: 999 });
  });

  it('loads files without last_counted (older files) with it blank', () => {
    const cols = INVENTORY_COLUMNS.filter((c) => c !== 'last_counted');
    const row = cols.map((c) =>
      ({ id: 'a', name: 'A', category: 'Motors', unit: 'each', on_hand: '0', desired: '1', spares: '0', source: 'starter', preferred_vendor: '1', v1_supplier: 'REV', v1_pack_size: '1' })[c] ?? '',
    );
    const r = parseInventoryCsv(csv([cols, row]));
    expect(r.problems).toEqual([]);
    expect(r.items[0]!.lastCounted).toBe('');
  });

  it('ignores extra columns and reports them', () => {
    const r = parseInventoryCsv(csv([['id', 'name', 'category', 'unit', 'on_hand', 'desired', 'v1_supplier', 'v1_pack_size', 'Comment'], ['a', 'A', 'M', 'each', '0', '0', 'REV', '1', 'hi']]));
    expect(r.problems).toEqual([]);
    expect(r.ignoredColumns).toEqual(['Comment']);
  });

  it('reports missing required columns as a whole-file problem', () => {
    const r = parseInventoryCsv(csv([['id', 'name'], ['a', 'A']]));
    expect(r.items).toEqual([]);
    expect(r.problems[0]).toMatchObject({ row: 1 });
    expect(r.problems[0]!.message).toMatch(/category, unit, on_hand, desired/);
  });
});

describe('quoting and round-trip', () => {
  it('notes with many semicolons read back (the file isn’t taken for semicolon-separated)', () => {
    const r = parseInventoryCsv(serializeInventoryCsv([item({ id: 'A', notes: 'use: M3; M4; M5; M6; M8; M10; M12' }), item({ id: 'B', name: 'B' })]));
    expect([r.problems, r.items.map((i) => i.notes)]).toEqual([[], ['use: M3; M4; M5; M6; M8; M10; M12', '']]);
  });

  const tricky = [
    item({ id: 'n1', name: 'Bolt, 10-32 x 3/4"', notes: 'use with Thrifty swerve, not tank\nask mentor before cutting\n  indented "quoted" line' }),
    item({ id: 'n2', name: 'Café ½" tube — ×4', notes: 'commas, "quotes", and\r\nCRLF inside', location: 'Bin F3' }),
    item({
      id: 'n3',
      lastCounted: '2026-10-24T18:42:07-05:00',
      countedBy: 'Tablet 2 · Alex & Jordan, "B"',
      barcode: '012345678905',
      preferredVendor: 2,
      vendors: [vendor({ supplier: 'REV' }), vendor({ supplier: 'WCP', packSize: 25, packPriceCents: null, priceChecked: '', url: 'https://x.test/a?b=1,2' }), null],
      hasPhoto: true,
    }),
  ];

  it('notes with commas, quotes and line breaks survive export → import exactly', () => {
    const back = parseInventoryCsv(serializeInventoryCsv(tricky));
    expect(back.problems).toEqual([]);
    expect(back.items.map((i) => ({ ...i, hasPhoto: false }))).toEqual(tricky.map((i) => ({ ...i, hasPhoto: false })));
  });

  it('keeps leading zeros in barcodes and blank prices as no price', () => {
    const back = parseInventoryCsv(serializeInventoryCsv(tricky));
    expect(back.items[2]!.barcode).toBe('012345678905');
    expect(back.items[2]!.vendors[1]!.packPriceCents).toBeNull();
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
  const header = ['id', 'name', 'category', 'unit', 'on_hand', 'desired', 'spares', 'preferred_vendor', 'last_counted', 'barcode', 'v1_supplier', 'v1_pack_size', 'v1_pack_price', 'v1_price_checked', 'notes'];
  const good = ['a', 'A', 'Motors', 'each', '0', '1', '0', '1', '', '', 'REV', '1', '5.00', '2026-10-17', ''];
  const withRow = (over: Record<string, string>, id = 'b') => header.map((h, i) => (h === 'id' ? id : (over[h] ?? good[i]!)));

  it('numbers rows as a spreadsheet does, even after a multi-line note', () => {
    const r = parseInventoryCsv(csv([header, withRow({ notes: 'line 1\nline 2' }, 'a'), withRow({ on_hand: '-1' })]));
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0]).toMatchObject({ row: 3 });
    expect(r.problems[0]!.message).toMatch(/negative/);
  });

  it.each([
    [{ on_hand: '2.5' }, /whole number/],
    [{ desired: '' }, /desired is required/],
    [{ v1_pack_size: '0' }, /pack size/],
    [{ v1_pack_price: '1.999' }, /2 decimal places/],
    [{ v1_supplier: '' }, /supplier is required/],
    [{ preferred_vendor: '2' }, /preferred vendor 2/],
    [{ preferred_vendor: '4' }, /1, 2 or 3/],
    [{ last_counted: '2026-13-01' }, /last counted/],
    [{ barcode: '6.35964E+11' }, /scientific notation/],
    [{ name: '' }, /name is required/],
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

  it('accepts US spreadsheet dates and stores them as ISO', () => {
    const r = parseInventoryCsv(csv([header, withRow({ last_counted: '10/24/2026', v1_price_checked: '1/5/2027' })]));
    expect(r.problems).toEqual([]);
    expect(r.items[0]!.lastCounted).toBe('2026-10-24T00:00:00-05:00');
    expect(r.items[0]!.vendors[0]!.priceChecked).toBe('2027-01-05');
  });

  it('blank spares default to 0 and blank source to team', () => {
    const r = parseInventoryCsv(csv([header, withRow({ spares: '' })]));
    expect(r.items[0]).toMatchObject({ spares: 0, source: 'team' });
  });
});
