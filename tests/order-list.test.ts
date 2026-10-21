import { describe, expect, it } from 'vitest';
import { parsePrice } from '../src/domain/money';
import { buildOrderList, filterOrderList } from '../src/domain/order';
import { daysBetween, isStale, orderAlerts, priceAge, staleLabel } from '../src/domain/stale';
import { readCsv } from '../src/io/csv';
import { NO_PRICE, ORDER_COLUMNS, filteredNote, guardCell, orderCsvFileName, orderCsvRows, serializeOrderCsv } from '../src/io/order-csv';
import { shareOrDownload } from '../src/io/share';
import { readSeed } from '../src/io/seed';
import { item, seedBytes, vendor } from './helpers';

describe('order list grouping and order (F12)', () => {
  it('lines are in catalog order (by id: starter, then team), not by name', () => {
    const items = [
      item({ id: 'tm-ZZZZZ', name: 'A team item', desired: 1 }),
      item({ id: 'st-0002', name: 'Zip ties', desired: 1 }),
      item({ id: 'st-0001', name: 'Threadlocker', desired: 1 }),
    ];
    expect(buildOrderList(items).groups[0]!.lines.map((l) => l.item.id)).toEqual(['st-0001', 'st-0002', 'tm-ZZZZZ']);
  });

  it('supplier names that differ only in capitals are one group with one subtotal', () => {
    const items = [
      item({ id: 'a', desired: 1, vendors: [vendor({ supplier: 'REV', packPriceCents: 100 }), null, null] }),
      item({ id: 'b', desired: 1, vendors: [vendor({ supplier: 'rev', packPriceCents: 250 }), null, null] }),
    ];
    const list = buildOrderList(items);
    expect(list.groups.map((g) => [g.supplier, g.lines.length, g.subtotalCents])).toEqual([['REV', 2, 350]]);
  });
});

describe('stale prices (F14, Q9a)', () => {
  const v = (priceChecked: string, packPriceCents: number | null = 500) => vendor({ priceChecked, packPriceCents });

  it('day counting is by calendar date, across a DST change and a leap day', () => {
    expect(daysBetween('2026-10-17', '2026-10-17')).toBe(0);
    expect(daysBetween('2026-10-31', '2026-11-02')).toBe(2); // US DST ends Nov 1
    expect(daysBetween('2027-03-13', '2027-03-15')).toBe(2); // US DST starts Mar 14 (a 23-hour day)
    expect(daysBetween('2028-02-28', '2028-03-01')).toBe(2);
    expect(daysBetween('2026-10-18', '2026-10-17')).toBe(-1);
  });

  it('stale age 90: 90 days old is fresh, 91 is stale', () => {
    expect(priceAge(v('2026-07-19'), '2026-10-17', 90)).toEqual({ kind: 'fresh', days: 90 });
    expect(priceAge(v('2026-07-18'), '2026-10-17', 90)).toEqual({ kind: 'stale', days: 91 });
    expect(staleLabel(priceAge(v('2026-07-18'), '2026-10-17', 90))).toBe('Price 91 days old');
  });

  it('the stale age comes from the setting', () => {
    expect(isStale(priceAge(v('2026-10-01'), '2026-10-17', 14))).toBe(true);
    expect(isStale(priceAge(v('2026-10-01'), '2026-10-17', 30))).toBe(false);
  });

  it('a price with no date is stale and says so; no price is never stale; a future date is fresh', () => {
    expect(priceAge(v(''), '2026-10-17', 90)).toEqual({ kind: 'unknown' });
    expect(staleLabel({ kind: 'unknown' })).toBe('Price date unknown');
    expect(priceAge(v('', null), '2026-10-17', 90)).toEqual({ kind: 'none' });
    expect(staleLabel({ kind: 'none' })).toBeNull();
    expect(priceAge(v('2026-12-01'), '2026-10-17', 90)).toEqual({ kind: 'fresh', days: 0 });
  });
});

describe('order-list banners (F12, F14)', () => {
  const line = (id: string, priceChecked: string, packPriceCents: number | null = 100) =>
    item({ id, desired: 1, lastCounted: '2026-10-01', vendors: [vendor({ priceChecked, packPriceCents }), null, null] });

  it('stale banner only when MORE than half of the priced lines are stale', () => {
    const half = [line('a', '2026-01-01'), line('b', '2026-10-01')];
    expect(orderAlerts(buildOrderList(half), half, '2026-10-17', 90)).toMatchObject({ staleLines: 1, pricedLines: 2, staleBanner: false });
    const more = [line('a', '2026-01-01'), line('b', ''), line('c', '2026-10-01')];
    expect(orderAlerts(buildOrderList(more), more, '2026-10-17', 90)).toMatchObject({ staleLines: 2, pricedLines: 3, staleBanner: true });
  });

  it('unpriced lines don’t count toward the stale banner', () => {
    const items = [line('a', '2026-01-01'), line('b', '', null), line('c', '', null)];
    expect(orderAlerts(buildOrderList(items), items, '2026-10-17', 90)).toMatchObject({ staleLines: 1, pricedLines: 1, staleBanner: true });
  });

  it('count-in banner while any item (listed or not) has never been counted', () => {
    const counted = [line('a', '2026-10-01')];
    expect(orderAlerts(buildOrderList(counted), counted, '2026-10-17', 90)).toMatchObject({ uncounted: 0, countBanner: false });
    const withNew = [...counted, item({ id: 'z', desired: 0, lastCounted: '' })];
    expect(orderAlerts(buildOrderList(withNew), withNew, '2026-10-17', 90)).toMatchObject({ uncounted: 1, totalItems: 2, countBanner: true });
  });
});

describe('order list CSV (F13, D4)', () => {
  const items = [
    item({ id: 'st-0001', name: 'Bolt, 10-32 x "1/2"', unit: 'each', desired: 12, spares: 4, onHand: 5, notes: 'line 1\nline 2, with comma', vendors: [vendor({ supplier: 'WCP', partNo: 'WCP-0001', url: 'https://wcp.example/1', packSize: 50, packPriceCents: 999, priceChecked: '2026-10-17' }), null, null] }),
    item({ id: 'st-0002', name: 'Spacer', desired: 3, vendors: [vendor({ supplier: 'WCP', partNo: 'WCP-0002', packSize: 1, packPriceCents: null, priceChecked: '' }), null, null] }),
    item({ id: 'st-0003', name: 'Motor', desired: 2, vendors: [vendor({ supplier: 'REV', partNo: 'REV-1', packSize: 1, packPriceCents: 5500 }), null, null] }),
  ];
  const list = buildOrderList(items);

  it('columns exactly as F13', () => {
    expect([...ORDER_COLUMNS]).toEqual(['Supplier', 'Part #', 'Item', 'Unit', 'Need', 'Pack size', 'Packs', 'Order qty', 'Pack price', 'Line total', 'Price checked', 'URL', 'Notes']);
  });

  it('a row per line, a subtotal row after each supplier, the grand total, then the no-price count', () => {
    expect(orderCsvRows(list)).toEqual([
      ['REV', 'REV-1', 'Motor', 'each', '2', '1', '2', '2', '55.00', '110.00', '2026-10-17', '', ''],
      ['REV subtotal', '', '', '', '', '', '', '', '', '110.00', '', '', ''],
      ['WCP', 'WCP-0001', 'Bolt, 10-32 x "1/2"', 'each', '11', '50', '1', '50', '9.99', '9.99', '2026-10-17', 'https://wcp.example/1', 'line 1\nline 2, with comma'],
      ['WCP', 'WCP-0002', 'Spacer', 'each', '3', '1', '3', '3', NO_PRICE, '', '', '', ''],
      ['WCP subtotal', '', '', '', '', '', '', '', '', '9.99', '', '', ''],
      ['Grand total', '', '', '', '', '', '', '', '', '119.99', '', '', ''],
      ['1 item without a price', '', '', '', '', '', '', '', '', '', '', '', ''],
    ]);
  });

  it('the file round-trips through a CSV reader: quotes, commas and line breaks survive; BOM and CRLF', () => {
    const text = serializeOrderCsv(list);
    expect(text.startsWith('﻿Supplier,Part #,Item,')).toBe(true);
    expect(text.includes('\r\n')).toBe(true);
    const t = readCsv(text, 'order.csv');
    expect(t.problems).toEqual([]);
    expect(t.headers).toEqual([...ORDER_COLUMNS]);
    expect(t.rows.map((r) => r.cells)).toEqual(orderCsvRows(list));
  });

  it('no "without prices" row when every line is priced; plural wording otherwise', () => {
    expect(orderCsvRows(buildOrderList([items[0]!])).at(-1)![0]).toBe('Grand total');
    const two = buildOrderList([items[1]!, { ...items[1]!, id: 'st-0009' }]);
    expect(orderCsvRows(two).at(-1)![0]).toBe('2 items without prices');
  });

  it('text a spreadsheet would run as a formula is shown as typed', () => {
    expect(guardCell('=HYPERLINK("x")')).toBe(`'=HYPERLINK("x")`);
    expect(guardCell('+1 spare')).toBe(`'+1 spare`);
    expect(guardCell('@sum')).toBe(`'@sum`);
    expect(guardCell('-x')).toBe(`'-x`);
    expect(guardCell('-20 nut')).toBe('-20 nut');
    expect(guardCell('10-32 x 1/2')).toBe('10-32 x 1/2');
    expect(guardCell('')).toBe('');
  });

  it('file name has the local date and time', () => {
    expect(orderCsvFileName(new Date(2026, 9, 17, 9, 5))).toBe('order-list-2026-10-17-0905.csv');
  });
});

describe('starter catalog order list, recomputed from the CSV text (§12: 124 lines, $8,413.66)', async () => {
  const seed = await readSeed(seedBytes());
  if (!seed.ok) throw new Error('seed');
  const list = buildOrderList(seed.data.items);
  const t = readCsv(serializeOrderCsv(list), 'order.csv');
  const col = (name: string) => ORDER_COLUMNS.indexOf(name as (typeof ORDER_COLUMNS)[number]);
  const cents = (s: string) => {
    const p = parsePrice(s);
    if (!p.ok || p.cents === null) throw new Error(`not a price: ${s}`);
    return p.cents;
  };

  it('124 line rows, the grand total row says 8413.66', () => {
    const lines = t.rows.filter((r) => !/subtotal$|^Grand total$/.test(r.cells[0]!));
    expect(lines).toHaveLength(124);
    expect(t.rows.at(-1)!.cells[0]).toBe('Grand total');
    expect(t.rows.at(-1)!.cells[col('Line total')]).toBe('8413.66');
  });

  it('every line: order qty = packs × pack size, need ≤ order qty < need + pack size, line total = packs × pack price', () => {
    for (const { cells } of t.rows) {
      if (/subtotal$|^Grand total$/.test(cells[0]!)) continue;
      const [need, size, packs, qty] = ['Need', 'Pack size', 'Packs', 'Order qty'].map((c) => Number(cells[col(c)]));
      expect(qty).toBe(packs! * size!);
      expect(qty! >= need! && qty! < need! + size!).toBe(true);
      expect(cents(cells[col('Line total')]!)).toBe(packs! * cents(cells[col('Pack price')]!));
    }
  });

  it('each subtotal row equals the sum of its supplier’s lines; the subtotals add up to the grand total', () => {
    let group = 0;
    let sumOfSubtotals = 0;
    let current = '';
    for (const { cells } of t.rows) {
      const label = cells[0]!;
      if (label === 'Grand total') {
        expect(cents(cells[col('Line total')]!)).toBe(sumOfSubtotals);
      } else if (label.endsWith(' subtotal')) {
        expect(label).toBe(`${current} subtotal`);
        expect(cents(cells[col('Line total')]!)).toBe(group);
        sumOfSubtotals += group;
        group = 0;
      } else {
        current = label;
        group += cents(cells[col('Line total')]!);
      }
    }
    expect(sumOfSubtotals).toBe(841366);
  });

  it('every price in the starter catalog was checked 2026-10-17: fresh on that day, all stale on day 91', () => {
    expect(orderAlerts(list, seed.data.items, '2026-10-17', 90)).toMatchObject({ staleLines: 0, pricedLines: 124, staleBanner: false, uncounted: 129, countBanner: true });
    expect(orderAlerts(list, seed.data.items, '2027-01-16', 90)).toMatchObject({ staleLines: 124, staleBanner: true });
    expect(orderAlerts(list, seed.data.items, '2027-01-15', 90)).toMatchObject({ staleLines: 0 });
  });
});

describe('share or download (Q1)', () => {
  const file = new File(['a,b\r\n'], 'order-list.csv', { type: 'text/csv' });

  it('shares when the browser can share the file', async () => {
    const shared: ShareData[] = [];
    const r = await shareOrDownload(file, 'Order list', { canShare: () => true, share: async (d) => void shared.push(d), download: () => { throw new Error('no'); } });
    expect(r).toBe('shared');
    expect(shared[0]!.files![0]!.name).toBe('order-list.csv');
  });

  it('closing the share sheet is "cancelled" (no download)', async () => {
    let downloaded = 0;
    const r = await shareOrDownload(file, 'x', { canShare: () => true, share: () => Promise.reject(new DOMException('', 'AbortError')), download: () => void downloaded++ });
    expect([r, downloaded]).toEqual(['cancelled', 0]);
  });

  it('downloads when sharing isn’t possible or fails', async () => {
    let downloaded = 0;
    const deps = { download: () => void downloaded++ };
    expect(await shareOrDownload(file, 'x', deps)).toBe('downloaded');
    expect(await shareOrDownload(file, 'x', { ...deps, canShare: () => false, share: async () => {} })).toBe('downloaded');
    expect(await shareOrDownload(file, 'x', { ...deps, canShare: () => true, share: () => Promise.reject(new DOMException('', 'NotAllowedError')) })).toBe('downloaded');
    expect(downloaded).toBe(3);
  });
});

describe('order list search (F12, SPEC §19)', () => {
  const items = [
    item({ id: 'st-0001', name: 'Bolt 10-32', desired: 12, spares: 4, onHand: 5, notes: 'for the intake', vendors: [vendor({ supplier: 'WCP', partNo: 'WCP-0001', packSize: 50, packPriceCents: 999 }), null, null] }),
    item({ id: 'st-0002', name: 'Spacer', desired: 3, vendors: [vendor({ supplier: 'WCP', partNo: 'WCP-0002', packSize: 1, packPriceCents: null, priceChecked: '' }), null, null] }),
    item({ id: 'st-0003', name: 'NEO 2.0 Motor', desired: 2, vendors: [vendor({ supplier: 'REV', partNo: 'REV-21-1653', packSize: 1, packPriceCents: 5500 }), vendor({ supplier: 'AndyMark', partNo: 'am-9999' }), null] }),
    item({ id: 'st-0004', name: 'Café bracket', desired: 1, vendors: [vendor({ supplier: 'REV', partNo: 'REV-2', packSize: 1, packPriceCents: 1250 }), null, null] }),
  ];
  const all = buildOrderList(items);
  const names = (q: string) => filterOrderList(all, q).groups.flatMap((g) => g.lines.map((l) => l.item.name));

  it('matches item name, part #, supplier and notes; capitals and accents ignored; every word must match', () => {
    expect(names('neo')).toEqual(['NEO 2.0 Motor']);
    expect(names('rev-21')).toEqual(['NEO 2.0 Motor']);
    expect(names('wcp')).toEqual(['Bolt 10-32', 'Spacer']);
    expect(names('INTAKE')).toEqual(['Bolt 10-32']);
    expect(names('cafe')).toEqual(['Café bracket']);
    expect(names('rev motor')).toEqual(['NEO 2.0 Motor']);
    expect(names('zzz')).toEqual([]);
  });

  it('matches the supplier name even when the part # doesn’t contain it', () => {
    const tb = buildOrderList([...items, item({ id: 'st-0005', name: 'Swerve module', desired: 1, vendors: [vendor({ supplier: 'Thrifty Bot', partNo: 'TTB-SWERVE', packPriceCents: 100 }), null, null] })]);
    expect(filterOrderList(tb, 'thrifty bot').groups.flatMap((g) => g.lines.map((l) => l.item.id))).toEqual(['st-0005']);
  });

  it('searches the line as shown: the preferred vendor, not the other options', () => {
    expect(names('andymark')).toEqual([]);
    expect(names('am-9999')).toEqual([]);
  });

  it('a blank search gives the whole list back', () => {
    expect(filterOrderList(all, '   ')).toBe(all);
  });

  it('"Showing n of m" and the total of the lines shown, per supplier and overall; no-price lines left out', () => {
    const wcp = filterOrderList(all, 'wcp');
    expect([wcp.lineCount, all.lineCount]).toEqual([2, 4]);
    expect(wcp.groups.map((g) => [g.supplier, g.lines.length, g.subtotalCents, g.noPriceCount])).toEqual([['WCP', 2, 999, 1]]);
    expect([wcp.grandTotalCents, wcp.pricedLineCount, wcp.noPriceCount]).toEqual([999, 1, 1]);
    const rev = filterOrderList(all, 'rev');
    expect([rev.grandTotalCents, rev.groups.length]).toEqual([2 * 5500 + 1250, 1]); // NEO: desired 2, so 2 packs
    // The whole list is unchanged by a search.
    expect(all.grandTotalCents).toBe(999 + 2 * 5500 + 1250);
  });

  it('Export CSV is every line, exactly as before the search existed', () => {
    expect(serializeOrderCsv(all)).toBe(serializeOrderCsv(buildOrderList(items)));
    expect(orderCsvRows(all).filter((r) => r[1] !== '').length).toBe(4);
  });

  it('Export shown lines only: exactly the filtered lines with their subtotals, after a note row', () => {
    const shown = filterOrderList(all, 'wcp');
    const note = filteredNote('wcp', shown, all);
    expect(note).toBe('Filtered order list: only the 2 of 4 lines matching "wcp". Shown total 9.99; whole list 132.49.');
    const text = serializeOrderCsv(shown, note);
    expect(text.startsWith('﻿"Filtered order list:')).toBe(true);
    expect(text.indexOf('﻿', 1)).toBe(-1);
    const [first, ...rest] = text.slice(1).split('\r\n');
    expect(first).toBe(`"${note.replace(/"/g, '""')}"`);
    const t = readCsv(rest.join('\r\n'), 'order.csv');
    expect(t.problems).toEqual([]);
    expect(t.headers).toEqual([...ORDER_COLUMNS]);
    expect(t.rows.map((r) => r.cells)).toEqual(orderCsvRows(shown));
    expect(t.rows.map((r) => r.cells[0])).toEqual(['WCP', 'WCP', 'WCP subtotal', 'Grand total', '1 item without a price']);
  });

  it('a note that looks like a formula is shown as typed', () => {
    expect(serializeOrderCsv(all, '=1+1').startsWith(`﻿'=1+1`)).toBe(true);
  });

  it('file name says "filtered" and the search, cleaned; the plain export keeps its name', () => {
    const t = new Date(2026, 9, 21, 9, 5);
    expect(orderCsvFileName(t)).toBe('order-list-2026-10-21-0905.csv');
    expect(orderCsvFileName(t, 'NEO 2.0')).toBe('order-list-filtered-neo-2-0-2026-10-21-0905.csv');
    expect(orderCsvFileName(t, 'Café / bolts?')).toBe('order-list-filtered-cafe-bolts-2026-10-21-0905.csv');
    expect(orderCsvFileName(t, '!!!')).toBe('order-list-filtered-2026-10-21-0905.csv');
    expect(orderCsvFileName(t, 'a'.repeat(50))).toBe(`order-list-filtered-${'a'.repeat(30)}-2026-10-21-0905.csv`);
  });
});
