import { describe, expect, it } from 'vitest';
import { NO_FILTERS } from '../src/domain/filters';
import { buildInventoryView, categoryKey, type CategoryLine, type SubcategoryLine } from '../src/domain/inventory-view';
import { fromText, keepExisting, moveSummary, selectState, withIds } from '../src/domain/selection';
import type { Category } from '../src/domain/types';
import { item } from './helpers';

describe('selection (F28)', () => {
  it('a group checkbox is on, some or off; an empty group is off', () => {
    const sel = new Set(['a', 'b']);
    expect(selectState(['a', 'b'], sel)).toBe('on');
    expect(selectState(['a', 'c'], sel)).toBe('some');
    expect(selectState(['c'], sel)).toBe('off');
    expect(selectState([], sel)).toBe('off');
  });

  it('adds and removes ids without changing the set it was given', () => {
    const sel = new Set(['a']);
    expect([...withIds(sel, ['b', 'c'], true)].sort()).toEqual(['a', 'b', 'c']);
    expect([...withIds(sel, ['a', 'z'], false)]).toEqual([]);
    expect([...sel]).toEqual(['a']);
  });

  it('drops ids of deleted items', () => {
    expect([...keepExisting(new Set(['a', 'gone']), [item({ id: 'a' })])]).toEqual(['a']);
  });

  it('summary: count, items already there, and where the others come from, ignoring capitals', () => {
    const chosen = [
      item({ id: '1', category: 'Mechanical', subcategory: 'Structure' }),
      item({ id: '2', category: 'Fasteners', subcategory: '' }),
      item({ id: '3', category: 'Mechanical', subcategory: 'Structure' }),
      item({ id: '4', category: 'fasteners', subcategory: 'BOLTS' }),
    ];
    const s = moveSummary(chosen, { category: 'Fasteners', subcategory: 'Bolts' });
    expect(s.count).toBe(4);
    expect(s.staying).toBe(1);
    expect(s.from).toEqual([
      { place: { category: 'Mechanical', subcategory: 'Structure' }, count: 2 },
      { place: { category: 'Fasteners', subcategory: '' }, count: 1 },
    ]);
    expect(fromText(s.from)).toBe('Mechanical › Structure (2), Fasteners (1)');
    expect(fromText([...s.from, ...s.from], 3)).toBe('Mechanical › Structure (2), Fasteners (1), Mechanical › Structure (2) and 1 more');
  });
});

describe('inventory view ids (F28: header checkboxes and "Select all shown")', () => {
  const categories: Category[] = [
    { name: 'Motors', order: 0, subcategories: ['Brushless'] },
    { name: 'Fasteners', order: 1, subcategories: [] },
  ];
  const items = [
    item({ id: 'm1', category: 'Motors', subcategory: 'Brushless', name: 'NEO zap' }),
    item({ id: 'm2', category: 'Motors', subcategory: '', name: 'CIM' }),
    item({ id: 'f1', category: 'Fasteners', name: 'Bolt' }),
    item({ id: 'f2', category: 'Fasteners', name: 'Zap nut' }),
  ];
  const view = (query = '', expanded: string[] = []) => buildInventoryView({ items, categories, query, filters: NO_FILTERS, expanded: new Set(expanded) });

  it('collapsed groups still carry their ids; shownIds is every item in list order', () => {
    const v = view();
    const cats = v.lines.filter((l): l is CategoryLine => l.kind === 'category');
    expect(cats.map((c) => [c.name, c.ids])).toEqual([
      ['Motors', ['m1', 'm2']],
      ['Fasteners', ['f1', 'f2']],
    ]);
    // List order: subcategories first, then items with none (as the list shows them).
    expect(v.shownIds).toEqual(['m1', 'm2', 'f1', 'f2']);
  });

  it('with a search, a header holds only the matching items, and so does shownIds', () => {
    const v = view('zap');
    const cats = v.lines.filter((l): l is CategoryLine => l.kind === 'category');
    expect(cats.map((c) => [c.name, c.ids])).toEqual([
      ['Motors', ['m1']],
      ['Fasteners', ['f2']],
    ]);
    expect(v.shownIds).toEqual(['m1', 'f2']);
    expect(v.shown).toBe(v.shownIds.length);
  });

  it('a subcategory header holds its own items', () => {
    const subs = view('', [categoryKey('Motors')]).lines.filter((l): l is SubcategoryLine => l.kind === 'subcategory');
    expect(subs.map((s) => [s.name, s.ids])).toEqual([['Brushless', ['m1']]]);
  });

  it('with a search, a subcategory header holds only its matching items', () => {
    const more = [...items, item({ id: 'm3', category: 'Motors', subcategory: 'Brushless', name: 'Falcon' })];
    const v = buildInventoryView({ items: more, categories, query: 'neo', filters: NO_FILTERS, expanded: new Set() });
    const subs = v.lines.filter((l): l is SubcategoryLine => l.kind === 'subcategory');
    expect(subs.map((s) => [s.name, s.total, s.ids])).toEqual([['Brushless', 2, ['m1']]]);
  });
});
