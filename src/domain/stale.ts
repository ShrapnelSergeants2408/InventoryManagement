// Stale prices (F14, spec-questions Q9a) and the order-list banners (F12, F14).
import type { OrderList } from './order';
import type { Item, Vendor } from './types';

/** Whole calendar days from `from` to `to` (both YYYY-MM-DD); negative when `from` is later. */
export function daysBetween(from: string, to: string): number {
  const utc = (iso: string) => {
    const [y, m, d] = iso.split('-').map(Number);
    return Date.UTC(y!, m! - 1, d!);
  };
  return Math.round((utc(to) - utc(from)) / 86_400_000);
}

export type PriceAge =
  /** No price: nothing to go stale. */
  | { kind: 'none' }
  /** A price with no checked date counts as stale (Q9a). */
  | { kind: 'unknown' }
  | { kind: 'fresh'; days: number }
  | { kind: 'stale'; days: number };

/** Stale when price_checked is more than `staleDays` days before today (90 → day 91 is stale). */
export function priceAge(v: Vendor, today: string, staleDays: number): PriceAge {
  if (v.packPriceCents === null) return { kind: 'none' };
  if (v.priceChecked === '') return { kind: 'unknown' };
  const days = Math.max(0, daysBetween(v.priceChecked, today));
  return days > staleDays ? { kind: 'stale', days } : { kind: 'fresh', days };
}

export const isStale = (a: PriceAge) => a.kind === 'stale' || a.kind === 'unknown';

/** "Price 95 days old" / "Price date unknown" on an order-list line; null when fresh or unpriced. */
export function staleLabel(a: PriceAge): string | null {
  if (a.kind === 'stale') return `Price ${a.days} days old`;
  if (a.kind === 'unknown') return 'Price date unknown';
  return null;
}

export interface OrderAlerts {
  /** Priced lines whose price is stale. */
  staleLines: number;
  pricedLines: number;
  /** F14: more than half of the priced lines are stale. */
  staleBanner: boolean;
  /** F12: items never counted (blank last_counted), out of all items. */
  uncounted: number;
  totalItems: number;
  countBanner: boolean;
}

export function orderAlerts(list: OrderList, items: readonly Item[], today: string, staleDays: number): OrderAlerts {
  let staleLines = 0;
  for (const g of list.groups) for (const l of g.lines) if (isStale(priceAge(l.vendor, today, staleDays))) staleLines++;
  const uncounted = items.filter((i) => i.lastCounted === '').length;
  return {
    staleLines,
    pricedLines: list.pricedLineCount,
    staleBanner: staleLines * 2 > list.pricedLineCount,
    uncounted,
    totalItems: items.length,
    countBanner: uncounted > 0,
  };
}
