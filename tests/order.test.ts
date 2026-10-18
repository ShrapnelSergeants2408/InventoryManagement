import { describe, expect, it } from 'vitest';
import { buildOrderList, compareSupplierNames, orderLineFor, orderQuantity } from '../src/domain/order';
import { item, vendor } from './helpers';

describe('SPEC §4 order quantity — worked examples', () => {
  // desired, spares, on_hand, pack_size → need, packs, order_qty
  const examples = [
    [4, 2, 1, 1, 5, 5, 5],
    [12, 4, 5, 50, 11, 1, 50],
    [10, 2, 12, 25, 0, 0, 0],
    [10, 2, 11, 25, 1, 1, 25],
  ] as const;
  it.each(examples)('desired %i, spares %i, on hand %i, pack %i → need %i, packs %i, order %i', (d, s, o, p, need, packs, qty) => {
    expect(orderQuantity(d, s, o, p)).toEqual({ need, packs, orderQty: qty });
  });

  it('need ≤ 0 orders nothing (on hand exactly desired + spares)', () => {
    expect(orderQuantity(10, 2, 12, 1)).toEqual({ need: 0, packs: 0, orderQty: 0 });
  });

  it('rejects a pack size that is not a whole number ≥ 1', () => {
    expect(() => orderQuantity(1, 0, 0, 0)).toThrow(RangeError);
    expect(() => orderQuantity(1, 0, 0, 2.5)).toThrow(RangeError);
  });

  it('line total = packs × pack price, in cents', () => {
    const line = orderLineFor(item({ desired: 12, spares: 4, onHand: 5, vendors: [vendor({ packSize: 50, packPriceCents: 899 }), null, null] }));
    expect(line).toMatchObject({ need: 11, packs: 1, orderQty: 50, lineTotalCents: 899 });
  });

  it('uses the preferred vendor, not vendor option 1', () => {
    const it2 = item({
      desired: 3,
      preferredVendor: 2,
      vendors: [vendor({ supplier: 'REV', packSize: 1, packPriceCents: 100 }), vendor({ supplier: 'WCP', packSize: 2, packPriceCents: 500 }), null],
    });
    expect(orderLineFor(it2)).toMatchObject({ packs: 2, orderQty: 4, lineTotalCents: 1000 });
    expect(orderLineFor(it2)!.vendor.supplier).toBe('WCP');
  });
});

describe('SPEC §4 "no price" rule', () => {
  const items = [
    item({ id: 'a', desired: 2, vendors: [vendor({ supplier: 'REV', packPriceCents: 1050 }), null, null] }),
    item({ id: 'b', desired: 1, vendors: [vendor({ supplier: 'REV', packPriceCents: null }), null, null] }),
    item({ id: 'c', desired: 3, vendors: [vendor({ supplier: 'McMaster-Carr', packPriceCents: null }), null, null] }),
    item({ id: 'd', desired: 1, vendors: [vendor({ supplier: 'WCP', packPriceCents: 199 }), null, null] }),
    item({ id: 'e', desired: 0, vendors: [vendor({ supplier: 'WCP', packPriceCents: null }), null, null] }),
  ];
  const list = buildOrderList(items);

  it('lists unpriced items but excludes them from totals, with a count', () => {
    expect(list.lineCount).toBe(4);
    expect(list.noPriceCount).toBe(2);
    expect(list.pricedLineCount).toBe(2);
    expect(list.grandTotalCents).toBe(2 * 1050 + 199);
    const b = list.groups.flatMap((g) => g.lines).find((l) => l.item.id === 'b')!;
    expect(b.lineTotalCents).toBeNull();
    expect(b.orderQty).toBe(1);
  });

  it('subtotals exclude unpriced lines and sum to the grand total', () => {
    const rev = list.groups.find((g) => g.supplier === 'REV')!;
    expect(rev.subtotalCents).toBe(2100);
    expect(rev.noPriceCount).toBe(1);
    expect(list.groups.reduce((s, g) => s + g.subtotalCents, 0)).toBe(list.grandTotalCents);
  });

  it('an item that needs nothing is not listed, even without a price', () => {
    expect(list.groups.flatMap((g) => g.lines).some((l) => l.item.id === 'e')).toBe(false);
  });

  it('groups by preferred supplier, A–Z with other last', () => {
    expect(list.groups.map((g) => g.supplier)).toEqual(['McMaster-Carr', 'REV', 'WCP']);
    expect(['other', 'WCP', 'AndyMark', 'amazon'].sort(compareSupplierNames)).toEqual(['amazon', 'AndyMark', 'WCP', 'other']);
  });
});
