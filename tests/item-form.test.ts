import { describe, expect, it } from 'vitest';
import {
  blankVendor,
  buildItem,
  draftFromItem,
  editVendor,
  mergeEdit,
  newDraft,
  removeVendor,
  vendorChangesNeedPin,
  type BuildContext,
  type ItemDraft,
} from '../src/domain/item-form';
import type { Category, Item } from '../src/domain/types';
import { item, vendor } from './helpers';

const categories: Category[] = [
  { name: 'Structure', order: 0, subcategories: ['Tubing', 'Standoffs'] },
  { name: 'Motors', order: 1, subcategories: [] },
];
const supplierNames = ['AndyMark', 'REV', 'WCP', 'other'];
const ctx = (over: Partial<BuildContext> = {}): BuildContext => ({ id: 'tm-ABCDE', base: null, today: '2026-10-18', supplierNames, categories, ...over });

const filledNew = (over: Partial<ItemDraft> = {}): ItemDraft => ({
  ...newDraft('Structure', 'Standoff 1/2 in.'),
  vendors: [{ ...blankVendor(), supplier: 'REV', partNo: 'REV-29-2817', packSize: '4', price: '5.00' }],
  ...over,
});

function errorsOf(d: ItemDraft, c = ctx()): string[] {
  const r = buildItem(d, c);
  return r.ok ? [] : r.errors.map((e) => e.message);
}

describe('buildItem — add (F6)', () => {
  it('builds a team item; on hand entered counts as a count (§3 last_counted)', () => {
    const r = buildItem(filledNew({ onHand: '3', desired: '8', spares: '2' }), ctx());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.item).toMatchObject({
      id: 'tm-ABCDE',
      name: 'Standoff 1/2 in.',
      category: 'Structure',
      source: 'team',
      onHand: 3,
      desired: 8,
      spares: 2,
      lastCounted: '2026-10-18',
      preferredVendor: 1,
      hasPhoto: false,
    });
    expect(r.item.vendors).toEqual([{ supplier: 'REV', partNo: 'REV-29-2817', url: '', packSize: 4, packPriceCents: 500, priceChecked: '' }, null, null]);
    expect(r.newSubcategory).toBeNull();
  });

  it('lists every problem at once, with the mockup 3d wording', () => {
    const d = filledNew({ name: '  ', vendors: [{ ...blankVendor(), packSize: '2.5' }] });
    expect(errorsOf(d)).toEqual([
      'Name is required.',
      'Vendor option 1: choose a supplier (it is the preferred vendor).',
      'Vendor option 1: pack size “2.5” must be a whole number of 1 or more.',
    ]);
  });

  it('a new subcategory is created; typing an existing one (any capitals) just picks it', () => {
    const r1 = buildItem(filledNew({ newSubcategory: ' Bumpers ' }), ctx());
    expect(r1.ok && [r1.item.subcategory, r1.newSubcategory]).toEqual(['Bumpers', 'Bumpers']);
    const r2 = buildItem(filledNew({ newSubcategory: 'standoffs' }), ctx());
    expect(r2.ok && [r2.item.subcategory, r2.newSubcategory]).toEqual(['Standoffs', null]);
    expect(errorsOf(filledNew({ newSubcategory: ' ' }))).toEqual(['Type a name for the new subcategory, or pick one from the list.']);
  });

  it('counts must be whole numbers ≥ 0 (Q6)', () => {
    expect(errorsOf(filledNew({ onHand: '-1', desired: '2.5', spares: '' }))).toEqual([
      "On hand can't be negative.",
      'Desired "2.5" must be a whole number.',
      'Spares "" must be a whole number.',
    ]);
  });

  it('price: blank is "no price"; more than 2 decimals is rejected (Q6)', () => {
    const r = buildItem(filledNew({ vendors: [{ ...filledNew().vendors[0]!, price: '' }] }), ctx());
    expect(r.ok && r.item.vendors[0]!.packPriceCents).toBeNull();
    expect(errorsOf(filledNew({ vendors: [{ ...filledNew().vendors[0]!, price: '1.234' }] }))).toEqual([
      'Vendor option 1: price "1.234" has more than 2 decimal places.',
    ]);
  });

  it('pack size: blank or 0 is rejected', () => {
    expect(errorsOf(filledNew({ vendors: [{ ...filledNew().vendors[0]!, packSize: '' }] }))).toEqual([
      "Vendor option 1: pack size is required (1 if it's sold one at a time).",
    ]);
    expect(errorsOf(filledNew({ vendors: [{ ...filledNew().vendors[0]!, packSize: '0' }] }))).toHaveLength(1);
  });

  it('supplier must be in the Supplier list and is spelled as listed', () => {
    expect(errorsOf(filledNew({ vendors: [{ ...filledNew().vendors[0]!, supplier: 'Digi-Key' }] }))).toEqual([
      'Vendor option 1: supplier “Digi-Key” isn\'t in the Supplier list.',
    ]);
    const r = buildItem(filledNew({ vendors: [{ ...filledNew().vendors[0]!, supplier: 'wcp' }] }), ctx());
    expect(r.ok && r.item.vendors[0]!.supplier).toBe('WCP');
  });

  it('links: https added to a bare address; other schemes rejected', () => {
    const r = buildItem(filledNew({ vendors: [{ ...filledNew().vendors[0]!, url: 'www.revrobotics.com/rev-29-2817' }] }), ctx());
    expect(r.ok && r.item.vendors[0]!.url).toBe('https://www.revrobotics.com/rev-29-2817');
    expect(errorsOf(filledNew({ vendors: [{ ...filledNew().vendors[0]!, url: 'javascript:alert(1)' }] }))).toEqual([
      'Vendor option 1: product page link must start with https://.',
    ]);
  });

  it('a second vendor option that isn’t filled in is reported as option 2, not preferred', () => {
    const d = filledNew({ vendors: [filledNew().vendors[0]!, blankVendor()] });
    expect(errorsOf(d)).toEqual(['Vendor option 2: choose a supplier.']);
  });

  it('the preferred vendor maps to its slot; slots are filled in order', () => {
    const d = filledNew({ vendors: [filledNew().vendors[0]!, { ...blankVendor(), supplier: 'AndyMark' }], preferred: 1 });
    const r = buildItem(d, ctx());
    expect(r.ok && r.item.preferredVendor).toBe(2);
    expect(r.ok && r.item.vendors.map((v) => v?.supplier ?? null)).toEqual(['REV', 'AndyMark', null]);
  });

  it('category must be in the list', () => {
    expect(errorsOf(filledNew({ category: 'Nope' }))).toEqual(['Choose a category.']);
  });
});

describe('buildItem — edit (F7)', () => {
  const base: Item = item({
    id: 'st-0063',
    source: 'starter',
    name: 'NEO 2.0',
    category: 'Motors',
    lastCounted: '',
    hasPhoto: true,
    notes: 'line 1\nline 2',
    vendors: [vendor({ supplier: 'REV', partNo: 'REV-21-1653', url: 'https://www.revrobotics.com/rev-21-1653/', packSize: 1, packPriceCents: 5500 }), null, vendor({ supplier: 'WCP', packPriceCents: null, priceChecked: '' })],
    preferredVendor: 1,
  });

  it('round-trips an unchanged item exactly (apart from closing up empty vendor slots)', () => {
    const r = buildItem(draftFromItem(base), ctx({ id: base.id, base }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect({ ...r.item, vendors: null }).toEqual({ ...base, vendors: null });
    expect(r.item.vendors).toEqual([base.vendors[0], base.vendors[2], null]);
    expect(vendorChangesNeedPin(base, r.item)).toBe(false);
  });

  it('keeps source, last counted and the photo flag; editing does not set last counted', () => {
    const r = buildItem({ ...draftFromItem(base), onHand: '5' }, ctx({ id: base.id, base }));
    expect(r.ok && [r.item.source, r.item.lastCounted, r.item.hasPhoto, r.item.onHand]).toEqual(['starter', '', true, 5]);
  });

  it('a unit that isn’t in the chip list is kept', () => {
    const odd = { ...base, unit: 'pair' };
    const r = buildItem(draftFromItem(odd), ctx({ id: odd.id, base: odd }));
    expect(r.ok && r.item.unit).toBe('pair');
  });
});

describe('vendor fields need the PIN (§6, F6)', () => {
  const base = item({ vendors: [vendor({ supplier: 'REV' }), vendor({ supplier: 'WCP' }), null], preferredVendor: 1 });

  it('adding: vendor option 1 alone needs no PIN', () => {
    expect(vendorChangesNeedPin(null, item({ vendors: [vendor(), null, null], preferredVendor: 1 }))).toBe(false);
  });

  it('adding: a second or third option, or a different preferred vendor, needs the PIN', () => {
    expect(vendorChangesNeedPin(null, item({ vendors: [vendor(), vendor(), null] }))).toBe(true);
    expect(vendorChangesNeedPin(null, item({ vendors: [vendor(), null, vendor()], preferredVendor: 3 }))).toBe(true);
  });

  it('editing: any vendor field or the preferred vendor needs the PIN', () => {
    expect(vendorChangesNeedPin(base, { ...base, vendors: [{ ...base.vendors[0]!, packPriceCents: 1 }, base.vendors[1], null] })).toBe(true);
    expect(vendorChangesNeedPin(base, { ...base, vendors: [{ ...base.vendors[0]!, url: 'https://x.com' }, base.vendors[1], null] })).toBe(true);
    expect(vendorChangesNeedPin(base, { ...base, preferredVendor: 2 })).toBe(true);
    expect(vendorChangesNeedPin(base, { ...base, vendors: [base.vendors[0], null, null] })).toBe(true);
  });

  it('editing: other fields need no PIN', () => {
    expect(vendorChangesNeedPin(base, { ...base, name: 'x', desired: 9, location: 'Bin', notes: 'n', barcode: '1', category: 'Other' })).toBe(false);
  });
});

describe('vendor option editing', () => {
  it('changing the price or pack size fills price checked with today (Q9b)', () => {
    const v = { ...blankVendor(), price: '5.00', priceChecked: '2026-01-01' };
    expect(editVendor(v, 'price', '6.00', '2026-10-18').priceChecked).toBe('2026-10-18');
    expect(editVendor(v, 'packSize', '10', '2026-10-18').priceChecked).toBe('2026-10-18');
    expect(editVendor(v, 'partNo', 'X', '2026-10-18').priceChecked).toBe('2026-01-01');
    expect(editVendor(v, 'price', '5.00 ', '2026-10-18').priceChecked).toBe('2026-01-01');
  });

  it('removing an option keeps the preferred one pointing at the same option', () => {
    const d: ItemDraft = { ...newDraft('Motors'), vendors: [blankVendor(), { ...blankVendor(), supplier: 'B' }, { ...blankVendor(), supplier: 'C' }], preferred: 2 };
    const r = removeVendor(d, 0);
    expect(r.vendors.map((v) => v.supplier)).toEqual(['B', 'C']);
    expect(r.preferred).toBe(1);
    expect(removeVendor(d, 2).preferred).toBe(0); // the preferred one was removed → option 1
    expect(removeVendor({ ...d, vendors: [blankVendor()], preferred: 0 }, 0).vendors).toHaveLength(1); // never below 1
  });
});

describe('mergeEdit', () => {
  const base = item({ onHand: 2, desired: 4, name: 'Old' });

  it('applies only the edited fields onto the stored item', () => {
    const current = { ...base, onHand: 7 }; // a +5 on the list while the editor was open
    const edited = { ...base, name: 'New', desired: 6 };
    expect(mergeEdit(base, edited, current)).toMatchObject({ name: 'New', desired: 6, onHand: 7 });
  });

  it('an on-hand typed in the editor wins over the stored one', () => {
    expect(mergeEdit(base, { ...base, onHand: 1 }, { ...base, onHand: 7 }).onHand).toBe(1);
  });

  it('vendors and preferred vendor travel together', () => {
    const b = item({ vendors: [vendor({ supplier: 'A' }), vendor({ supplier: 'B' }), null], preferredVendor: 2 });
    const edited = { ...b, vendors: [vendor({ supplier: 'B' }), null, null] as Item['vendors'], preferredVendor: 1 as const };
    const current = { ...b, onHand: 3 };
    const m = mergeEdit(b, edited, current);
    expect([m.vendors.map((v) => v?.supplier ?? null), m.preferredVendor, m.onHand]).toEqual([['B', null, null], 1, 3]);
  });

  it('the photo flag always comes from the stored item', () => {
    expect(mergeEdit(base, { ...base, hasPhoto: true }, { ...base, hasPhoto: false }).hasPhoto).toBe(false);
  });
});
