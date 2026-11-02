// Inventory filters (SPEC v2.0 F2): category, area, season, status, condition (not OK) and tag.
import { itemAreaId, itemSeasonId, type PlaceIndex } from './places';
import { nameKey, type Item, type ItemStatus } from './types';

export interface Filters {
  /** Category name, or null for all. */
  category: string | null;
  /** Area id, '' for "No home yet", or null for all. */
  area: string | null;
  /** Season id (the item's own, else its bin's), '' for none, or null for all. */
  season: string | null;
  status: ItemStatus | null;
  /** Only items whose condition isn't OK. */
  attention: boolean;
  /** Tag name, or null for all. */
  tag: string | null;
}

export const NO_FILTERS: Readonly<Filters> = {
  category: null,
  area: null,
  season: null,
  status: null,
  attention: false,
  tag: null,
};

export function activeFilterCount(f: Filters): number {
  return [f.category !== null, f.area !== null, f.season !== null, f.status !== null, f.attention, f.tag !== null].filter(Boolean).length;
}

export function passesFilters(item: Item, f: Filters, ix: PlaceIndex): boolean {
  if (f.category !== null && item.category !== f.category) return false;
  if (f.area !== null && (itemAreaId(item, ix) ?? '') !== f.area) return false;
  if (f.season !== null && itemSeasonId(item, ix) !== f.season) return false;
  if (f.status !== null && item.status !== f.status) return false;
  if (f.attention && item.condition === 'ok') return false;
  if (f.tag !== null && !item.tags.some((t) => nameKey(t) === nameKey(f.tag!))) return false;
  return true;
}
