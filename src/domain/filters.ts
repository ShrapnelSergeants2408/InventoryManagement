// Inventory filters (SPEC v2.0 F2). H2 adds season, area, status and condition.
import { nameKey, type Item } from './types';

export interface Filters {
  /** Category name, or null for all. */
  category: string | null;
  /** Location name, '' for "No location", or null for all. */
  location: string | null;
}

export const NO_FILTERS: Readonly<Filters> = {
  category: null,
  location: null,
};

export function activeFilterCount(f: Filters): number {
  return [f.category !== null, f.location !== null].filter(Boolean).length;
}

export function passesFilters(item: Item, f: Filters): boolean {
  if (f.category !== null && item.category !== f.category) return false;
  if (f.location !== null && nameKey(item.location) !== nameKey(f.location)) return false;
  return true;
}
