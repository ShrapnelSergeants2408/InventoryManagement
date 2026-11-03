import Papa from 'papaparse';
import { describe, expect, it } from 'vitest';
import { checkData } from '../src/domain/integrity';
import { ITEM_COLUMNS, parseAreas, parseBins, parseFiles, parseItems, parseSeasons, parseSpots, parseTags, serializeAreas, serializeBins, serializeItems, serializeSeasons, serializeSpots, serializeTags } from '../src/io/household-csv';
import { area, bin, dataset, item, season, spot } from './helpers';

const csv = (rows: string[][]) => Papa.unparse(rows, { newline: '\r\n' });

describe('items.csv columns (SPEC v3.0 §7)', () => {
  it('writes the §7 column order', () => {
    const header = serializeItems([]).replace(/^﻿/, '').split('\r\n')[0];
    expect(header).toBe(ITEM_COLUMNS.join(','));
    expect(ITEM_COLUMNS.slice(0, 8)).toEqual(['id', 'part', 'name', 'category', 'subcategory', 'bin_id', 'spot_id', 'quantity']);
    expect(ITEM_COLUMNS).toEqual(expect.arrayContaining(['display_id', 'out_display_id', 'checked_at']));
  });

  it('matches columns by header name, not position (shuffled, mixed case, padded); the rest default', () => {
    const r = parseItems(csv([[' quantity ', 'NAME', 'id', 'Category', 'Spot_ID', ' Part'], ['4', 'Wreath', 'x-1', 'Decorations', 'sp-1', 'Holiday']]));
    expect(r.problems).toEqual([]);
    expect(r.hasPart).toBe(true);
    expect(r.list[0]).toEqual(item({ id: 'x-1', name: 'Wreath', category: 'Decorations', spotId: 'sp-1', quantity: 4 }));
  });

  it('a file without a part column (0.1.2) reads as Household and says so; a bad part is a problem', () => {
    const r = parseItems(csv([['id', 'name', 'category', 'quantity'], ['x-1', 'Rake', 'Tools', '1']]));
    expect([r.hasPart, r.list[0]!.part]).toEqual([false, 'household']);
    const bad = parseItems(csv([['id', 'part', 'name', 'category', 'quantity'], ['x-1', 'garage', 'Rake', 'Tools', '1']]));
    expect(bad.problems.map((p) => p.message)).toEqual(['part "garage" must be one of: household, holiday']);
  });

  it('ignores extra columns and reports them', () => {
    const r = parseItems(csv([['id', 'name', 'category', 'quantity', 'Comment'], ['a', 'A', 'M', '0', 'hi']]));
    expect(r.problems).toEqual([]);
    expect(r.ignoredColumns).toEqual(['Comment']);
  });

  it('reports missing required columns as a whole-file problem', () => {
    const r = parseItems(csv([['id', 'name'], ['a', 'A']]));
    expect(r.list).toEqual([]);
    expect(r.problems[0]).toMatchObject({ row: 1 });
    expect(r.problems[0]!.message).toMatch(/category, quantity/);
  });
});

describe('quoting and round-trip', () => {
  const tricky = [
    item({ id: 'n1', name: 'Lights, 100-count "warm white"', notes: 'goes on the porch rail, not the tree\nleft strand dim\n  indented "quoted" line', tags: ['Outdoor', 'Kids’ room'] }),
    item({ id: 'n2', name: 'Café ½" ribbon — ×4', notes: 'commas, "quotes", and\r\nCRLF inside', binId: 'bn-1', subcategory: 'Ribbon & bows', approx: true, quantity: 40 }),
    item({ id: 'n3', barcode: '012345678905', quantity: 12, status: 'out', outWhere: 'Mantel', outSince: Date.UTC(2026, 11, 1, 18, 0, 0, 123), value: 5, keepAtLeast: 0, displayId: 'dp-MANTEL01', outDisplayId: 'dp-PORCH001', checkedAt: Date.UTC(2026, 0, 2) }),
    item({ id: 'n4', part: 'household', status: 'lent', lentTo: 'Mike, next door', lentOn: '2026-10-30', condition: 'replace', conditionNote: 'cord frayed; "unsafe"', purchaseDate: '2020-02-29', model: 'M; 2', serial: '007', warrantyUntil: '2030-01-01', value: 123456 }),
  ];

  it('every field survives export → import exactly', () => {
    const back = parseItems(serializeItems(tricky));
    expect(back.problems).toEqual([]);
    expect(back.list).toEqual(tricky);
  });

  it('notes with many semicolons read back (the file isn’t taken for semicolon-separated)', () => {
    const r = parseItems(serializeItems([item({ id: 'A', notes: 'hooks: S; M; L; XL' })]));
    expect([r.problems, r.list.map((i) => i.notes)]).toEqual([[], ['hooks: S; M; L; XL']]);
  });

  it('keeps leading zeros in barcodes and serials; money is dollars with 2 decimals', () => {
    const text = serializeItems(tricky);
    expect(text).toContain(',0.05,');
    expect(text).toContain(',1234.56,');
    expect(parseItems(text).list[2]!.barcode).toBe('012345678905');
    expect(parseItems(text).list[3]!.serial).toBe('007');
  });

  it('starts with a UTF-8 BOM for Excel and reads files with or without one', () => {
    const text = serializeItems(tricky);
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(parseItems(text.slice(1)).list).toHaveLength(4);
  });

  it('tags split on ";", trimmed, blanks and repeats (ignoring capitals) dropped', () => {
    const r = parseItems(csv([['id', 'name', 'category', 'quantity', 'tags'], ['a', 'A', 'M', '1', ' Fragile ;; outdoor; FRAGILE ']]));
    expect(r.list[0]!.tags).toEqual(['Fragile', 'outdoor']);
  });

  it('spreadsheet spellings are accepted: approx yes/TRUE/1, enums in any capitals', () => {
    const r = parseItems(csv([['id', 'name', 'category', 'quantity', 'approx', 'status', 'condition'], ['a', 'A', 'M', '1', 'TRUE', 'Out', 'Needs Repair']]));
    expect(r.list[0]).toMatchObject({ approx: true, status: 'out', condition: 'needs repair' });
  });
});

describe('row problems', () => {
  const header = ['id', 'name', 'category', 'quantity', 'barcode', 'notes', 'value', 'status', 'out_since', 'purchase_date', 'approx'];
  const good = ['a', 'A', 'Decorations', '1', '', '', '', '', '', '', ''];
  const withRow = (over: Record<string, string>, id = 'b') => header.map((h, i) => (h === 'id' ? id : (over[h] ?? good[i]!)));

  it('numbers rows as a spreadsheet does, even after a multi-line note', () => {
    const r = parseItems(csv([header, withRow({ notes: 'line 1\nline 2' }, 'a'), withRow({ quantity: '-1' })]));
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
    [{ value: 'ten' }, /not a dollar amount/],
    [{ status: 'gone' }, /status "gone" must be one of/],
    [{ out_since: 'yesterday' }, /isn't a date and time/],
    [{ purchase_date: '11/30/2024' }, /isn't a date/],
    [{ approx: 'maybe' }, /approx "maybe" must be yes or blank/],
  ])('%j → error', (over, msg) => {
    const r = parseItems(csv([header, withRow(over)]));
    expect(r.list).toHaveLength(0);
    expect(r.problems.map((p) => p.message).join(' | ')).toMatch(msg);
  });

  it('a duplicate id (ignoring capitals) is caught when the household is checked', () => {
    const r = parseItems(csv([header, withRow({}, 'dup'), withRow({}, 'DUP')]));
    expect(checkData(dataset({ items: r.list }))).toContain('id DUP is used more than once');
  });
});

describe('the other record files', () => {
  it('bins: tags, state, label time and contents round-trip; codes are upper-cased', () => {
    const list = [bin({ id: 'bn-1', code: 'A-04', tags: ['Fragile', 'Heavy'], state: 'out', labelPrintedAt: Date.UTC(2026, 10, 1), labelContents: 'Lights ×3\nGarland ~40' }), bin({ id: 'bn-2', code: 'A-10' })];
    expect(parseBins(serializeBins(list))).toEqual({ list, problems: [], ignoredColumns: [], hasPart: true });
    expect(parseBins('id,code,name\r\nbn-3,g-07,Tote\r\n').list[0]).toMatchObject({ code: 'G-07', state: 'stored', tags: [], labelPrintedAt: null, labelContents: null });
  });

  it('spots keep their order within each area', () => {
    const list = [spot({ id: 's1', areaId: 'a', order: 1, name: 'Second' }), spot({ id: 's2', areaId: 'b', order: 0, name: 'Other' }), spot({ id: 's3', areaId: 'a', order: 0, name: 'First' })];
    expect(parseSpots(serializeSpots(list)).list.map((s) => [s.areaId, s.name, s.order])).toEqual([
      ['b', 'Other', 0],
      ['a', 'First', 0],
      ['a', 'Second', 1],
    ]);
  });

  it('seasons need a palette color; blank orders keep file order; tags renumber', () => {
    expect(parseSeasons('id,name,color\r\nse-1,Fall,brown\r\nse-2,Odd,plaid\r\n').problems.map((p) => p.message)).toEqual(['color "plaid" must be one of: red, orange, gold, green, teal, blue, navy, purple, pink, brown']);
    expect(parseTags('name,order\r\nB,5\r\nC,\r\nA,2\r\n').list).toEqual([{ part: 'household' as const, name: 'A', order: 0 }, { part: 'household' as const, name: 'B', order: 1 }, { part: 'household' as const, name: 'C', order: 2 }]);
  });

  it('season dates round-trip as MM-DD; a bad date is a problem', () => {
    const list = [season({ id: 'se-1', name: 'Christmas', setupFrom: '11-25', takedownBy: '01-06' }), season({ id: 'se-2', name: 'Odd', order: 1, setupFrom: '', takedownBy: '' })];
    expect(parseSeasons(serializeSeasons(list)).list).toEqual(list);
    expect(parseSeasons('id,name,setup_from,takedown_by\r\nse-1,X,13-01,01-06\r\n').problems.map((p) => p.message)).toEqual(['setup from "13-01" must be a month and day (MM-DD)']);
  });

  it('areas and tags keep their order within each part (Household first)', () => {
    const areas = [area({ id: 'a1', part: 'holiday', name: 'Storage room', code: 'S', order: 0 }), area({ id: 'a2', part: 'household', name: 'Garage', code: 'G', order: 1 }), area({ id: 'a3', part: 'household', name: 'Attic', code: 'A', order: 0 })];
    expect(parseAreas(serializeAreas(areas)).list.map((a) => [a.part, a.name, a.order])).toEqual([
      ['household', 'Attic', 0],
      ['household', 'Garage', 1],
      ['holiday', 'Storage room', 0],
    ]);
    const tags = [
      { part: 'holiday' as const, name: 'Fragile', order: 0 },
      { part: 'household' as const, name: 'Fragile', order: 0 },
      { part: 'household' as const, name: 'Heavy', order: 1 },
    ];
    expect(parseTags(serializeTags(tags)).list).toEqual([tags[1], tags[2], tags[0]]);
  });

  it('files.csv: owner type and kind are checked; the path is required', () => {
    const r = parseFiles('id,owner_type,owner_id,kind,caption,order,path\r\nph-1,bin,bn-1,photo,Inside,0,photos/ph-1.jpg\r\nph-2,shed,x,photo,,0,\r\n');
    expect(r.list).toEqual([{ id: 'ph-1', ownerType: 'bin', ownerId: 'bn-1', kind: 'photo', caption: 'Inside', order: 0, path: 'photos/ph-1.jpg' }]);
    expect(r.problems.map((p) => p.message)).toEqual(['owner_type "shed" must be one of: item, bin, spot, season, display', 'path is required']);
  });
});
