// The Inventory screen's grouped list (SPEC v2.0 F1, F2 "By category"): pure, so it is
// unit-tested. H2b adds the By place and By season views.
import { passesFilters, activeFilterCount, type Filters } from './filters';
import { indexPlaces, itemAreaId, itemSeasonId, type Places } from './places';
import { matchesTerms, queryTerms, searchText } from './search';
import { nameKey, type Category, type Item, type Season, type Tag } from './types';

export interface CategoryLine {
  kind: 'category';
  key: string;
  name: string;
  expanded: boolean;
  total: number;
  /** Items passing search and filters. */
  matching: number;
  /** Ids of the items passing search and filters, collapsed or not (group checkbox). */
  ids: string[];
}

export interface SubcategoryLine {
  kind: 'subcategory';
  key: string;
  category: string;
  name: string;
  expanded: boolean;
  total: number;
  matching: number;
  /** Ids of the items passing search and filters. */
  ids: string[];
}

export interface ItemLine {
  kind: 'item';
  item: Item;
}

export type ListLine = CategoryLine | SubcategoryLine | ItemLine;

export interface InventoryView {
  lines: ListLine[];
  /** True when a search or any filter is active: matching groups are shown expanded. */
  filtering: boolean;
  /** Items passing search and filters (all items when not filtering). */
  shown: number;
  /** Their ids, in list order ("Select all shown"). */
  shownIds: string[];
  /** Every item. */
  total: number;
}

/** Storage key for a category's expanded state. */
export function categoryKey(category: string): string {
  return JSON.stringify([category]);
}

/** Storage key for a subcategory's expanded state. */
export function subcategoryKey(category: string, subcategory: string): string {
  return JSON.stringify([category, subcategory]);
}

/** Category order: the Category list, then any category only items use (first appearance). */
function categoryOrder(categories: readonly Category[], items: readonly Item[]): Category[] {
  const out = [...categories].sort((a, b) => a.order - b.order);
  const known = new Set(out.map((c) => c.name));
  for (const it of items) {
    if (!known.has(it.category)) {
      known.add(it.category);
      out.push({ name: it.category, order: out.length, subcategories: [] });
    }
  }
  return out;
}

/** Subcategory order: the category's list, then unlisted ones (first appearance), then '' (none) last. */
function subcategoryOrder(cat: Category, items: readonly Item[]): string[] {
  const out = [...cat.subcategories];
  const seen = new Set(out);
  for (const it of items) {
    if (it.subcategory !== '' && !seen.has(it.subcategory)) {
      seen.add(it.subcategory);
      out.push(it.subcategory);
    }
  }
  out.push('');
  return out;
}

/** Every item in Inventory list order: category list, then subcategory list, then stored order. */
export function listOrder(items: readonly Item[], categories: readonly Category[]): Item[] {
  const out: Item[] = [];
  for (const cat of categoryOrder(categories, items)) {
    const inCat = items.filter((i) => i.category === cat.name);
    for (const sub of subcategoryOrder(cat, inCat)) out.push(...inCat.filter((i) => i.subcategory === sub));
  }
  return out;
}

export interface ViewInput {
  /** In the order they are stored in. */
  items: readonly Item[];
  categories: readonly Category[];
  places: Places;
  seasons: readonly Season[];
  query: string;
  filters: Filters;
  /** Keys (categoryKey / subcategoryKey) of expanded groups. */
  expanded: ReadonlySet<string>;
}

export function buildInventoryView(input: ViewInput): InventoryView {
  const terms = queryTerms(input.query);
  const filtering = terms.length > 0 || activeFilterCount(input.filters) > 0;
  const ix = indexPlaces(input.places);
  const ctx = { places: ix, seasons: new Map(input.seasons.map((s) => [s.id, s])) };
  const passes = (i: Item) => passesFilters(i, input.filters, ix) && matchesTerms(searchText(i, ctx), terms);

  const lines: ListLine[] = [];
  let shown = 0;
  const shownIds: string[] = [];
  for (const cat of categoryOrder(input.categories, input.items)) {
    const all = input.items.filter((i) => i.category === cat.name);
    const visible = all.filter(passes);
    if (filtering && visible.length === 0) continue;
    const ckey = categoryKey(cat.name);
    const expanded = filtering || input.expanded.has(ckey);
    lines.push({ kind: 'category', key: ckey, name: cat.name, expanded, total: all.length, matching: visible.length, ids: visible.map((i) => i.id) });
    shown += visible.length;
    const subs = subcategoryOrder(cat, all);
    for (const sub of subs) shownIds.push(...visible.filter((i) => i.subcategory === sub).map((i) => i.id));
    if (!expanded) continue;
    for (const sub of subs) {
      const sAll = all.filter((i) => i.subcategory === sub);
      const sVisible = visible.filter((i) => i.subcategory === sub);
      if (sAll.length === 0 || (filtering && sVisible.length === 0)) continue;
      // Items without a subcategory sit directly under the category header.
      let sExpanded = true;
      if (sub !== '') {
        const skey = subcategoryKey(cat.name, sub);
        sExpanded = filtering || input.expanded.has(skey);
        lines.push({ kind: 'subcategory', key: skey, category: cat.name, name: sub, expanded: sExpanded, total: sAll.length, matching: sVisible.length, ids: sVisible.map((i) => i.id) });
      }
      if (sExpanded) for (const item of sVisible) lines.push({ kind: 'item', item });
    }
  }

  return { lines, filtering, shown: filtering ? shown : input.items.length, shownIds, total: input.items.length };
}

export interface FilterOptions {
  categories: string[];
  /** Area ids in use, in walk order; '' ("No home yet") last when any item has none. */
  areas: string[];
  /** Season ids in use (an item's own or its bin's), in season order; '' last when any has none. */
  seasons: string[];
  /** Tag names in use, in Tags list order, then unlisted ones. */
  tags: string[];
}

export function filterOptions(items: readonly Item[], categories: readonly Category[], places: Places, seasons: readonly Season[], tags: readonly Tag[]): FilterOptions {
  const ix = indexPlaces(places);
  const usedAreas = new Set(items.map((i) => itemAreaId(i, ix) ?? ''));
  const areas = [...places.areas].sort((a, b) => a.order - b.order).filter((a) => usedAreas.has(a.id)).map((a) => a.id);
  if (usedAreas.has('')) areas.push('');
  const usedSeasons = new Set(items.map((i) => itemSeasonId(i, ix)));
  const seasonIds = [...seasons].sort((a, b) => a.order - b.order).filter((s) => usedSeasons.has(s.id)).map((s) => s.id);
  if (usedSeasons.has('')) seasonIds.push('');
  const usedTags = new Map<string, string>();
  for (const i of items) for (const t of i.tags) if (!usedTags.has(nameKey(t))) usedTags.set(nameKey(t), t);
  const tagNames = [...tags].sort((a, b) => a.order - b.order).filter((t) => usedTags.delete(nameKey(t.name))).map((t) => t.name);
  return { categories: categoryOrder(categories, items).map((c) => c.name), areas, seasons: seasonIds, tags: [...tagNames, ...usedTags.values()] };
}
