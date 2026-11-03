import { describe, expect, it } from 'vitest';
import { buildItem, draftFromItem, mergeEdit, newDraft, type BuildContext, type ItemDraft } from '../src/domain/item-form';
import { blankItem, type Category } from '../src/domain/types';
import { item } from './helpers';

const categories: Category[] = [
  { part: 'holiday' as const, name: 'Decorations', order: 0, subcategories: ['Ornaments', 'Garland'] },
  { part: 'holiday' as const, name: 'Tools', order: 1, subcategories: [] },
];
const ctx = (over: Partial<BuildContext> = {}): BuildContext => ({ id: 'it-ABCDEFGH', base: null, categories, part: 'holiday', ...over });

const filled = (over: Partial<ItemDraft> = {}): ItemDraft => ({ ...newDraft('Decorations', 'Snowman lights'), ...over });

function errorsOf(d: ItemDraft, c = ctx()): string[] {
  const r = buildItem(d, c);
  return r.ok ? [] : r.errors.map((e) => e.message);
}

describe('buildItem — add', () => {
  it('builds a new item with quantity 1 by default', () => {
    const r = buildItem(filled({ home: 'bn-XMAS0004', notes: ' left strand dim ' }), ctx());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.item).toEqual({ ...blankItem('it-ABCDEFGH', 'Snowman lights', 'Decorations', 'holiday'), binId: 'bn-XMAS0004', notes: 'left strand dim' });
    expect(r.newSubcategory).toBeNull();
  });

  it('a spot home is a loose item; blank is no home yet', () => {
    const r = buildItem(filled({ home: 'sp-SHELF00B' }), ctx());
    expect(r.ok && [r.item.binId, r.item.spotId]).toEqual(['', 'sp-SHELF00B']);
    const r2 = buildItem(filled({ home: '' }), ctx());
    expect(r2.ok && [r2.item.binId, r2.item.spotId]).toEqual(['', '']);
    expect(errorsOf(filled({ home: 'se-XMAS0001' }))).toEqual(['Choose a bin or a spot, or no home yet.']);
  });

  it('newDraft can start in a home (Add item here)', () => {
    expect(newDraft('Tools', '', 'bn-XMAS0004').home).toBe('bn-XMAS0004');
    expect(newDraft('Tools', '', 'sp-SHELF00B').home).toBe('sp-SHELF00B');
  });

  it('approx, season, tags, condition, value and records', () => {
    const r = buildItem(
      filled({ approx: true, quantity: '40', seasonId: 'se-XMAS0001', tags: [' Fragile ', 'fragile', 'Outdoor'], condition: 'needs repair', conditionNote: ' left strand dead ', value: '$1,249.5', purchaseDate: '2024-11-30', model: ' M1 ', serial: ' S2 ', warrantyUntil: '2027-11-30' }),
      ctx(),
    );
    expect(r.ok && r.item).toMatchObject({ approx: true, quantity: 40, seasonId: 'se-XMAS0001', tags: ['Fragile', 'Outdoor'], condition: 'needs repair', conditionNote: 'left strand dead', value: 124950, purchaseDate: '2024-11-30', model: 'M1', serial: 'S2', warrantyUntil: '2027-11-30' });
  });

  it('a new item takes the given part; a Household item never keeps a season (§3)', () => {
    const r = buildItem(filled({ seasonId: 'se-XMAS0001' }), ctx({ part: 'household' }));
    expect(r.ok && [r.item.part, r.item.seasonId]).toEqual(['household', '']);
    const h = buildItem(filled({ seasonId: 'se-XMAS0001' }), ctx());
    expect(h.ok && [h.item.part, h.item.seasonId]).toEqual(['holiday', 'se-XMAS0001']);
  });

  it('a condition back to OK clears its note; a blank value is none', () => {
    const r = buildItem(filled({ condition: 'ok', conditionNote: 'was broken', value: ' ' }), ctx());
    expect(r.ok && [r.item.conditionNote, r.item.value]).toEqual(['', null]);
  });

  it('rejects a bad value, bad dates and a tag with ";"', () => {
    expect(errorsOf(filled({ value: '12.345', purchaseDate: '11/30/2024', warrantyUntil: '2027-02-30', tags: ['a;b'] }))).toEqual([
      'Value "12.345" has more than 2 decimal places.',
      'Purchase date must be a date.',
      'Warranty until must be a date.',
      'Tag "a;b" can’t contain ";".',
    ]);
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

  it('keeps fields the editor doesn’t show: status, out and lent details, keep at least', () => {
    const base = item({ id: 'it-KEEPME22', status: 'lent', lentTo: 'Mike', lentOn: '2026-10-01', outWhere: 'Mantel', outSince: 5, keepAtLeast: 2, value: 1999, spotId: 'sp-PEG00001' });
    const r = buildItem({ ...draftFromItem(base, categories), name: 'Drill' }, ctx({ id: base.id, base }));
    expect(r.ok && r.item).toEqual({ ...base, name: 'Drill', category: 'Decorations' });
    expect(draftFromItem(base, categories)).toMatchObject({ value: '19.99', home: 'sp-PEG00001' });
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

  it('a home change replaces both bin and spot, so the item is never in two places', () => {
    const base = item({ binId: 'bn-A', spotId: '' });
    const edited = { ...base, binId: '', spotId: 'sp-B' };
    // Meanwhile it was moved to another bin elsewhere.
    const current = { ...base, binId: 'bn-C' };
    expect(mergeEdit(base, edited, current)).toMatchObject({ binId: '', spotId: 'sp-B' });
    // An edit that doesn't touch the home keeps the move made elsewhere.
    expect(mergeEdit(base, { ...base, notes: 'x' }, current)).toMatchObject({ binId: 'bn-C', spotId: '', notes: 'x' });
  });

  it('never changes the id or the photo flag', () => {
    const base = item();
    const current = { ...base, hasPhoto: true };
    expect(mergeEdit(base, { ...base, id: 'it-OTHER222', hasPhoto: false }, current)).toEqual(current);
  });
});
