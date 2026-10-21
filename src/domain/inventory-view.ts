// The Inventory screen's grouped list (SPEC F1, F2, F4, F5): pure, so it is unit-tested.
import { passesFilters, activeFilterCount, type Filters } from './filters';
import { compareSupplierNames, orderLineFor, type OrderLine } from './order';
import { matchesTerms, queryTerms, searchText } from './search';
import { stockStatus, type StockStatus } from './status';
import { nameKey, preferredVendorOf, type Category, type Item, type Location, type Vendor } from './types';

export interface ItemInfo {
  item: Item;
  status: StockStatus;
  /** Preferred vendor option (shown in the row), or null if it is missing. */
  vendor: Vendor | null;
  /** Order line when order_qty > 0, else null. */
  order: OrderLine | null;
}

export function itemInfo(item: Item): ItemInfo {
  return {
    item,
    status: stockStatus(item.onHand, item.desired, item.spares),
    vendor: preferredVendorOf(item),
    order: orderLineFor(item),
  };
}

export interface StatusCounts {
  short: number;
  low: number;
}

export interface CategoryLine extends StatusCounts {
  kind: 'category';
  key: string;
  name: string;
  expanded: boolean;
  total: number;
  /** Items passing search and filters. */
  matching: number;
  counted: number;
  /** Ids of the items passing search and filters, collapsed or not (F28 group checkbox). */
  ids: string[];
}

export interface SubcategoryLine extends StatusCounts {
  kind: 'subcategory';
  key: string;
  category: string;
  name: string;
  expanded: boolean;
  total: number;
  matching: number;
  /** Ids of the items passing search and filters (F28). */
  ids: string[];
}

export interface ItemLine {
  kind: 'item';
  info: ItemInfo;
}

export type ListLine = CategoryLine | SubcategoryLine | ItemLine;

export interface Totals extends StatusCounts {
  items: number;
  needsOrder: number;
}

export interface InventoryView {
  lines: ListLine[];
  /** True when a search or any filter is active: matching groups are shown expanded. */
  filtering: boolean;
  /** Items passing search and filters (all items when not filtering). */
  shown: number;
  /** Their ids, in list order ("Select all shown", F28). */
  shownIds: string[];
  totals: Totals;
}

/** Storage key for a category's expanded state. */
export function categoryKey(category: string): string {
  return JSON.stringify([category]);
}

/** Storage key for a subcategory's expanded state. */
export function subcategoryKey(category: string, subcategory: string): string {
  return JSON.stringify([category, subcategory]);
}

function countStatus(infos: readonly ItemInfo[]): StatusCounts {
  let short = 0;
  let low = 0;
  for (const i of infos) {
    if (i.status.kind === 'short') short++;
    else if (i.status.kind === 'low') low++;
  }
  return { short, low };
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
  /** In list order (the order they are stored in: starter catalog order, then team items). */
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
  const infos = input.items.map(itemInfo);
  const passes = (i: ItemInfo) => passesFilters(i.item, input.filters) && matchesTerms(searchText(i.item), terms);

  const lines: ListLine[] = [];
  let shown = 0;
  const shownIds: string[] = [];
  for (const cat of categoryOrder(input.categories, input.items)) {
    const all = infos.filter((i) => i.item.category === cat.name);
    const visible = all.filter(passes);
    if (filtering && visible.length === 0) continue;
    const ckey = categoryKey(cat.name);
    const expanded = filtering || input.expanded.has(ckey);
    lines.push({
      kind: 'category',
      key: ckey,
      name: cat.name,
      expanded,
      total: all.length,
      matching: visible.length,
      counted: all.filter((i) => i.item.lastCounted !== '').length,
      ids: visible.map((i) => i.item.id),
      ...countStatus(all),
    });
    shown += visible.length;
    for (const sub of subcategoryOrder(cat, all.map((i) => i.item))) shownIds.push(...visible.filter((i) => i.item.subcategory === sub).map((i) => i.item.id));
    if (!expanded) continue;
    for (const sub of subcategoryOrder(cat, all.map((i) => i.item))) {
      const sAll = all.filter((i) => i.item.subcategory === sub);
      const sVisible = visible.filter((i) => i.item.subcategory === sub);
      if (sAll.length === 0 || (filtering && sVisible.length === 0)) continue;
      // Items without a subcategory sit directly under the category header.
      let sExpanded = true;
      if (sub !== '') {
        const skey = subcategoryKey(cat.name, sub);
        sExpanded = filtering || input.expanded.has(skey);
        lines.push({
          kind: 'subcategory',
          key: skey,
          category: cat.name,
          name: sub,
          expanded: sExpanded,
          total: sAll.length,
          matching: sVisible.length,
          ids: sVisible.map((i) => i.item.id),
          ...countStatus(sAll),
        });
      }
      if (sExpanded) for (const info of sVisible) lines.push({ kind: 'item', info });
    }
  }

  return {
    lines,
    filtering,
    shown: filtering ? shown : infos.length,
    shownIds,
    totals: { items: infos.length, needsOrder: infos.filter((i) => i.order !== null).length, ...countStatus(infos) },
  };
}

/** "12 short", "2 low spares" or "All stocked" chips for a group header (§17). */
export function groupChips(c: StatusCounts): Array<'short' | 'low' | 'ok'> {
  const out: Array<'short' | 'low' | 'ok'> = [];
  if (c.short > 0) out.push('short');
  if (c.low > 0) out.push('low');
  if (out.length === 0) out.push('ok');
  return out;
}

export interface FilterOptions {
  categories: string[];
  /** Preferred suppliers in use, A–Z with `other` last (F23). */
  suppliers: string[];
  /** Locations in use, in walk order; '' ("No location") last when any item has none. */
  locations: string[];
}

export function filterOptions(items: readonly Item[], categories: readonly Category[], locations: readonly Location[]): FilterOptions {
  const sup = new Map<string, string>();
  for (const it of items) {
    const v = preferredVendorOf(it);
    if (v && !sup.has(nameKey(v.supplier))) sup.set(nameKey(v.supplier), v.supplier);
  }
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
  return {
    categories: categoryOrder(categories, items).map((c) => c.name),
    suppliers: [...sup.values()].sort(compareSupplierNames),
    locations: locs,
  };
}
