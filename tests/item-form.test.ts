import { describe, expect, it } from 'vitest';
import { buildItem, draftFromItem, mergeEdit, newDraft, type BuildContext, type ItemDraft } from '../src/domain/item-form';
import type { Category } from '../src/domain/types';
import { item } from './helpers';

const categories: Category[] = [
  { name: 'Decorations', order: 0, subcategories: ['Ornaments', 'Garland'] },
  { name: 'Tools', order: 1, subcategories: [] },
];
const ctx = (over: Partial<BuildContext> = {}): BuildContext => ({ id: 'it-ABCDEFGH', base: null, categories, ...over });

const filled = (over: Partial<ItemDraft> = {}): ItemDraft => ({ ...newDraft('Decorations', 'Snowman lights'), ...over });

function errorsOf(d: ItemDraft, c = ctx()): string[] {
  const r = buildItem(d, c);
  return r.ok ? [] : r.errors.map((e) => e.message);
}

describe('buildItem — add', () => {
  it('builds a new item with quantity 1 by default', () => {
    const r = buildItem(filled({ location: ' Attic shelf B ', notes: ' left strand dim ' }), ctx());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.item).toEqual({
      id: 'it-ABCDEFGH',
      name: 'Snowman lights',
      category: 'Decorations',
      subcategory: '',
      location: 'Attic shelf B',
      quantity: 1,
      barcode: '',
      notes: 'left strand dim',
      hasPhoto: false,
    });
    expect(r.newSubcategory).toBeNull();
  });

  it('lists every problem at once', () => {
    expect(errorsOf(filled({ name: '  ', category: 'Nope', quantity: '2.5' }))).toEqual(['Name is required.', 'Choose a category.', 'Quantity "2.5" must be a whole number.']);
  });

  it('quantity must be a whole number ≥ 0', () => {
    expect(errorsOf(filled({ quantity: '-1' }))).toEqual(["Quantity can't be negative."]);
    expect(errorsOf(filled({ quantity: '0' }))).toEqual([]);
  });

  it('a new subcategory is created; typing an existing one (any capitals) just picks it', () => {
    const r1 = buildItem(filled({ newSubcategory: ' Wreaths ' }), ctx());
    expect(r1.ok && [r1.item.subcategory, r1.newSubcategory]).toEqual(['Wreaths', 'Wreaths']);
    const r2 = buildItem(filled({ newSubcategory: 'ornaments' }), ctx());
    expect(r2.ok && [r2.item.subcategory, r2.newSubcategory]).toEqual(['Ornaments', null]);
    expect(errorsOf(filled({ newSubcategory: ' ' }))).toEqual(['Type a name for the new subcategory, or pick one from the list.']);
  });

  it('category and subcategory take the list spelling', () => {
    const r = buildItem(filled({ category: 'decorations', subcategory: 'GARLAND' }), ctx());
    expect(r.ok && [r.item.category, r.item.subcategory]).toEqual(['Decorations', 'Garland']);
  });
});

describe('buildItem — edit', () => {
  it('keeps the id and the photo flag of the item being edited', () => {
    const base = item({ id: 'it-KEEPME22', hasPhoto: true, quantity: 4 });
    const r = buildItem(draftFromItem(base, categories), ctx({ id: base.id, base }));
    expect(r.ok && r.item).toEqual({ ...base, category: 'Decorations' });
  });
});

describe('draftFromItem', () => {
  it('round-trips an item and takes the list spelling', () => {
    const d = draftFromItem(item({ category: 'tools', quantity: 3, barcode: '012345678905' }), categories);
    expect(d).toMatchObject({ category: 'Tools', quantity: '3', barcode: '012345678905', newSubcategory: null });
  });
});

describe('mergeEdit', () => {
  it('applies only the fields the editor changed onto the current item', () => {
    const base = item({ quantity: 2, notes: '' });
    const edited = { ...base, notes: 'goes on the mantel' };
    // The quantity changed on the other screen while the editor was open.
    const current = { ...base, quantity: 5 };
    expect(mergeEdit(base, edited, current)).toEqual({ ...base, quantity: 5, notes: 'goes on the mantel' });
  });

  it('never changes the id or the photo flag', () => {
    const base = item();
    const current = { ...base, hasPhoto: true };
    expect(mergeEdit(base, { ...base, id: 'it-OTHER222', hasPhoto: false }, current)).toEqual(current);
  });
});
