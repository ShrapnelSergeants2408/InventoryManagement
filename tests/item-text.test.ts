import { describe, expect, it } from 'vitest';
import { orderLines, packText, stockLines } from '../src/domain/item-text';
import { item, vendor } from './helpers';

describe('detail card lines (F10, mockup 2a)', () => {
  it('short: "Short 8 for current needs"', () => {
    expect(stockLines(item({ onHand: 0, desired: 8, spares: 0 }))).toEqual({ title: 'Short 8 for current needs', sub: 'Desired 8 + spares 0 = 8 each' });
  });

  it('low spares and stocked', () => {
    expect(stockLines(item({ onHand: 9, desired: 8, spares: 2 })).title).toBe('Enough for current needs, 1 short of spares');
    expect(stockLines(item({ onHand: 10, desired: 8, spares: 2 })).title).toBe('Stocked: covers desired and spares');
  });

  it('order line: single units with price (mockup: 8 × $55.00 = $440.00 from REV)', () => {
    const it = item({ onHand: 0, desired: 8, vendors: [vendor({ supplier: 'REV', packSize: 1, packPriceCents: 5500 }), null, null] });
    expect(orderLines(it)).toEqual({ title: 'Order 8 each', sub: '8 × $55.00 = $440.00 from REV (preferred vendor)' });
  });

  it('order line: packs (§4 example 12/4/5 with packs of 50)', () => {
    const it = item({ onHand: 5, desired: 12, spares: 4, vendors: [vendor({ supplier: 'McMaster-Carr', packSize: 50, packPriceCents: 999 }), null, null] });
    expect(orderLines(it)).toEqual({ title: 'Order 50 each', sub: '1 pack of 50 × $9.99 = $9.99 from McMaster-Carr (preferred vendor)' });
  });

  it('order line: no price, and nothing to order', () => {
    const np = item({ desired: 3, vendors: [vendor({ supplier: 'WCP', packSize: 2, packPriceCents: null }), null, null] });
    expect(orderLines(np)).toEqual({ title: 'Order 4 each', sub: '2 packs of 2 from WCP (preferred vendor) · no price' });
    expect(orderLines(item({ onHand: 5, desired: 5 })).title).toBe('Nothing to order');
  });

  it('pack text', () => {
    expect(packText(vendor({ packSize: 1 }))).toBe('Sold individually');
    expect(packText(vendor({ packSize: 25 }))).toBe('Pack of 25');
  });
});
