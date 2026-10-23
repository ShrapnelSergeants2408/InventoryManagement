// Named order lists (F27, SPEC §19): quantities, pack rounding, totals, names, order-lists.csv.
import { describe, expect, it } from 'vitest';
import { centsToPlain } from '../src/domain/money';
import { buildOrderList } from '../src/domain/order';
import {
  buildNamedOrder,
  copyName,
  defaultQuantity,
  listNameProblem,
  newListId,
  packsFor,
  stepQuantity,
  withoutMissingItems,
  type NamedOrderList,
} from '../src/domain/order-lists';
import { listNote, orderCsvFileName, serializeOrderCsv } from '../src/io/order-csv';
import { ORDER_LIST_COLUMNS, parseOrderListsCsv, serializeOrderListsCsv } from '../src/io/order-lists-csv';
import { item, vendor } from './helpers';

const list = (over: Partial<NamedOrderList> = {}): NamedOrderList => ({ id: 'ol-1', name: 'WCP order', notes: '', created: 1, updated: 1, lines: [], ...over });

describe('default quantity (F27, §4)', () => {
  it('is the suggested order quantity when the item needs ordering', () => {
    // need = 10 + 2 − 3 = 9; packs of 4 → 3 packs → 12.
    expect(defaultQuantity(item({ desired: 10, spares: 2, onHand: 3, vendors: [vendor({ packSize: 4 }), null, null] }))).toBe(12);
  });
  it('is one pack of the preferred vendor when it doesn’t', () => {
    expect(defaultQuantity(item({ desired: 2, spares: 0, onHand: 5, vendors: [vendor({ packSize: 1 }), vendor({ packSize: 25 }), null], preferredVendor: 2 }))).toBe(25);
    expect(defaultQuantity(item({ desired: 0, spares: 0, onHand: 0 }))).toBe(1);
  });
});

describe('pack rounding and +/− (F27, §4)', () => {
  it('rounds the wanted quantity up to whole packs', () => {
    expect(packsFor(7, 5)).toEqual({ packs: 2, orderQty: 10 });
    expect(packsFor(10, 5)).toEqual({ packs: 2, orderQty: 10 });
    expect(packsFor(1, 1)).toEqual({ packs: 1, orderQty: 1 });
    expect(() => packsFor(3, 0)).toThrow(RangeError);
  });
  it('steps one pack at a time and never below one pack', () => {
    expect(stepQuantity(7, 5, +1)).toBe(15);
    expect(stepQuantity(7, 5, -1)).toBe(5);
    expect(stepQuantity(5, 5, -1)).toBe(5);
    expect(stepQuantity(3, 1, -1)).toBe(2);
  });
});

describe('a list as an order (F27)', () => {
  const items = [
    item({ id: 'a', name: 'Bolt', vendors: [vendor({ supplier: 'WCP', packSize: 25, packPriceCents: 499 }), null, null] }),
    item({ id: 'b', name: 'Motor', vendors: [vendor({ supplier: 'REV', packSize: 1, packPriceCents: 4500 }), null, null] }),
    item({ id: 'c', name: 'Mystery', vendors: [vendor({ supplier: 'rev', packSize: 1, packPriceCents: null }), null, null] }),
  ];

  it('groups by preferred supplier with pack rounding, subtotals and the grand total to the cent', () => {
    const o = buildNamedOrder(list({ lines: [{ itemId: 'a', quantity: 30 }, { itemId: 'b', quantity: 3 }, { itemId: 'c', quantity: 2 }] }), items);
    expect(o.groups.map((g) => g.supplier)).toEqual(['REV', 'WCP']);
    const wcp = o.groups[1]!;
    expect(wcp.lines[0]).toMatchObject({ need: 30, packs: 2, orderQty: 50, lineTotalCents: 998 });
    expect(o.groups[0]!.subtotalCents).toBe(13500);
    // The no-price line is listed but left out of the total, with a count (§4).
    expect(o.groups[0]!.lines.map((l) => l.item.id)).toEqual(['b', 'c']);
    expect(o.noPriceCount).toBe(1);
    expect(centsToPlain(o.grandTotalCents)).toBe('144.98');
    expect(o.lineCount).toBe(3);
  });

  it('skips lines whose item no longer exists', () => {
    const o = buildNamedOrder(list({ lines: [{ itemId: 'gone', quantity: 1 }, { itemId: 'b', quantity: 1 }] }), items);
    expect(o.lineCount).toBe(1);
  });

  it('doesn’t depend on, or change, the automatic list', () => {
    const before = JSON.stringify(items);
    const auto = buildOrderList(items);
    buildNamedOrder(list({ lines: [{ itemId: 'b', quantity: 9 }] }), items);
    expect(JSON.stringify(items)).toBe(before);
    expect(buildOrderList(items)).toEqual(auto);
  });

  it('withoutMissingItems drops lines for items that are gone', () => {
    const l = list({ lines: [{ itemId: 'a', quantity: 1 }, { itemId: 'x', quantity: 2 }] });
    expect(withoutMissingItems(l, new Set(['a'])).lines).toEqual([{ itemId: 'a', quantity: 1 }]);
    expect(withoutMissingItems(l, new Set(['a', 'x']))).toBe(l);
  });
});

describe('list names (§3: unique ignoring capitals)', () => {
  const lists = [list({ id: 'ol-1', name: 'WCP order' }), list({ id: 'ol-2', name: 'Spares' })];
  it('needs a name, and a new one', () => {
    expect(listNameProblem('  ', lists)).toMatch(/name/);
    expect(listNameProblem('wcp ORDER ', lists)).toMatch(/already/);
    expect(listNameProblem('x'.repeat(61), lists)).toMatch(/60/);
    expect(listNameProblem('Competition', lists)).toBeNull();
  });
  it('a list can keep its own name (rename to different capitals)', () => {
    expect(listNameProblem('WCP Order', lists, 'ol-1')).toBeNull();
  });
  it('copy names count up', () => {
    expect(copyName('Spares', lists)).toBe('Spares (copy)');
    expect(copyName('Spares', [...lists, list({ name: 'spares (copy)' })])).toBe('Spares (copy 2)');
  });
  it('ids are random and unused', () => {
    const seq = [0, 0, 0, 0, 0, 0, 0.99, 0.99, 0.99, 0.99, 0.99, 0.99];
    let i = 0;
    const id = newListId((x) => x === 'ol-222222', () => seq[i++]!);
    expect(id).toBe('ol-ZZZZZZ');
  });
});

describe('order-lists.csv (§7)', () => {
  const lists: NamedOrderList[] = [
    list({ id: 'ol-B', name: 'Zed, "quoted" list', notes: 'line one\nline two, with comma', lines: [{ itemId: 'st-0001', quantity: 3 }, { itemId: 'tm-ABCDE', quantity: 40 }] }),
    list({ id: 'ol-A', name: 'Empty one', notes: '', lines: [] }),
  ];

  it('one row per line and a blank item_id row for an empty list, lists A–Z', () => {
    const text = serializeOrderListsCsv(lists);
    const rows = text.replace(/^﻿/, '').split('\r\n');
    expect(rows[0]).toBe(ORDER_LIST_COLUMNS.join(','));
    expect(rows[1]).toBe('ol-A,Empty one,,,');
    expect(rows[2]).toMatch(/^ol-B,"Zed, ""quoted"" list","line one\nline two, with comma",st-0001,3$/);
  });

  it('round-trips names and notes with quotes, commas and line breaks, and empty lists', () => {
    const back = parseOrderListsCsv(serializeOrderListsCsv(lists), 5);
    expect(back.problems).toEqual([]);
    const byId = Object.fromEntries(back.lists.map((l) => [l.id, l]));
    for (const l of lists) expect(byId[l.id]).toEqual({ ...l, created: 5, updated: 5 });
  });

  it('refuses bad files with the spreadsheet row', () => {
    const header = ORDER_LIST_COLUMNS.join(',');
    const bad = [header, 'ol-1,A,,x,0', 'ol-2,a,,y,1', ',B,,z,1', 'ol-3,,,z,1', 'ol-4,C,,z,1', 'ol-4,C,,z,2', 'ol-5,D,,z,1.5'].join('\n');
    const r = parseOrderListsCsv(bad);
    expect(r.problems.map((p) => p.row)).toEqual([2, 3, 4, 5, 7, 8]);
    expect(r.problems[0]!.message).toMatch(/quantity/);
    expect(r.problems[1]!.message).toMatch(/two lists/);
    expect(r.problems[4]!.message).toMatch(/twice/);
    expect(parseOrderListsCsv('list_id,list_name\nol-1,A').problems[0]!.message).toMatch(/missing columns: item_id, quantity/);
  });
});

describe('a named list’s CSV (F27: the list name in the file name and the first row)', () => {
  const now = new Date(2026, 9, 23, 9, 5);
  it('puts the list name in the file name, before any search', () => {
    expect(orderCsvFileName(now, undefined, 'WCP order — Nov')).toBe('order-list-wcp-order-nov-2026-10-23-0905.csv');
    expect(orderCsvFileName(now, 'neo', 'WCP order')).toBe('order-list-wcp-order-filtered-neo-2026-10-23-0905.csv');
    expect(orderCsvFileName(now, undefined, '!!!')).toBe('order-list-2026-10-23-0905.csv');
    // Unchanged for the automatic list (F12, F13).
    expect(orderCsvFileName(now)).toBe('order-list-2026-10-23-0905.csv');
    expect(orderCsvFileName(now, 'neo')).toBe('order-list-filtered-neo-2026-10-23-0905.csv');
  });
  it('the note row names the list and its notes', () => {
    expect(listNote(' WCP order ', ' for\nNov ')).toBe('Order list: WCP order (for Nov)');
    expect(listNote('Spares', '')).toBe('Order list: Spares');
    const o = buildNamedOrder(list({ lines: [{ itemId: 'a', quantity: 1 }] }), [item({ id: 'a' })]);
    const text = serializeOrderCsv(o, listNote('Spares', ''));
    expect(text.split('\r\n')[0]).toBe('﻿Order list: Spares');
    expect(text.split('\r\n')[1]).toMatch(/^Supplier,Part #/);
  });
});
