// The Inventory screen's grouped list (SPEC v2.0 F1, F2): pure, so it is unit-tested.
import { passesFilters, activeFilterCount, type Filters } from './filters';
import { matchesTerms, queryTerms, searchText } from './search';
import { nameKey, type Category, type Item, type Location } from './types';

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
  query: string;
  filters: Filters;
  /** Keys (categoryKey / subcategoryKey) of expanded groups. */
  expanded: ReadonlySet<string>;
}

export function buildInventoryView(input: ViewInput): InventoryView {
  const terms = queryTerms(input.query);
  const filtering = terms.length > 0 || activeFilterCount(input.filters) > 0;
  const passes = (i: Item) => passesFilters(i, input.filters) && matchesTerms(searchText(i), terms);

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
  /** Locations in use, in walk order; '' ("No location") last when any item has none. */
  locations: string[];
}

export function filterOptions(items: readonly Item[], categories: readonly Category[], locations: readonly Location[]): FilterOptions {
  const usedLoc = new Set(items.map((i) => nameKey(i.location)));
  const locs = [...locations].sort((a, b) => a.order - b.order).filter((l) => usedLoc.has(nameKey(l.name))).map((l) => l.name);
  // A location an item uses that isn't in the list (shouldn't happen; lists are completed on import).
  const listed = new Set(locs.map(nameKey));
  for (const it of items) {
    if (it.location !== '' && !listed.has(nameKey(it.location))) {
      listed.add(nameKey(it.location));
      locs.push(it.location);
    }
  }
  if (usedLoc.has('')) locs.push('');
  return { categories: categoryOrder(categories, items).map((c) => c.name), locations: locs };
}
