// Order history and spending (F32, §21.5; SPEC §22 "History"): ranges on boundary dates, the
// filters, both summaries adding up to the same total, cancelled orders left out, both CSV
// layouts with the formula guard, and the remembered range.
import Papa from 'papaparse';
import { describe, expect, it } from 'vitest';
import { loadHistoryRange, saveHistoryRange, type KeyValueStore } from '../src/data/prefs';
import {
  addDays,
  historyOrders,
  isMonthDay,
  offeredRanges,
  rangeDates,
  schoolYearStartOn,
  spendingSummary,
  summaryOrders,
  type HistorySettings,
} from '../src/domain/order-history';
import type { PlacedLine, PlacedOrder } from '../src/domain/placed-orders';
import type { Category } from '../src/domain/types';
import { categoryRows, historyFileName, serializeHistoryCsv, serializeHistoryLinesCsv } from '../src/io/history-csv';

const S: HistorySettings = { seasonStart: '', schoolYearStart: '08-01' };

const line = (over: Partial<PlacedLine> = {}): PlacedLine => ({
  itemId: 'a',
  description: 'A',
  partNo: '',
  unit: 'each',
  category: 'Electrical',
  packs: 1,
  packSize: 1,
  packPriceCents: 1000,
  received: 0,
  ...over,
});

let n = 0;
const order = (over: Partial<PlacedOrder> = {}): PlacedOrder => ({
  id: `po-${++n}`,
  supplier: 'REV',
  placedOn: '2026-10-01',
  orderNo: '',
  payment: '',
  cancelled: false,
  taxCents: 0,
  shippingCents: 0,
  feesCents: 0,
  discount: { kind: '$', value: 0 },
  notes: '',
  fromList: 'Automatic',
  receipts: [],
  created: n,
  updated: n,
  lines: [line()],
  ...over,
});

const cats = (...names: string[]): Category[] => names.map((name, order) => ({ name, order, subcategories: [] }));

describe('ranges (§21.5), inclusive, on boundary dates', () => {
  it('This month: the 1st to today, on the 1st and the last day of a month', () => {
    expect(rangeDates('month', '2026-10-01', S)).toEqual({ from: '2026-10-01', to: '2026-10-01' });
    expect(rangeDates('month', '2026-10-31', S)).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(rangeDates('month', '2028-02-29', S)).toEqual({ from: '2028-02-01', to: '2028-02-29' });
  });

  it('Last 30 days: today and the 29 days before, across months and years', () => {
    expect(rangeDates('last30', '2026-10-29', S)).toEqual({ from: '2026-09-30', to: '2026-10-29' });
    expect(rangeDates('last30', '2027-01-10', S)).toEqual({ from: '2026-12-12', to: '2027-01-10' });
    expect(rangeDates('last30', '2028-03-01', S)).toEqual({ from: '2028-02-01', to: '2028-03-01' });
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('This school year rolls over on its start date, not the day before', () => {
    expect(rangeDates('schoolYear', '2026-07-31', S)).toEqual({ from: '2025-08-01', to: '2026-07-31' });
    expect(rangeDates('schoolYear', '2026-08-01', S)).toEqual({ from: '2026-08-01', to: '2026-08-01' });
    expect(rangeDates('schoolYear', '2026-12-31', S)).toEqual({ from: '2026-08-01', to: '2026-12-31' });
    expect(rangeDates('schoolYear', '2027-01-01', S)).toEqual({ from: '2026-08-01', to: '2027-01-01' });
  });

  it('Last school year: the 12 months before this one, ending the day before it starts', () => {
    expect(rangeDates('lastSchoolYear', '2026-10-29', S)).toEqual({ from: '2025-08-01', to: '2026-07-31' });
    expect(rangeDates('lastSchoolYear', '2026-08-01', S)).toEqual({ from: '2025-08-01', to: '2026-07-31' });
    expect(rangeDates('lastSchoolYear', '2026-07-31', S)).toEqual({ from: '2024-08-01', to: '2025-07-31' });
    // A March 1 start: the year before ends on February 29 in a leap year.
    expect(rangeDates('lastSchoolYear', '2028-03-01', { ...S, schoolYearStart: '03-01' })).toEqual({ from: '2027-03-01', to: '2028-02-29' });
  });

  it('a school year start on January 1 is the calendar year', () => {
    expect(rangeDates('schoolYear', '2027-01-01', { ...S, schoolYearStart: '01-01' })).toEqual({ from: '2027-01-01', to: '2027-01-01' });
    expect(rangeDates('lastSchoolYear', '2027-06-01', { ...S, schoolYearStart: '01-01' })).toEqual({ from: '2026-01-01', to: '2026-12-31' });
  });

  it('a school year start that isn’t a real month and day falls back to August 1', () => {
    expect(schoolYearStartOn('2026-10-29', '02-29')).toBe('2026-08-01');
    expect(schoolYearStartOn('2026-10-29', '13-01')).toBe('2026-08-01');
    expect([isMonthDay('08-01'), isMonthDay('02-28'), isMonthDay('02-29'), isMonthDay('04-31'), isMonthDay('8-1')]).toEqual([true, true, false, false, false]);
  });

  it('This season: from the season start; hidden and unworkable while unset', () => {
    expect(rangeDates('season', '2026-10-29', S)).toBe(null);
    expect(offeredRanges(S)).not.toContain('season');
    const set = { ...S, seasonStart: '2026-01-10' };
    expect(rangeDates('season', '2026-10-29', set)).toEqual({ from: '2026-01-10', to: '2026-10-29' });
    expect(offeredRanges(set)).toEqual(['month', 'last30', 'season', 'schoolYear', 'lastSchoolYear', 'custom']);
  });

  it('Custom: both dates needed; dates the wrong way round are swapped', () => {
    expect(rangeDates('custom', '2026-10-29', S, { from: '2026-09-01', to: '' })).toBe(null);
    expect(rangeDates('custom', '2026-10-29', S, { from: '2026-09-01', to: '2026-09-30' })).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(rangeDates('custom', '2026-10-29', S, { from: '2026-09-30', to: '2026-09-01' })).toEqual({ from: '2026-09-01', to: '2026-09-30' });
  });
});

describe('filters', () => {
  const a = order({ placedOn: '2026-09-01', supplier: 'REV' });
  const b = order({ placedOn: '2026-09-30', supplier: 'wcp', lines: [line({ received: 1 })] });
  const c = order({ placedOn: '2026-09-15', supplier: 'WCP', cancelled: true });
  const d = order({ placedOn: '2026-08-31', supplier: 'REV' });
  const e = order({ placedOn: '2026-10-01', supplier: 'REV' });
  const all = [a, b, c, d, e];
  const sept = { from: '2026-09-01', to: '2026-09-30' };

  it('the range includes its first and last day and nothing outside, newest first', () => {
    expect(historyOrders(all, sept, { supplier: null, status: 'all' }).map((o) => o.id)).toEqual([b.id, c.id, a.id]);
  });

  it('supplier ignores capitals; each status', () => {
    expect(historyOrders(all, sept, { supplier: 'WCP', status: 'all' }).map((o) => o.id)).toEqual([b.id, c.id]);
    expect(historyOrders(all, sept, { supplier: null, status: 'open' }).map((o) => o.id)).toEqual([a.id]);
    expect(historyOrders(all, sept, { supplier: null, status: 'received' }).map((o) => o.id)).toEqual([b.id]);
    expect(historyOrders(all, sept, { supplier: null, status: 'cancelled' }).map((o) => o.id)).toEqual([c.id]);
  });

  it('the summary’s orders leave cancelled out whatever the status filter', () => {
    expect(summaryOrders(all, sept, null).map((o) => o.id)).toEqual([b.id, a.id]);
    expect(summaryOrders(all, sept, 'wcp').map((o) => o.id)).toEqual([b.id]);
  });
});

describe('spending summary (§21.5)', () => {
  const orders = [
    order({ supplier: 'REV', placedOn: '2026-09-02', taxCents: 120, shippingCents: 995, discount: { kind: '%', value: 1000 }, lines: [line({ packs: 2, packPriceCents: 4999, category: 'Electrical' }), line({ itemId: '', category: '', description: 'Shirts', packs: 3, packPriceCents: 1500 })] }),
    order({ supplier: 'rev', placedOn: '2026-09-20', feesCents: 50, lines: [line({ packPriceCents: 333, category: 'fasteners' })] }),
    order({ supplier: 'AndyMark', placedOn: '2026-09-10', discount: { kind: '$', value: 500 }, lines: [line({ packs: 4, packPriceCents: 1250, category: 'Old category' }), line({ packPriceCents: 700, category: 'Electrical' })] }),
    order({ supplier: 'WCP', placedOn: '2026-09-11', cancelled: true, taxCents: 999, lines: [line({ packPriceCents: 99999, category: 'Electrical' })] }),
  ];
  const s = spendingSummary(orders, cats('Electrical', 'Pneumatics', 'Fasteners'));

  it('by supplier: one row per supplier (named as on its newest order), A–Z, then the total; cancelled left out', () => {
    expect(s.suppliers.map((r) => [r.supplier, r.orders, r.partsCents, r.discountCents, r.taxCents, r.shippingCents, r.feesCents, r.totalCents])).toEqual([
      ['AndyMark', 1, 5700, 500, 0, 0, 0, 5200],
      // parts 9998 + 4500 = 14498; 10% = 1449.8 → 1450; + 333 from the second order.
      ['rev', 2, 14831, 1450, 120, 995, 50, 14546],
    ]);
    expect([s.total.orders, s.total.partsCents, s.total.totalCents]).toEqual([3, 20531, 19746]);
  });

  it('by category: list order, then categories no longer listed, then Other; the same total', () => {
    expect(s.categories).toEqual([
      { category: 'Electrical', partsCents: 9998 + 700 },
      { category: 'Fasteners', partsCents: 333 },
      { category: 'Old category', partsCents: 5000 },
      { category: 'Other', partsCents: 4500 },
    ]);
    const rows = categoryRows(s);
    expect(rows.slice(-5)).toEqual([
      ['Discount', -1950],
      ['Tax', 120],
      ['Shipping', 995],
      ['Fees', 50],
      ['Total', 19746],
    ]);
    expect(rows.slice(0, -1).reduce((n, [, c]) => n + c, 0)).toBe(s.total.totalCents);
  });

  it('the two summaries agree for any mix of orders', () => {
    for (let seed = 1; seed <= 50; seed++) {
      let x = seed;
      const rnd = (k: number) => ((x = (x * 1103515245 + 12345) % 2147483648) % k);
      const os = Array.from({ length: 1 + rnd(6) }, () =>
        order({
          supplier: ['REV', 'rev', 'WCP', 'AndyMark'][rnd(4)]!,
          cancelled: rnd(5) === 0,
          taxCents: rnd(500),
          shippingCents: rnd(900),
          feesCents: rnd(100),
          discount: rnd(2) ? { kind: '%', value: rnd(10001) } : { kind: '$', value: rnd(200) },
          lines: Array.from({ length: 1 + rnd(4) }, () => line({ itemId: rnd(4) ? 'a' : '', category: ['Electrical', 'Gone', ''][rnd(3)]!, packs: 1 + rnd(5), packPriceCents: 200 + rnd(5000) })),
        }),
      );
      const sum = spendingSummary(os, cats('Electrical'));
      const bySupplier = sum.suppliers.reduce((t, r) => t + r.totalCents, 0);
      const byCategory = categoryRows(sum).slice(0, -1).reduce((t, [, c]) => t + c, 0);
      expect([bySupplier, byCategory]).toEqual([sum.total.totalCents, sum.total.totalCents]);
    }
  });

  it('an item line with a blank category counts under Other, like a typed line', () => {
    const s2 = spendingSummary([order({ lines: [line({ category: ' ', packPriceCents: 400 }), line({ itemId: '', category: '', packPriceCents: 100 })] })], cats('Electrical'));
    expect(s2.categories).toEqual([{ category: 'Other', partsCents: 500 }]);
  });

  it('nothing in range: an empty summary with a zero total', () => {
    const e = spendingSummary([], cats('Electrical'));
    expect([e.suppliers, e.categories, e.total.totalCents, categoryRows(e).at(-1)]).toEqual([[], [], 0, ['Total', 0]]);
  });
});

describe('CSV exports (§21.5)', () => {
  const tricky = order({ supplier: '=REV', placedOn: '2026-09-02', orderNo: '+1', payment: '@PO', notes: '-x, "y"', taxCents: 100, discount: { kind: '$', value: 250 }, receipts: [{ id: 'r1', type: 'image/jpeg' }], lines: [line({ itemId: 'tm-1', description: '=HYPERLINK("x")', partNo: 'REV-1', packs: 2, packSize: 10, packPriceCents: 1234, received: 5 }), line({ itemId: '', category: '', description: 'Shirts', unit: 'shirt', packs: 3, packSize: 2, packPriceCents: 1500 })] });
  const cancelled = order({ supplier: 'WCP', placedOn: '2026-09-01', cancelled: true });
  const x = { kind: 'custom' as const, range: { from: '2026-09-01', to: '2026-09-30' }, filters: { supplier: null, status: 'all' as const } };
  const shown = [tricky, cancelled];
  const parse = (text: string) => Papa.parse<string[]>(text.replace(/^﻿/, ''), { delimiter: ',' }).data.filter((r) => r.some((c) => c !== ''));

  it('Export CSV: a first row naming the range and filters, the orders, then both summaries under headings', () => {
    const rows = parse(serializeHistoryCsv(x, shown, spendingSummary(summaryOrders(shown, x.range, null), cats('Electrical'))));
    expect(rows[0]).toEqual(['Order history: Custom (2026-09-01 to 2026-09-30) · Supplier: any · Status: all']);
    expect(rows[1]).toEqual(['Placed', 'Supplier', 'Order #', 'Payment', 'Status', 'Parts', 'Discount', 'Tax', 'Shipping', 'Fees', 'Total', 'Receipts', 'From list', 'Notes']);
    expect(rows[2]).toEqual(['2026-09-02', "'=REV", "'+1", "'@PO", 'Partly received', '69.68', '-2.50', '1.00', '0.00', '0.00', '68.18', '1', 'Automatic', "'-x, \"y\""]);
    expect(rows[3]!.slice(0, 5)).toEqual(['2026-09-01', 'WCP', '', '', 'Cancelled']);
    expect(rows[4]).toEqual(['Spending by supplier (cancelled orders left out)']);
    expect(rows[5]).toEqual(['Supplier', 'Orders', 'Parts', 'Discount', 'Tax', 'Shipping', 'Fees', 'Total']);
    expect(rows[6]).toEqual(["'=REV", '1', '69.68', '-2.50', '1.00', '0.00', '0.00', '68.18']);
    expect(rows[7]).toEqual(['Total', '1', '69.68', '-2.50', '1.00', '0.00', '0.00', '68.18']);
    expect(rows[8]).toEqual(['Spending by category (cancelled orders left out)']);
    expect(rows.slice(9)).toEqual([['Category', 'Amount'], ['Electrical', '24.68'], ['Other', '45.00'], ['Discount', '-2.50'], ['Tax', '1.00'], ['Shipping', '0.00'], ['Fees', '0.00'], ['Total', '68.18']]);
  });

  it('Export lines CSV: one row per line, typed lines under Other, quantity in units', () => {
    const rows = parse(serializeHistoryLinesCsv({ ...x, filters: { supplier: 'WCP', status: 'open' } }, [tricky]));
    expect(rows[0]).toEqual(['Order lines: Custom (2026-09-01 to 2026-09-30) · Supplier: WCP · Status: open']);
    expect(rows[1]).toEqual(['Placed', 'Supplier', 'Order #', 'Status', 'Item id', 'Item', 'Part #', 'Category', 'Unit', 'Packs', 'Pack size', 'Qty', 'Pack price', 'Line total', 'Received']);
    expect(rows.slice(2)).toEqual([
      ['2026-09-02', "'=REV", "'+1", 'Partly received', 'tm-1', "'=HYPERLINK(\"x\")", 'REV-1', 'Electrical', 'each', '2', '10', '20', '12.34', '24.68', '5'],
      ['2026-09-02', "'=REV", "'+1", 'Partly received', '', 'Shirts', '', 'Other', 'shirt', '3', '2', '6', '15.00', '45.00', '0'],
    ]);
  });

  it('file names', () => {
    expect([historyFileName(x.range), historyFileName(x.range, true)]).toEqual(['order-history-2026-09-01-to-2026-09-30.csv', 'order-history-lines-2026-09-01-to-2026-09-30.csv']);
  });
});

describe('the remembered range (on the device)', () => {
  const memory = (): KeyValueStore => {
    const m = new Map<string, string>();
    return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
  };

  it('defaults to This school year; keeps a choice and its custom dates', () => {
    const store = memory();
    expect(loadHistoryRange(store)).toEqual({ kind: 'schoolYear', from: '', to: '' });
    saveHistoryRange({ kind: 'custom', from: '2026-09-01', to: '2026-09-30' }, store);
    expect(loadHistoryRange(store)).toEqual({ kind: 'custom', from: '2026-09-01', to: '2026-09-30' });
  });

  it('bad or blocked storage gives the default', () => {
    const store = memory();
    store.setItem('frc2408.order.historyRange', '{"kind":"forever","from":"yesterday"}');
    expect(loadHistoryRange(store)).toEqual({ kind: 'schoolYear', from: '', to: '' });
    const broken: KeyValueStore = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(loadHistoryRange(broken)).toEqual({ kind: 'schoolYear', from: '', to: '' });
    expect(() => saveHistoryRange({ kind: 'month', from: '', to: '' }, broken)).not.toThrow();
  });
});
