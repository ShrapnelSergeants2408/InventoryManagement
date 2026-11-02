// Managed lists (categories and locations, SPEC v2.0 F11): name checks, usage counts,
// reordering and the item rewrites that rename and remove apply. Pure; the data layer
// runs each change in one transaction.
import { nameKey, type Category, type Item } from './types';

export type NameCheck = { ok: true; name: string } | { ok: false; error: string };

/**
 * Trims the name and rejects a blank one or one already in `existing`, compared ignoring
 * capitals (§3, D3). `self` is the current name when renaming, so a change of capitals only
 * ("Wcp" → "WCP") is allowed.
 */
export function checkName(raw: string, existing: readonly string[], what: string, self?: string): NameCheck {
  const name = raw.trim();
  if (name === '') return { ok: false, error: `${what} name is required.` };
  const key = nameKey(name);
  const selfKey = self === undefined ? null : nameKey(self);
  const dup = existing.find((e) => nameKey(e) === key && nameKey(e) !== selfKey);
  if (dup !== undefined) {
    return { ok: false, error: `“${name}” is already in the list as “${dup}”. Names are compared ignoring capitals.` };
  }
  return { ok: true, name };
}

/** Moves the entry at `index` by `delta` places (▲ = −1, ▼ = +1); out-of-range moves change nothing. */
export function moveBy<T>(list: readonly T[], index: number, delta: number): T[] {
  const to = index + delta;
  if (index < 0 || index >= list.length || to < 0 || to >= list.length) return [...list];
  const out = [...list];
  const [moved] = out.splice(index, 1);
  out.splice(to, 0, moved!);
  return out;
}

// ── Locations (F25) ──────────────────────────────────────────────────────────

/** Items without a location are grouped under this name, so no location may use it. */
export const NO_LOCATION = 'No location';

/** Names a new or renamed location can't take: the list plus "No location". */
export const takenLocationNames = (names: readonly string[]) => [...names, NO_LOCATION];

/** Items per location name (nameKey); items with no location are counted under ''. */
export function locationUsage(items: readonly Item[]): Map<string, Item[]> {
  const out = new Map<string, Item[]>();
  for (const item of items) {
    const key = item.location === '' ? '' : nameKey(item.location);
    const list = out.get(key) ?? [];
    list.push(item);
    out.set(key, list);
  }
  return out;
}

/** Rename, or remove with a replacement location or '' ("No location"). Returns only the items that changed. */
export function reassignLocation(items: readonly Item[], from: string, to: string): Item[] {
  const key = nameKey(from);
  return items.filter((i) => i.location !== '' && nameKey(i.location) === key && i.location !== to).map((i) => ({ ...i, location: to }));
}

/** Recently used locations for the quick picks (F25): most recent first, at most `max`. */
export function pushRecent(recent: readonly string[], name: string, max = 5): string[] {
  if (name === '') return [...recent];
  return [name, ...recent.filter((r) => nameKey(r) !== nameKey(name))].slice(0, max);
}

// ── Categories (F9) ──────────────────────────────────────────────────────────

/** Where items go: a category and one of its subcategories, or '' for none. */
export interface CategoryPlace {
  category: string;
  subcategory: string;
}

export const placeLabel = (p: CategoryPlace) => (p.subcategory ? `${p.category} › ${p.subcategory}` : p.category);

/** The items in a category, or in one subcategory of it when `subcategory` is given. Names match ignoring capitals (§3). */
export function itemsIn(items: readonly Item[], category: string, subcategory?: string): Item[] {
  return items.filter((i) => nameKey(i.category) === nameKey(category) && (subcategory === undefined || nameKey(i.subcategory) === nameKey(subcategory)));
}

/**
 * Moves the items of a category (or of one subcategory) to `to`. Used by remove (F9).
 * A category rename keeps each item's subcategory, so it uses `renameCategoryItems` instead.
 */
export function moveItems(items: readonly Item[], from: { category: string; subcategory?: string }, to: CategoryPlace): Item[] {
  return itemsIn(items, from.category, from.subcategory)
    .filter((i) => i.category !== to.category || i.subcategory !== to.subcategory)
    .map((i) => ({ ...i, category: to.category, subcategory: to.subcategory }));
}

export function renameCategoryItems(items: readonly Item[], from: string, to: string): Item[] {
  if (from === to) return [];
  return itemsIn(items, from).map((i) => ({ ...i, category: to }));
}

export function renameSubcategoryItems(items: readonly Item[], category: string, from: string, to: string): Item[] {
  if (from === to) return [];
  return itemsIn(items, category, from).map((i) => ({ ...i, subcategory: to }));
}

/**
 * Destinations offered when removing a category or subcategory that still holds items:
 * every category, then each of its subcategories, in list order — except the one being
 * removed (for a category, none of its subcategories either).
 */
export function moveTargets(categories: readonly Category[], removing: { category: string; subcategory?: string }): CategoryPlace[] {
  const out: CategoryPlace[] = [];
  for (const c of categories) {
    if (removing.subcategory === undefined && c.name === removing.category) continue;
    out.push({ category: c.name, subcategory: '' });
    for (const s of c.subcategories) {
      if (c.name === removing.category && s === removing.subcategory) continue;
      out.push({ category: c.name, subcategory: s });
    }
  }
  return out;
}

/** Sets `order` to the list position, so the stored order has no gaps. */
export function renumber<T extends { order: number }>(list: readonly T[]): T[] {
  return list.map((x, i) => (x.order === i ? x : { ...x, order: i }));
}
