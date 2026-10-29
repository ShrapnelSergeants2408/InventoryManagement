// Stock highlighting (SPEC §4) and its labels (§17: color + icon + word).
import type { Item } from './types';

export type StockStatus =
  | { kind: 'short'; short: number }
  | { kind: 'low' }
  | { kind: 'ok' }
  | { kind: 'uncounted' };

/**
 * Red ("short"): on_hand < desired.
 * Yellow ("low spares"): desired ≤ on_hand < desired + spares.
 * No highlight ("ok"): on_hand ≥ desired + spares.
 */
export function stockStatus(onHand: number, desired: number, spares: number): StockStatus {
  if (onHand < desired) return { kind: 'short', short: desired - onHand };
  if (onHand < desired + spares) return { kind: 'low' };
  return { kind: 'ok' };
}

/**
 * The status an item shows (v0.16): "not counted" while its last_counted is blank, so red and
 * yellow only mean something once the item has been counted (F24). Otherwise as stockStatus.
 */
export function itemStatus(item: Pick<Item, 'onHand' | 'desired' | 'spares' | 'lastCounted'>): StockStatus {
  if (item.lastCounted === '') return { kind: 'uncounted' };
  return stockStatus(item.onHand, item.desired, item.spares);
}

/** The word shown with the status icon: "SHORT n", "LOW SPARES", "OK" or "NOT COUNTED". */
export function statusLabel(s: StockStatus): string {
  switch (s.kind) {
    case 'short':
      return `SHORT ${s.short}`;
    case 'low':
      return 'LOW SPARES';
    case 'ok':
      return 'OK';
    case 'uncounted':
      return 'NOT COUNTED';
  }
}
