import { describe, expect, it } from 'vitest';
import {
  NUDGE_MAX_MM,
  PAGE,
  PLAIN_QR_SIZES,
  SHEET_LAYOUTS,
  boxAt,
  clampStart,
  cleanNudge,
  labelGroups,
  labelText,
  layoutById,
  perSheet,
  planSheets,
  plainLayout,
  sheetsNeeded,
  stepNudge,
  type LabelLayout,
} from '../src/domain/labels';
import { item, vendor } from './helpers';

const L = (id: string) => layoutById(id)!;
const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 9);
const ALL: LabelLayout[] = [...SHEET_LAYOUTS, ...PLAIN_QR_SIZES.map((q) => plainLayout(q))];

describe('label layouts (SPEC §9) — geometry to verify against the package', () => {
  it.each([
    ['avery-5160', 3, 10, 30, 2.625, 1],
    ['avery-5163', 2, 5, 10, 4, 2],
    ['avery-22805', 4, 6, 24, 1.5, 1.5],
  ])('%s: %i × %i = %i labels of %f × %f in', (id, cols, rows, per, w, h) => {
    const l = L(id);
    expect([l.cols, l.rows, perSheet(l), l.w, l.h]).toEqual([cols, rows, per, w, h]);
  });

  it.each([
    ['avery-5160', [0.1875, 0.5], [5.6875, 9.5]],
    ['avery-5163', [0.15625, 0.5], [4.34375, 8.5]],
    ['avery-22805', [0.6875, 0.6875], [6.3125, 8.8125]],
  ])('%s: first and last label positions', (id, first, last) => {
    const l = L(id);
    const a = boxAt(l, 0);
    const z = boxAt(l, perSheet(l) - 1);
    close(a.x, first[0]!);
    close(a.y, first[1]!);
    close(z.x, last[0]!);
    close(z.y, last[1]!);
  });

  it.each(ALL.map((l) => [l.short, l] as const))('%s: every label on the page, none overlapping, margins equal on both sides', (_n, l) => {
    const boxes = Array.from({ length: perSheet(l) }, (_, s) => boxAt(l, s));
    for (const b of boxes) {
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.x + b.w).toBeLessThanOrEqual(PAGE.w + 1e-9);
      expect(b.y + b.h).toBeLessThanOrEqual(PAGE.h + 1e-9);
    }
    expect(l.pitchX).toBeGreaterThanOrEqual(l.w);
    expect(l.pitchY).toBeGreaterThanOrEqual(l.h);
    const last = boxes.at(-1)!;
    close(PAGE.w - (last.x + last.w), l.left);
    close(PAGE.h - (last.y + last.h), l.top);
  });

  it.each(ALL.map((l) => [l.short, l] as const))('%s: the QR fits the label', (_n, l) => {
    expect(l.qr).toBeLessThan(Math.min(l.w, l.h));
  });

  it('slots are numbered left to right, then down (as on the package)', () => {
    const l = L('avery-5160');
    expect([boxAt(l, 0), boxAt(l, 1), boxAt(l, 2), boxAt(l, 3)].map((b) => [b.row, b.col])).toEqual([[0, 0], [0, 1], [0, 2], [1, 0]]);
  });

  it.each([
    [1, 4, 6],
    [1.5, 3, 4],
    [2, 2, 3],
  ] as const)('plain paper with a %f in QR: %i × %i cells inside the printable area', (q, cols, rows) => {
    const l = plainLayout(q);
    expect([l.cols, l.rows, l.plain, l.qr]).toEqual([cols, rows, true, q]);
    expect(l.left).toBeGreaterThanOrEqual(0.5);
    expect(l.top).toBeGreaterThanOrEqual(0.5);
  });

  it('unknown layout id', () => {
    expect(layoutById('avery-9999')).toBeNull();
  });
});

describe('start position and page breaks', () => {
  const a5160 = L('avery-5160');

  it('21 labels from label 7: one sheet, slots 7–27, the first 6 shown as used (mockup 6b)', () => {
    const p = planSheets(a5160, 21, 6);
    expect(p.pages.length).toBe(1);
    expect(p.pages[0]!.labels.map((b) => b.slot)).toEqual(Array.from({ length: 21 }, (_, k) => k + 6));
    expect(p.pages[0]!.skipped.map((b) => b.slot)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('30 labels from label 7: 24 on the first sheet, 6 on a fresh second sheet', () => {
    const p = planSheets(a5160, 30, 6);
    expect(p.pages.map((pg) => [pg.labels.length, pg.skipped.length, pg.labels[0]!.slot])).toEqual([
      [24, 6, 6],
      [6, 0, 0],
    ]);
    expect(sheetsNeeded(a5160, 30, 6)).toBe(2);
  });

  it('page breaks: 30 → 1 sheet, 31 → 2, 60 → 2, 61 → 3', () => {
    expect([30, 31, 60, 61].map((n) => planSheets(a5160, n).pages.map((p) => p.labels.length))).toEqual([[30], [30, 1], [30, 30], [30, 30, 1]]);
    expect([0, 1, 30, 31].map((n) => sheetsNeeded(a5160, n))).toEqual([0, 1, 1, 2]);
  });

  it('starting on the last label puts one label there, then a new sheet', () => {
    const p = planSheets(a5160, 2, 29);
    expect(p.pages.map((pg) => pg.labels.map((b) => b.slot))).toEqual([[29], [0]]);
  });

  it('start is clamped to the sheet; plain paper always starts at the first cell', () => {
    expect([clampStart(a5160, -3), clampStart(a5160, 99), clampStart(a5160, 2.5), clampStart(a5160, 12)]).toEqual([0, 29, 0, 12]);
    expect(clampStart(plainLayout(1), 5)).toBe(0);
    expect(planSheets(plainLayout(1), 3, 5).pages[0]!.skipped).toEqual([]);
  });

  it('nothing selected: no pages', () => {
    expect(planSheets(a5160, 0, 4).pages).toEqual([]);
  });
});

describe('alignment nudge (0.5 mm steps, per layout)', () => {
  it('steps by 0.5 mm in both directions and stays on the grid', () => {
    let v = 0;
    const seen: number[] = [];
    for (let i = 0; i < 3; i++) seen.push((v = stepNudge(v, 1)));
    for (let i = 0; i < 4; i++) seen.push((v = stepNudge(v, -1)));
    expect(seen).toEqual([0.5, 1, 1.5, 1, 0.5, 0, -0.5]);
    expect(stepNudge(0.3, 1)).toBe(1); // 0.8 snaps to the 0.5 mm grid
    expect(Object.is(stepNudge(0.5, -1), 0)).toBe(true); // not -0
  });

  it('stops at ±10 mm', () => {
    let v = 0;
    for (let i = 0; i < 30; i++) v = stepNudge(v, 1);
    expect(v).toBe(NUDGE_MAX_MM);
    for (let i = 0; i < 60; i++) v = stepNudge(v, -1);
    expect(v).toBe(-NUDGE_MAX_MM);
  });

  it('moves every label, and the used ones, by the nudge', () => {
    const l = L('avery-5160');
    const p = planSheets(l, 1, 1, { top: 1, left: -0.5 });
    close(p.pages[0]!.labels[0]!.x, 0.1875 + 2.75 - 0.5 / 25.4);
    close(p.pages[0]!.labels[0]!.y, 0.5 + 1 / 25.4);
    close(p.pages[0]!.skipped[0]!.x, 0.1875 - 0.5 / 25.4);
  });

  it('a stored nudge is cleaned: junk → 0, off-grid snapped, out of range clamped', () => {
    expect(cleanNudge(undefined)).toEqual({ top: 0, left: 0 });
    expect(cleanNudge({ top: '3', left: NaN })).toEqual({ top: 0, left: 0 });
    expect(cleanNudge({ top: 1.26, left: -40 })).toEqual({ top: 1.5, left: -10 });
    expect(cleanNudge({ top: 2.5, left: -0.5 })).toEqual({ top: 2.5, left: -0.5 });
  });
});

describe('label text (§9 label content)', () => {
  const it1 = item({ name: 'NEO 2.0', location: 'Cabinet E1', preferredVendor: 2, vendors: [vendor({ supplier: 'WCP', partNo: 'W-1' }), vendor({ supplier: 'REV', partNo: 'REV-21-1653' }), null] });
  it('5160: name and location', () => expect(labelText(it1, 'name-location')).toEqual({ name: 'NEO 2.0', extra: ['Cabinet E1'] }));
  it('5163: name, location and the preferred vendor’s part #', () => expect(labelText(it1, 'name-location-part')).toEqual({ name: 'NEO 2.0', extra: ['Cabinet E1', 'REV REV-21-1653'] }));
  it('22805 and plain: the name only', () => {
    expect(labelText(it1, 'short-name')).toEqual({ name: 'NEO 2.0', extra: [] });
    expect(labelText(it1, 'name')).toEqual({ name: 'NEO 2.0', extra: [] });
  });
  it('blank location and part # are left out', () => {
    const bare = item({ location: '', vendors: [vendor({ partNo: '' }), null, null] });
    expect(labelText(bare, 'name-location-part').extra).toEqual([]);
  });
});

describe('choosing items: groups in print order (F20, F25)', () => {
  const items = [
    item({ id: 'a', category: 'Motors', location: 'Bin B' }),
    item({ id: 'b', category: 'Structure', location: '' }),
    item({ id: 'c', category: 'Motors', location: 'Bin A' }),
    item({ id: 'd', category: 'Orphan', location: 'Gone shelf' }),
  ];
  const cats = [
    { name: 'Structure', order: 0, subcategories: [] },
    { name: 'Motors', order: 1, subcategories: [] },
    { name: 'Empty', order: 2, subcategories: [] },
  ];
  // List order is the walk order: Bin B is walked before Bin A.
  const locs = [
    { name: 'Bin A', notes: '', order: 1 },
    { name: 'Bin B', notes: '', order: 0 },
  ];
  const shape = (by: 'category' | 'location') => labelGroups(items, cats, locs, by).map((g) => [g.name, g.items.map((i) => i.id)]);

  it('by category: list order, empty categories left out, an unlisted category last', () => {
    expect(shape('category')).toEqual([
      ['Structure', ['b']],
      ['Motors', ['a', 'c']],
      ['Orphan', ['d']],
    ]);
  });

  it('by location: walk order, then No location (blank or not in the list)', () => {
    expect(shape('location')).toEqual([
      ['Bin B', ['a']],
      ['Bin A', ['c']],
      ['No location', ['b', 'd']],
    ]);
  });

  it('every item appears exactly once either way', () => {
    for (const by of ['category', 'location'] as const) expect(labelGroups(items, cats, locs, by).flatMap((g) => g.items.map((i) => i.id)).sort()).toEqual(['a', 'b', 'c', 'd']);
  });
});
