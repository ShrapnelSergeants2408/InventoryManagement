// Placed orders (SPEC §3 "Placed order", F30, F31, §21): what was actually bought from one
// supplier, with tax, shipping, fees and a discount, and how much of it has arrived. Money is
// integer cents (spec-questions Q6); a percent discount is kept in hundredths of a percent.
import { isIsoDate } from './validate';
import type { OrderLine, SupplierGroup } from './order';
import { nameKey, VENDOR_SLOTS, type Item, type VendorSlot } from './types';

export type DiscountKind = '$' | '%';

export interface Discount {
  kind: DiscountKind;
  /** '$': cents. '%': hundredths of a percent (750 = 7.5%). */
  value: number;
}

export interface PlacedLine {
  /** The inventory item, or '' for a typed line (§21.1). */
  itemId: string;
  /** Copied from the item when the order is recorded, so the record outlives edits and deletes. */
  description: string;
  partNo: string;
  unit: string;
  /** '' for a typed line ("Other" in the category summary, §21.5). */
  category: string;
  /** Whole number ≥ 1. A typed line's quantity. */
  packs: number;
  /** Whole number ≥ 1; always 1 for a typed line. */
  packSize: number;
  /** As charged, ≥ 0. */
  packPriceCents: number;
  /** Units received so far (F31). */
  received: number;
}

/** A receipt photo or PDF (§21.2); the bytes are stored apart, under the same id. */
export interface ReceiptRef {
  /** `<order id>-<n>`, n = 1…5; also its file name in a backup. */
  id: string;
  type: ReceiptType;
}

export type ReceiptType = 'image/jpeg' | 'application/pdf';

export interface PlacedOrder {
  id: string;
  supplier: string;
  /** Local date the order was placed, YYYY-MM-DD. */
  placedOn: string;
  orderNo: string;
  payment: string;
  cancelled: boolean;
  taxCents: number;
  shippingCents: number;
  feesCents: number;
  discount: Discount;
  notes: string;
  /** "Automatic" or the named list it was recorded from; '' when unknown. Informational. */
  fromList: string;
  receipts: ReceiptRef[];
  /** ms since epoch. */
  created: number;
  updated: number;
  lines: PlacedLine[];
}

export type OrderStatus = 'placed' | 'partly received' | 'received' | 'cancelled';

export const MAX_RECEIPTS = 5;
export const MAX_RECEIPT_PDF_BYTES = 5 * 1024 * 1024;
/** Receipt photos are larger than part photos so the printing stays readable (§21.2). */
export const RECEIPT_LONG_SIDE = 1600;
export const AUTOMATIC_LIST = 'Automatic';

export const lineUnits = (l: Pick<PlacedLine, 'packs' | 'packSize'>) => l.packs * l.packSize;
export const lineTotalCents = (l: Pick<PlacedLine, 'packs' | 'packPriceCents'>) => l.packs * l.packPriceCents;
/** Units still to come on a line, never below 0. */
export const lineDue = (l: PlacedLine) => Math.max(0, lineUnits(l) - l.received);

export interface OrderTotals {
  partsCents: number;
  discountCents: number;
  taxCents: number;
  shippingCents: number;
  feesCents: number;
  /** parts − discount + tax + shipping + fees (§21.1). */
  totalCents: number;
}

/** A percent of an amount in cents, rounded to the cent, half up. */
export function percentOf(cents: number, hundredthsOfPercent: number): number {
  return Math.floor((cents * hundredthsOfPercent + 5000) / 10000);
}

export function orderTotals(o: Pick<PlacedOrder, 'lines' | 'discount' | 'taxCents' | 'shippingCents' | 'feesCents'>): OrderTotals {
  const partsCents = o.lines.reduce((n, l) => n + lineTotalCents(l), 0);
  const discountCents = o.discount.kind === '$' ? o.discount.value : percentOf(partsCents, o.discount.value);
  return {
    partsCents,
    discountCents,
    taxCents: o.taxCents,
    shippingCents: o.shippingCents,
    feesCents: o.feesCents,
    totalCents: partsCents - discountCents + o.taxCents + o.shippingCents + o.feesCents,
  };
}

/** Placed, partly received and received follow from the lines; cancelled is set by a mentor (§3). */
export function orderStatus(o: Pick<PlacedOrder, 'cancelled' | 'lines'>): OrderStatus {
  if (o.cancelled) return 'cancelled';
  if (o.lines.every((l) => l.received >= lineUnits(l))) return 'received';
  return o.lines.some((l) => l.received > 0) ? 'partly received' : 'placed';
}

export const isOpen = (o: Pick<PlacedOrder, 'cancelled' | 'lines'>) => {
  const s = orderStatus(o);
  return s === 'placed' || s === 'partly received';
};

export const receivedAnything = (o: Pick<PlacedOrder, 'lines'>) => o.lines.some((l) => l.received > 0);

/** Units on order per item (§4): what open orders still have due, for item lines only. */
export type OnOrder = ReadonlyMap<string, number>;

export function onOrderMap(orders: readonly PlacedOrder[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const o of orders) {
    if (!isOpen(o)) continue;
    for (const l of o.lines) {
      const due = lineDue(l);
      if (l.itemId === '' || due === 0) continue;
      map.set(l.itemId, (map.get(l.itemId) ?? 0) + due);
    }
  }
  return map;
}

export const onOrderOf = (onOrder: OnOrder | undefined, itemId: string) => onOrder?.get(itemId) ?? 0;

/** A line copied from an inventory item (§21.1): description, part #, unit and category. */
export function itemLine(item: Item, packs: number, packSize: number, packPriceCents: number, partNo: string): PlacedLine {
  return { itemId: item.id, description: item.name, partNo, unit: item.unit, category: item.category, packs, packSize, packPriceCents, received: 0 };
}

export function typedLine(description: string, quantity: number, unitPriceCents: number): PlacedLine {
  return { itemId: '', description: description.trim(), partNo: '', unit: 'each', category: '', packs: quantity, packSize: 1, packPriceCents: unitPriceCents, received: 0 };
}

/** The vendor option an item has for a supplier (names compared ignoring capitals), preferred first. */
export function vendorSlotFor(item: Item, supplier: string): VendorSlot | null {
  const key = nameKey(supplier);
  const slots = [item.preferredVendor, ...VENDOR_SLOTS.filter((s) => s !== item.preferredVendor)];
  return slots.find((s) => item.vendors[s - 1] && nameKey(item.vendors[s - 1]!.supplier) === key) ?? null;
}

/** A line the order form starts with: the list line's packs and the stored price (null: none stored). */
export interface DraftLine {
  line: PlacedLine;
  /** null when the stored price was missing, so one must be typed (§21.1). */
  storedPriceCents: number | null;
}

/** The order form's lines for one supplier group of an order list (§21.1). */
export function draftLines(group: SupplierGroup): DraftLine[] {
  return group.lines.map((l: OrderLine) => ({
    line: itemLine(l.item, l.packs, l.vendor.packSize, l.vendor.packPriceCents ?? 0, l.vendor.partNo),
    storedPriceCents: l.vendor.packPriceCents,
  }));
}

/** A line added with "+ Add line" for an inventory item (§21.1). */
export function addedItemLine(item: Item, supplier: string): DraftLine {
  const slot = vendorSlotFor(item, supplier);
  const v = item.vendors[(slot ?? item.preferredVendor) - 1];
  const price = slot ? (v?.packPriceCents ?? null) : null;
  return { line: itemLine(item, 1, v?.packSize ?? 1, price ?? 0, slot ? (v?.partNo ?? '') : ''), storedPriceCents: price };
}

export type OrderField = 'supplier' | 'placedOn' | 'lines' | 'discount' | 'taxCents' | 'shippingCents' | 'feesCents';

export interface OrderProblem {
  field: OrderField | { line: number; field: 'description' | 'packs' | 'packSize' | 'packPriceCents' | 'received' };
  message: string;
}

const isCount = (n: number, min: number) => Number.isSafeInteger(n) && n >= min;

/** Every reason the order can't be saved (§21.1, §21.4); empty when it can. */
export function orderProblems(o: Omit<PlacedOrder, 'id' | 'created' | 'updated' | 'receipts' | 'cancelled'>): OrderProblem[] {
  const out: OrderProblem[] = [];
  if (o.supplier.trim() === '') out.push({ field: 'supplier', message: 'Choose the supplier.' });
  if (!isIsoDate(o.placedOn)) out.push({ field: 'placedOn', message: 'Enter the date the order was placed.' });
  if (o.lines.length === 0) out.push({ field: 'lines', message: 'Tick at least one line that was ordered.' });
  o.lines.forEach((l, line) => {
    if (l.description.trim() === '') out.push({ field: { line, field: 'description' }, message: 'Describe what was ordered.' });
    if (!isCount(l.packs, 1)) out.push({ field: { line, field: 'packs' }, message: 'Packs must be a whole number of at least 1.' });
    if (!isCount(l.packSize, 1)) out.push({ field: { line, field: 'packSize' }, message: 'Pack size must be a whole number of at least 1.' });
    if (!isCount(l.packPriceCents, 0)) out.push({ field: { line, field: 'packPriceCents' }, message: 'Enter the price charged ($0.00 or more).' });
    if (!isCount(l.received, 0) || (isCount(l.packs, 1) && isCount(l.packSize, 1) && l.received > lineUnits(l)))
      out.push({ field: { line, field: 'received' }, message: `Received can be 0 to ${isCount(l.packs, 1) && isCount(l.packSize, 1) ? lineUnits(l) : 'the ordered amount'}.` });
  });
  for (const f of ['taxCents', 'shippingCents', 'feesCents'] as const) {
    if (!isCount(o[f], 0)) out.push({ field: f, message: 'Enter an amount of $0.00 or more.' });
  }
  if (o.discount.kind === '%') {
    if (!isCount(o.discount.value, 0) || o.discount.value > 10000) out.push({ field: 'discount', message: 'A percent from 0 to 100.' });
  } else if (!isCount(o.discount.value, 0)) out.push({ field: 'discount', message: 'Enter an amount of $0.00 or more.' });
  else if (o.lines.every((l) => isCount(l.packs, 1) && isCount(l.packPriceCents, 0))) {
    const parts = o.lines.reduce((n, l) => n + lineTotalCents(l), 0);
    if (o.discount.value > parts) out.push({ field: 'discount', message: 'The discount can’t be more than the parts total.' });
  }
  return out;
}

/**
 * Parses a typed percent ("10", "7.5", "12.25%") into hundredths of a percent; null when it
 * isn't one. Range is checked by orderProblems.
 */
export function parsePercent(raw: string): number | null {
  const m = /^(\d{1,3})(?:\.(\d{0,2}))?$/.exec(raw.trim().replace(/%$/, '').trim());
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
}

/** "7.5" for 750; "10" for 1000. */
export function percentText(hundredths: number): string {
  const whole = Math.floor(hundredths / 100);
  const frac = hundredths % 100;
  return frac === 0 ? String(whole) : `${whole}.${String(frac).padStart(2, '0').replace(/0$/, '')}`;
}

/** One catalog price that differs from what was charged (§21.3). */
export interface PriceChange {
  itemId: string;
  name: string;
  slot: VendorSlot;
  fromPriceCents: number | null;
  fromPackSize: number;
  toPriceCents: number;
  toPackSize: number;
}

/**
 * §21.3: item lines whose item has a vendor option for the order's supplier, split into those
 * whose pack price or pack size differs (offered for update) and those that match (offered
 * "mark as checked"). Items without such an option, and deleted items, aren't offered. When
 * an item is on the order twice, its first line counts.
 */
export function priceChanges(order: Pick<PlacedOrder, 'supplier' | 'lines'>, items: readonly Item[]): { changed: PriceChange[]; unchanged: PriceChange[] } {
  const byId = new Map(items.map((i) => [i.id, i]));
  const seen = new Set<string>();
  const changed: PriceChange[] = [];
  const unchanged: PriceChange[] = [];
  for (const l of order.lines) {
    const item = l.itemId ? byId.get(l.itemId) : undefined;
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    const slot = vendorSlotFor(item, order.supplier);
    if (!slot) continue;
    const v = item.vendors[slot - 1]!;
    const c: PriceChange = { itemId: item.id, name: item.name, slot, fromPriceCents: v.packPriceCents, fromPackSize: v.packSize, toPriceCents: l.packPriceCents, toPackSize: l.packSize };
    (v.packPriceCents === l.packPriceCents && v.packSize === l.packSize ? unchanged : changed).push(c);
  }
  return { changed, unchanged };
}

/** Why a set of received-now amounts (one per line) can't be used, or null (F31). */
export function receiveProblem(order: PlacedOrder, amounts: readonly number[]): string | null {
  if (!isOpen(order)) return order.cancelled ? 'This order is cancelled.' : 'Everything on this order has been received.';
  if (amounts.length !== order.lines.length) return 'The order changed. Close this and try again.';
  for (let i = 0; i < amounts.length; i++) {
    const a = amounts[i]!;
    if (!isCount(a, 0) || a > lineDue(order.lines[i]!)) return `Line ${i + 1}: receive 0 to ${lineDue(order.lines[i]!)}.`;
  }
  return amounts.some((a) => a > 0) ? null : 'Nothing to receive: every amount is 0.';
}

/** Orders newest first: by placed date, then by when they were recorded. */
export function sortOrders<T extends Pick<PlacedOrder, 'placedOn' | 'created'>>(orders: readonly T[]): T[] {
  return [...orders].sort((a, b) => (a.placedOn !== b.placedOn ? (a.placedOn < b.placedOn ? 1 : -1) : b.created - a.created));
}

/** Random order id, "po-" and six letters or digits, like a list id. */
export function newOrderId(isTaken: (id: string) => boolean, random: () => number = Math.random): string {
  const alphabet = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  for (let attempt = 0; attempt < 1000; attempt++) {
    let s = 'po-';
    for (let i = 0; i < 6; i++) s += alphabet[Math.floor(random() * alphabet.length)];
    if (!isTaken(s)) return s;
  }
  throw new Error('could not find a free order id');
}

/** The next receipt id for an order: `<order id>-<n>`, the lowest free n (§21.2). */
export function nextReceiptId(order: Pick<PlacedOrder, 'id' | 'receipts'>): string | null {
  if (order.receipts.length >= MAX_RECEIPTS) return null;
  const used = new Set(order.receipts.map((r) => r.id));
  for (let n = 1; ; n++) if (!used.has(`${order.id}-${n}`)) return `${order.id}-${n}`;
}

export const STATUS_LABEL: Record<OrderStatus, string> = {
  placed: 'Placed',
  'partly received': 'Partly received',
  received: 'Received',
  cancelled: 'Cancelled',
};
