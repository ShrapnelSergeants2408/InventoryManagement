// Order quantity and order list (SPEC §4, F12).
import { OTHER_SUPPLIER, preferredVendorOf, type Item, type Vendor } from './types';

export interface OrderQuantity {
  need: number;
  packs: number;
  orderQty: number;
}

/**
 * need = desired + spares − on_hand; nothing is ordered when need ≤ 0;
 * packs = ceil(need ÷ pack_size); order_qty = packs × pack_size.
 */
export function orderQuantity(desired: number, spares: number, onHand: number, packSize: number): OrderQuantity {
  if (!Number.isInteger(packSize) || packSize < 1) throw new RangeError(`pack size must be a whole number ≥ 1 (got ${packSize})`);
  const need = desired + spares - onHand;
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

/** The item's order line via its preferred vendor, or null when nothing needs ordering. */
export function orderLineFor(item: Item): OrderLine | null {
  const vendor = preferredVendorOf(item);
  if (!vendor) return null;
  const q = orderQuantity(item.desired, item.spares, item.onHand, vendor.packSize);
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

export function buildOrderList(items: readonly Item[]): OrderList {
  const bySupplier = new Map<string, SupplierGroup>();
  for (const item of items) {
    const line = orderLineFor(item);
    if (!line) continue;
    const name = line.vendor.supplier;
    let g = bySupplier.get(name);
    if (!g) {
      g = { supplier: name, lines: [], subtotalCents: 0, noPriceCount: 0 };
      bySupplier.set(name, g);
    }
    g.lines.push(line);
    if (line.lineTotalCents === null) g.noPriceCount++;
    else g.subtotalCents += line.lineTotalCents;
  }
  const groups = [...bySupplier.values()].sort((a, b) => compareSupplierNames(a.supplier, b.supplier));
  for (const g of groups) g.lines.sort((a, b) => a.item.name.localeCompare(b.item.name, 'en-US', { sensitivity: 'base' }));
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
