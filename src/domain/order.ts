// Order quantity and order list (SPEC §4, F12), and the order-list search (F12).
import { onOrderOf, type OnOrder } from './placed-orders';
import { matchesTerms, normalize, queryTerms } from './search';
import { OTHER_SUPPLIER, nameKey, preferredVendorOf, type Item, type Vendor } from './types';

export interface OrderQuantity {
  need: number;
  packs: number;
  orderQty: number;
}

/**
 * need = desired + spares − on_hand − on_order; nothing is ordered when need ≤ 0;
 * packs = ceil(need ÷ pack_size); order_qty = packs × pack_size.
 */
export function orderQuantity(desired: number, spares: number, onHand: number, packSize: number, onOrder = 0): OrderQuantity {
  if (!Number.isInteger(packSize) || packSize < 1) throw new RangeError(`pack size must be a whole number ≥ 1 (got ${packSize})`);
  const need = desired + spares - onHand - onOrder;
  if (need <= 0) return { need: 0, packs: 0, orderQty: 0 };
  const packs = Math.ceil(need / packSize);
  return { need, packs, orderQty: packs * packSize };
}

export interface OrderLine {
  item: Item;
  vendor: Vendor;
  need: number;
  packs: number;
  orderQty: number;
  /** packs × pack_price, or null when the preferred vendor has no price. */
  lineTotalCents: number | null;
}

/**
 * The item's order line via its preferred vendor, or null when nothing needs ordering.
 * `onOrder`: units of this item on open placed orders (§4, F30).
 */
export function orderLineFor(item: Item, onOrder = 0): OrderLine | null {
  const vendor = preferredVendorOf(item);
  if (!vendor) return null;
  const q = orderQuantity(item.desired, item.spares, item.onHand, vendor.packSize, onOrder);
  if (q.orderQty === 0) return null;
  const lineTotalCents = vendor.packPriceCents === null ? null : q.packs * vendor.packPriceCents;
  return { item, vendor, ...q, lineTotalCents };
}

export interface SupplierGroup {
  supplier: string;
  lines: OrderLine[];
  /** Sum of priced lines only. */
  subtotalCents: number;
  noPriceCount: number;
}

export interface OrderList {
  groups: SupplierGroup[];
  grandTotalCents: number;
  lineCount: number;
  pricedLineCount: number;
  /** Lines excluded from totals ("n items without prices", §4). */
  noPriceCount: number;
}

/** Supplier ordering used everywhere suppliers are listed: A–Z, `other` last (F23). */
export function compareSupplierNames(a: string, b: string): number {
  const ao = a.toLocaleLowerCase('en-US') === OTHER_SUPPLIER;
  const bo = b.toLocaleLowerCase('en-US') === OTHER_SUPPLIER;
  if (ao !== bo) return ao ? 1 : -1;
  return a.localeCompare(b, 'en-US', { sensitivity: 'base' });
}

/**
 * F12: every item with order_qty > 0, grouped by preferred supplier (A–Z, `other` last;
 * names compared ignoring capitals, so "rev" and "REV" are one group), lines in catalog
 * order (by id: starter items, then team items), the same order as the Inventory list.
 */
export function buildOrderList(items: readonly Item[], onOrder?: OnOrder): OrderList {
  return groupOrderLines(items.flatMap((item) => orderLineFor(item, onOrderOf(onOrder, item.id)) ?? []));
}

/**
 * Lines grouped by preferred supplier (A–Z, `other` last; names compared ignoring capitals),
 * each group in catalog order (by item id), with subtotals and the grand total (F12, F27).
 */
export function groupOrderLines(lines: readonly OrderLine[]): OrderList {
  const bySupplier = new Map<string, SupplierGroup>();
  const sorted = [...lines].sort((a, b) => (a.item.id < b.item.id ? -1 : a.item.id > b.item.id ? 1 : 0));
  for (const line of sorted) {
    const key = nameKey(line.vendor.supplier);
    let g = bySupplier.get(key);
    if (!g) {
      g = { supplier: line.vendor.supplier, lines: [], subtotalCents: 0, noPriceCount: 0 };
      bySupplier.set(key, g);
    }
    g.lines.push(line);
    if (line.lineTotalCents === null) g.noPriceCount++;
    else g.subtotalCents += line.lineTotalCents;
  }
  return withTotals([...bySupplier.values()].sort((a, b) => compareSupplierNames(a.supplier, b.supplier)));
}

function withTotals(groups: SupplierGroup[]): OrderList {
  let grandTotalCents = 0;
  let lineCount = 0;
  let noPriceCount = 0;
  for (const g of groups) {
    grandTotalCents += g.subtotalCents;
    lineCount += g.lines.length;
    noPriceCount += g.noPriceCount;
  }
  return { groups, grandTotalCents, lineCount, pricedLineCount: lineCount - noPriceCount, noPriceCount };
}

/** What an order line is searched by (F12): item name, part #, supplier and notes. */
export function orderLineText(l: OrderLine): string {
  return normalize([l.item.name, l.vendor.partNo, l.vendor.supplier, l.item.notes].join(' \n '));
}

/**
 * F12 search: the lines containing every search word (as F4: capitals and accents ignored),
 * with each supplier's subtotal, the grand total and the counts worked out for those lines
 * only. Suppliers with no matching line drop out. A blank search gives the list back.
 */
export function filterOrderList(list: OrderList, query: string): OrderList {
  const terms = queryTerms(query);
  if (terms.length === 0) return list;
  const groups: SupplierGroup[] = [];
  for (const g of list.groups) {
    const lines = g.lines.filter((l) => matchesTerms(orderLineText(l), terms));
    if (lines.length === 0) continue;
    let subtotalCents = 0;
    let noPriceCount = 0;
    for (const l of lines) {
      if (l.lineTotalCents === null) noPriceCount++;
      else subtotalCents += l.lineTotalCents;
    }
    groups.push({ supplier: g.supplier, lines, subtotalCents, noPriceCount });
  }
  return withTotals(groups);
}
