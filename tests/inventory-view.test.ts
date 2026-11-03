import { describe, expect, it } from 'vitest';
import { NO_FILTERS, type Filters } from '../src/domain/filters';
import { buildInventoryView, categoryKey, filterOptions, listOrder, subcategoryKey, type CategoryLine, type ListLine } from '../src/domain/inventory-view';
import type { Category } from '../src/domain/types';
import { household, item } from './helpers';

const h = household();

const categories: Category[] = [
  { part: 'holiday' as const, name: 'Decorations', order: 0, subcategories: ['Ornaments', 'Garland'] },
  { part: 'holiday' as const, name: 'Tools', order: 1, subcategories: ['Power', 'Hand'] },
  { part: 'holiday' as const, name: 'Empty', order: 2, subcategories: [] },
];

const items = [
  item({ id: 'd1', name: 'Glass ornaments', category: 'Decorations', subcategory: 'Ornaments', binId: 'bn-xmas4', quantity: 40 }),
  item({ id: 'd2', name: 'Felt ornaments', category: 'Decorations', subcategory: 'Ornaments', binId: 'bn-xmas4', quantity: 12 }),
  item({ id: 'd3', name: 'Pine garland', category: 'Decorations', subcategory: 'Garland', spotId: 'sp-shelfA', quantity: 3 }),
  item({ id: 't1', name: 'Cordless drill', category: 'Tools', subcategory: 'Power', spotId: 'sp-peg', quantity: 1 }),
  item({ id: 't2', name: 'Tool bag', category: 'Tools', subcategory: '', seasonId: 'se-hall', quantity: 1 }),
];

const view = (over: { query?: string; filters?: Partial<Filters>; expanded?: string[] } = {}) =>
  buildInventoryView({ items, categories, places: h, seasons: h.seasons, query: over.query ?? '', filters: { ...NO_FILTERS, ...over.filters }, expanded: new Set(over.expanded ?? []) });

const shape = (lines: ListLine[]) => lines.map((l) => (l.kind === 'item' ? `  ${l.item.id}` : l.kind === 'subcategory' ? ` [${l.name}]` : `[${l.name}]`));

describe('SPEC v2.0 F2 grouping by category', () => {
  it('collapsed by default: one header per category, in list order, including empty ones', () => {
    expect(shape(view().lines)).toEqual(['[Decorations]', '[Tools]', '[Empty]']);
  });

  it('an expanded category shows subcategory headers in list order; items with no subcategory come last without a header', () => {
    expect(shape(view({ expanded: [categoryKey('Tools')] }).lines)).toEqual(['[Decorations]', '[Tools]', ' [Power]', '  t2', '[Empty]']);
  });

  it('subcategories expand separately; empty subcategories are not shown', () => {
    const v = view({ expanded: [categoryKey('Decorations'), subcategoryKey('Decorations', 'Ornaments'), categoryKey('Tools'), subcategoryKey('Tools', 'Power')] });
    expect(shape(v.lines)).toEqual(['[Decorations]', ' [Ornaments]', '  d1', '  d2', ' [Garland]', '[Tools]', ' [Power]', '  t1', '  t2', '[Empty]']);
  });

  it('a subcategory key only works under its own expanded category', () => {
    expect(shape(view({ expanded: [subcategoryKey('Tools', 'Power')] }).lines)).toEqual(['[Decorations]', '[Tools]', '[Empty]']);
  });

  it('headers count their items; the total covers every item', () => {
    const v = view();
    expect((v.lines[0] as CategoryLine).total).toBe(3);
    expect(v.total).toBe(5);
    expect(v.shown).toBe(5);
  });

  it('categories only items use are appended after the list', () => {
    const v = buildInventoryView({ items: [...items, item({ id: 'x', category: 'New one' })], categories, places: h, seasons: h.seasons, query: '', filters: NO_FILTERS, expanded: new Set() });
    expect(shape(v.lines)).toEqual(['[Decorations]', '[Tools]', '[Empty]', '[New one]']);
  });
});

describe('search and filters in the grouped list (F1, F2)', () => {
  it('filtering shows only matching groups, all expanded, regardless of saved state', () => {
    const v = view({ query: 'drill' });
    expect(v.filtering).toBe(true);
    expect(shape(v.lines)).toEqual(['[Tools]', ' [Power]', '  t1']);
    expect(v.shown).toBe(1);
    expect(v.lines[0]).toMatchObject({ matching: 1, total: 2 });
  });

  it('search matches the path and category too', () => {
    expect(shape(view({ query: 'shelf b' }).lines)).toEqual(['[Decorations]', ' [Ornaments]', '  d1', '  d2']);
    expect(shape(view({ query: 'a-04 christmas' }).lines)).toEqual(['[Decorations]', ' [Ornaments]', '  d1', '  d2']);
  });

  it('a filter with no search', () => {
    expect(shape(view({ filters: { area: 'ar-garage' } }).lines)).toEqual(['[Tools]', ' [Power]', '  t1']);
  });

  it('search and filter combine', () => {
    expect(shape(view({ query: 'felt', filters: { area: 'ar-garage' } }).lines)).toEqual([]);
  });

  it('no matches → no lines and shown 0 (empty state)', () => {
    const v = view({ query: 'inflatable santa' });
    expect(v.lines).toEqual([]);
    expect(v.shown).toBe(0);
  });

  it('items without a subcategory still show when filtering', () => {
    expect(shape(view({ query: 'bag' }).lines)).toEqual(['[Tools]', '  t2']);
  });

  it('shownIds are in list order', () => {
    expect(view({ query: 'ornaments' }).shownIds).toEqual(['d1', 'd2']);
  });
});

describe('filter options', () => {
  it('areas and seasons in use in their order, with none last; tags in list order then unlisted', () => {
    const tagged = [...items, item({ id: 'x', tags: ['Outdoor', 'kids'] }), item({ id: 'y', tags: ['Fragile'] })];
    const o = filterOptions(tagged, categories, h, h.seasons, [{ part: 'holiday', name: 'Fragile', order: 0 }, { part: 'holiday', name: 'Outdoor', order: 1 }, { part: 'holiday', name: 'Unused', order: 2 }]);
    expect(o.areas).toEqual(['ar-attic', 'ar-garage', '']);
    expect(o.seasons).toEqual(['se-hall', 'se-xmas', '']);
    expect(o.tags).toEqual(['Fragile', 'Outdoor', 'kids']);
    expect(o.categories).toEqual(['Decorations', 'Tools', 'Empty']);
  });
});

describe('listOrder', () => {
  it('category list, then subcategory list, then stored order', () => {
    expect(listOrder([...items].reverse(), categories).map((i) => i.id)).toEqual(['d2', 'd1', 'd3', 't1', 't2']);
  });
});
