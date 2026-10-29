// The Inventory shop status strip (v0.17): open and overdue orders, pending items, stale prices.
import { describe, expect, it } from 'vitest';
import { hasShopStatus, shopStatus } from '../src/domain/shop-status';
import type { PlacedLine, PlacedOrder } from '../src/domain/placed-orders';
import { item, vendor } from './helpers';

const line = (over: Partial<PlacedLine> = {}): PlacedLine => ({ itemId: '', description: 'x', partNo: '', unit: 'each', category: '', packs: 1, packSize: 1, packPriceCents: 100, received: 0, ...over });
const order = (id: string, placedOn: string, over: Partial<PlacedOrder> = {}): PlacedOrder => ({
  id,
  supplier: 'REV',
  placedOn,
  orderNo: '',
  payment: '',
  funding: '',
  cancelled: false,
  taxCents: 0,
  shippingCents: 0,
  feesCents: 0,
  discount: { kind: '$', value: 0 },
  notes: '',
  fromList: '',
  receipts: [],
  created: 0,
  updated: 0,
  lines: [line()],
  ...over,
});

const base = { pending: 0, items: [], onOrder: new Map(), today: '2026-10-29', staleDays: 90, overdueDays: 14 };

describe('shop status strip (v0.17)', () => {
  it('nothing open, pending or stale: the strip is hidden', () => {
    const s = shopStatus({ ...base, orders: [order('a', '2026-10-01', { lines: [line({ received: 1 })] }), order('b', '2026-10-01', { cancelled: true })] });
    expect(s).toEqual({ open: 0, overdue: 0, pending: 0, staleLines: 0, pricedLines: 0 });
    expect(hasShopStatus(s)).toBe(false);
  });

  it('counts open orders and the overdue ones among them', () => {
    const s = shopStatus({ ...base, orders: [order('a', '2026-10-15'), order('b', '2026-10-14'), order('c', '2026-09-01', { lines: [line({ packs: 2, received: 1 })] })] });
    expect([s.open, s.overdue]).toEqual([3, 2]);
    expect(hasShopStatus(s)).toBe(true);
  });

  it('pending items from helpers show it', () => {
    expect(hasShopStatus(shopStatus({ ...base, orders: [], pending: 2 }))).toBe(true);
  });

  it('stale prices only once more than half of the priced lines are stale (F14)', () => {
    const stale = vendor({ packPriceCents: 100, priceChecked: '2026-06-01' });
    const fresh = vendor({ packPriceCents: 100, priceChecked: '2026-10-01' });
    const need = { desired: 1, onHand: 0, lastCounted: '2026-10-20T10:00-05:00' };
    const half = [item({ id: 'a', ...need, vendors: [stale, null, null] }), item({ id: 'b', ...need, vendors: [fresh, null, null] })];
    expect(shopStatus({ ...base, orders: [], items: half }).staleLines).toBe(0);
    const most = [...half, item({ id: 'c', ...need, vendors: [stale, null, null] })];
    expect(shopStatus({ ...base, orders: [], items: most })).toMatchObject({ staleLines: 2, pricedLines: 3 });
  });
});
