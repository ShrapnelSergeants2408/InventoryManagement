// Inventory filters (SPEC F5).
import { orderLineFor } from './order';
import { itemStatus } from './status';
import { nameKey, preferredVendorOf, type Item } from './types';

export interface Filters {
  needsOrder: boolean;
  short: boolean;
  low: boolean;
  /** Category name, or null for all. */
  category: string | null;
  /** Preferred supplier name, or null for all. */
  supplier: string | null;
  /** Location name, '' for "No location", or null for all. */
  location: string | null;
}

export const NO_FILTERS: Readonly<Filters> = {
  needsOrder: false,
  short: false,
  low: false,
  category: null,
  supplier: null,
  location: null,
};

export function activeFilterCount(f: Filters): number {
  return [f.needsOrder, f.short, f.low, f.category !== null, f.supplier !== null, f.location !== null].filter(Boolean).length;
}

/**
 * Every active filter must pass, except "Short" and "Low spares": with both on,
 * an item passes when it is either one (they are mutually exclusive states).
 */
export function passesFilters(item: Item, f: Filters, onOrder = 0): boolean {
  if (f.needsOrder && orderLineFor(item, onOrder) === null) return false;
  if (f.short || f.low) {
    // An item not counted yet is neither (v0.16), as its chip shows.
    const kind = itemStatus(item).kind;
    if (!((f.short && kind === 'short') || (f.low && kind === 'low'))) return false;
  }
  if (f.category !== null && item.category !== f.category) return false;
  if (f.supplier !== null) {
    const v = preferredVendorOf(item);
    if (!v || nameKey(v.supplier) !== nameKey(f.supplier)) return false;
  }
  if (f.location !== null && nameKey(item.location) !== nameKey(f.location)) return false;
  return true;
}
