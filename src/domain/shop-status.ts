// The Inventory screen's shop status strip (v0.17): open orders and how many are overdue, new
// items from helpers waiting for review, and stale prices once the F14 banner would show.
// Pure, so it is unit-tested; the strip only shows when something here is worth a look.
import { buildOrderList } from './order';
import { isOpen, overdueDays, type OnOrder, type PlacedOrder } from './placed-orders';
import { orderAlerts } from './stale';
import type { Item } from './types';

export interface ShopStatus {
  /** Orders placed or partly received. */
  open: number;
  /** Of those, the ones placed more than the overdue days ago. */
  overdue: number;
  /** Pending items from helpers (§18.5). */
  pending: number;
  /** Stale priced lines on the automatic order list, when more than half are (F14); else 0. */
  staleLines: number;
  pricedLines: number;
}

export function shopStatus(input: {
  orders: readonly PlacedOrder[];
  pending: number;
  items: readonly Item[];
  onOrder: OnOrder;
  today: string;
  staleDays: number;
  overdueDays: number;
}): ShopStatus {
  const open = input.orders.filter((o) => isOpen(o));
  const alerts = orderAlerts(buildOrderList(input.items, input.onOrder), input.items, input.today, input.staleDays);
  return {
    open: open.length,
    overdue: open.filter((o) => overdueDays(o, input.today, input.overdueDays) !== null).length,
    pending: input.pending,
    staleLines: alerts.staleBanner ? alerts.staleLines : 0,
    pricedLines: alerts.pricedLines,
  };
}

/** True when the strip has anything to show. */
export const hasShopStatus = (s: ShopStatus) => s.open > 0 || s.pending > 0 || s.staleLines > 0;
