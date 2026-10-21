import { describe, expect, it } from 'vitest';
import { NO_FILTERS, type Filters } from '../src/domain/filters';
import {
  buildInventoryView,
  categoryKey,
  filterOptions,
  groupChips,
  subcategoryKey,
  type CategoryLine,
  type ListLine,
  type SubcategoryLine,
} from '../src/domain/inventory-view';
import type { Category } from '../src/domain/types';
import { readSeed } from '../src/io/seed';
import { item, seedBytes, vendor } from './helpers';

const categories: Category[] = [
  { name: 'Motors', order: 0, subcategories: ['Brushless', 'Brushed'] },
  { name: 'Fasteners', order: 1, subcategories: ['Bolts', 'Nuts'] },
  { name: 'Empty', order: 2, subcategories: [] },
];

const items = [
  item({ id: 'm1', name: 'NEO', category: 'Motors', subcategory: 'Brushless', desired: 2, onHand: 0 }), // short
  item({ id: 'm2', name: 'Kraken', category: 'Motors', subcategory: 'Brushless', desired: 2, spares: 1, onHand: 2 }), // low
  item({ id: 'm3', name: 'CIM', category: 'Motors', subcategory: 'Brushed', desired: 0, onHand: 3 }), // ok
  item({ id: 'f1', name: 'Bolt', category: 'Fasteners', subcategory: 'Bolts', desired: 1, onHand: 1, lastCounted: '2026-10-17' }), // ok
  item({ id: 'f2', name: 'Loose kit', category: 'Fasteners', subcategory: '', desired: 1, onHand: 5 }), // ok, no subcategory
];

const view = (over: { query?: string; filters?: Partial<Filters>; expanded?: string[] } = {}) =>
  buildInventoryView({
    items,
    categories,
    query: over.query ?? '',
    filters: { ...NO_FILTERS, ...over.filters },
    expanded: new Set(over.expanded ?? []),
  });

const shape = (lines: ListLine[]) =>
  lines.map((l) => (l.kind === 'item' ? `  ${l.info.item.id}` : l.kind === 'subcategory' ? ` [${l.name}]` : `[${l.name}]`));

describe('SPEC F1 grouping', () => {
  it('collapsed by default: one header per category, in list order, including empty ones', () => {
    expect(shape(view().lines)).toEqual(['[Motors]', '[Fasteners]', '[Empty]']);
  });

  it('an expanded category shows subcategory headers in list order; items with no subcategory come last without a header', () => {
    expect(shape(view({ expanded: [categoryKey('Fasteners')] }).lines)).toEqual([
      '[Motors]', '[Fasteners]', ' [Bolts]', '  f2', '[Empty]',
    ]);
  });

  it('subcategories expand separately; empty subcategories are not shown', () => {
    const v = view({ expanded: [categoryKey('Motors'), subcategoryKey('Motors', 'Brushless'), categoryKey('Fasteners'), subcategoryKey('Fasteners', 'Bolts')] });
    expect(shape(v.lines)).toEqual([
      '[Motors]', ' [Brushless]', '  m1', '  m2', ' [Brushed]',
      '[Fasteners]', ' [Bolts]', '  f1', '  f2',
      '[Empty]',
    ]);
  });

  it('a subcategory key only works under its own expanded category', () => {
    expect(shape(view({ expanded: [subcategoryKey('Motors', 'Brushless')] }).lines)).toEqual(['[Motors]', '[Fasteners]', '[Empty]']);
  });

  it('headers count short and low-spares items inside (F1) and counted items', () => {
    const v = view({ expanded: [categoryKey('Motors')] });
    const motors = v.lines[0] as CategoryLine;
    expect(motors).toMatchObject({ total: 3, short: 1, low: 1, counted: 0 });
    const brushless = v.lines[1] as SubcategoryLine;
    expect(brushless).toMatchObject({ name: 'Brushless', total: 2, short: 1, low: 1 });
    expect(groupChips(motors)).toEqual(['short', 'low']);
    const fasteners = v.lines.find((l) => l.kind === 'category' && l.name === 'Fasteners') as CategoryLine;
    expect(fasteners).toMatchObject({ total: 2, short: 0, low: 0, counted: 1 });
    expect(groupChips(fasteners)).toEqual(['ok']); // "All stocked"
  });

  it('an empty category shows "All stocked"', () => {
    expect(groupChips({ short: 0, low: 0 })).toEqual(['ok']);
  });

  it('only short → just the short chip; only low → just the low chip', () => {
    expect(groupChips({ short: 3, low: 0 })).toEqual(['short']);
    expect(groupChips({ short: 0, low: 2 })).toEqual(['low']);
  });

  it('totals cover every item', () => {
    expect(view().totals).toEqual({ items: 5, short: 1, low: 1, needsOrder: 2 });
  });

  it('categories only items use are appended after the list', () => {
    const v = buildInventoryView({ items: [...items, item({ id: 'x', category: 'New one' })], categories, query: '', filters: NO_FILTERS, expanded: new Set() });
    expect(shape(v.lines)).toEqual(['[Motors]', '[Fasteners]', '[Empty]', '[New one]']);
  });
});

describe('search and filters in the grouped list (F4, F5)', () => {
  it('filtering shows only matching groups, all expanded, regardless of saved state', () => {
    const v = view({ query: 'neo' });
    expect(v.filtering).toBe(true);
    expect(shape(v.lines)).toEqual(['[Motors]', ' [Brushless]', '  m1']);
    expect(v.shown).toBe(1);
    const motors = v.lines[0] as CategoryLine;
    expect(motors).toMatchObject({ matching: 1, total: 3, short: 1, low: 1 }); // header counts stay whole-group
  });

  it('a filter with no search', () => {
    const v = view({ filters: { needsOrder: true } });
    expect(shape(v.lines)).toEqual(['[Motors]', ' [Brushless]', '  m1', '  m2']);
    expect(v.shown).toBe(2);
  });

  it('search and filter combine', () => {
    expect(shape(view({ query: 'kraken', filters: { short: true } }).lines)).toEqual([]);
    expect(shape(view({ query: 'kraken', filters: { low: true } }).lines)).toEqual(['[Motors]', ' [Brushless]', '  m2']);
  });

  it('no matches → no lines and shown 0 (empty state)', () => {
    const v = view({ query: 'falcon 500' });
    expect(v.lines).toEqual([]);
    expect(v.shown).toBe(0);
  });

  it('items without a subcategory still show when filtering', () => {
    expect(shape(view({ query: 'loose' }).lines)).toEqual(['[Fasteners]', '  f2']);
  });

  it('not filtering: shown is every item even when groups are collapsed', () => {
    expect(view().shown).toBe(5);
  });
});

describe('filter options', () => {
  it('suppliers are preferred suppliers in use, A–Z with other last; locations in walk order with No location last', () => {
    const its = [
      item({ vendors: [vendor({ supplier: 'other' }), null, null], location: '' }),
      item({ vendors: [vendor({ supplier: 'WCP' }), vendor({ supplier: 'Amazon' }), null], location: 'Shelf' }),
      item({ vendors: [vendor({ supplier: 'AndyMark' }), null, null], location: 'Bin 2' }),
      item({ vendors: [vendor({ supplier: 'wcp' }), null, null], location: 'bin 2' }),
      // Lower-case first letter: a plain sort() would put it after `other`.
      item({ vendors: [vendor({ supplier: 'zip ties direct' }), null, null], location: 'Shelf' }),
    ];
    const locs = [
      { name: 'Bin 2', notes: '', order: 0 },
      { name: 'Unused', notes: '', order: 1 },
      { name: 'Shelf', notes: '', order: 2 },
    ];
    const o = filterOptions(its, categories, locs);
    expect(o.suppliers).toEqual(['AndyMark', 'WCP', 'zip ties direct', 'other']);
    expect(o.locations).toEqual(['Bin 2', 'Shelf', '']);
    expect(o.categories).toEqual(['Motors', 'Fasteners', 'Empty']);
  });
});

describe('starter catalog in the list (SPEC §12 numbers)', async () => {
  const seed = await readSeed(seedBytes());
  if (!seed.ok) throw new Error('seed');
  const { data } = seed;
  const v = buildInventoryView({ items: data.items, categories: data.categories, query: '', filters: NO_FILTERS, expanded: new Set() });

  it('header summary: 129 items · 124 short · 0 low spares; 124 need ordering', () => {
    expect(v.totals).toEqual({ items: 129, short: 124, low: 0, needsOrder: 124 });
  });

  it('11 category headers (§11, empty ones included) whose item counts add up to 129', () => {
    const cats = v.lines.filter((l): l is CategoryLine => l.kind === 'category');
    expect(cats).toHaveLength(11);
    expect(cats.reduce((n, c) => n + c.total, 0)).toBe(129);
    expect(cats.reduce((n, c) => n + c.short, 0)).toBe(124);
  });

  it('expanding every group lists every item exactly once', () => {
    const keys = new Set<string>();
    for (const c of data.categories) {
      keys.add(categoryKey(c.name));
      for (const s of c.subcategories) keys.add(subcategoryKey(c.name, s));
    }
    const all = buildInventoryView({ items: data.items, categories: data.categories, query: '', filters: NO_FILTERS, expanded: keys });
    const shownIds = all.lines.flatMap((l) => (l.kind === 'item' ? [l.info.item.id] : []));
    expect(shownIds).toHaveLength(129);
    expect(new Set(shownIds).size).toBe(129);
  });

  it('"Needs order" shows 124 items and "Low spares only" none', () => {
    const needs = buildInventoryView({ items: data.items, categories: data.categories, query: '', filters: { ...NO_FILTERS, needsOrder: true }, expanded: new Set() });
    expect(needs.shown).toBe(124);
    const low = buildInventoryView({ items: data.items, categories: data.categories, query: '', filters: { ...NO_FILTERS, low: true }, expanded: new Set() });
    expect(low.shown).toBe(0);
    expect(low.lines).toEqual([]);
  });
});
