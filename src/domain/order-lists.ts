// Named order lists (SPEC §3 "Order list", F27): lists of chosen items and quantities, kept
// apart from the automatic list (F12). A list is a plan: nothing here changes an item.
import { groupOrderLines, orderLineFor, type OrderLine, type OrderList } from './order';
import { nameKey, preferredVendorOf, type Item } from './types';

export interface OrderListLine {
  itemId: string;
  /** Quantity wanted, in the item's unit; whole number ≥ 1. Packs are worked out from it (§4). */
  quantity: number;
}

export interface NamedOrderList {
  id: string;
  name: string;
  notes: string;
  /** ms since epoch. */
  created: number;
  updated: number;
  lines: OrderListLine[];
}

export const MAX_LIST_NAME = 60;

/** Packs and order quantity for a wanted quantity: packs = ceil(quantity ÷ pack_size) (§4). */
export function packsFor(quantity: number, packSize: number): { packs: number; orderQty: number } {
  if (!Number.isInteger(packSize) || packSize < 1) throw new RangeError(`pack size must be a whole number ≥ 1 (got ${packSize})`);
  const packs = Math.ceil(Math.max(0, quantity) / packSize);
  return { packs, orderQty: packs * packSize };
}

/**
 * F27 default when adding an item: its suggested order quantity (§4) when it needs ordering,
 * otherwise one pack of its preferred vendor.
 */
export function defaultQuantity(item: Item): number {
  return orderLineFor(item)?.orderQty ?? preferredVendorOf(item)?.packSize ?? 1;
}

/**
 * One pack more or less (the line's +/−). The result is a whole number of packs, never less
 * than one pack: removing a line is its own action.
 */
export function stepQuantity(quantity: number, packSize: number, deltaPacks: number): number {
  const { packs } = packsFor(quantity, packSize);
  return Math.max(1, packs + deltaPacks) * packSize;
}

/** A list line priced like the automatic list (§4): need is the quantity wanted. */
export function namedLine(item: Item, quantity: number): OrderLine | null {
  const vendor = preferredVendorOf(item);
  if (!vendor) return null;
  const { packs, orderQty } = packsFor(quantity, vendor.packSize);
  const lineTotalCents = vendor.packPriceCents === null ? null : packs * vendor.packPriceCents;
  return { item, vendor, need: quantity, packs, orderQty, lineTotalCents };
}

/** The list as an order list (F27): grouped by preferred supplier with totals, as in F12. */
export function buildNamedOrder(list: NamedOrderList, items: readonly Item[]): OrderList {
  const byId = new Map(items.map((i) => [i.id, i]));
  return groupOrderLines(
    list.lines.flatMap((l) => {
      const item = byId.get(l.itemId);
      return (item && namedLine(item, l.quantity)) ?? [];
    }),
  );
}

/** Lists are shown A–Z, ignoring capitals. */
export function sortLists<T extends { name: string }>(lists: readonly T[]): T[] {
  return [...lists].sort((a, b) => a.name.localeCompare(b.name, 'en-US', { sensitivity: 'base' }));
}

/** Why a list name can't be used, or null. Names are unique ignoring capitals (§3). */
export function listNameProblem(name: string, lists: readonly { id: string; name: string }[], exceptId?: string): string | null {
  const n = name.trim();
  if (n === '') return 'Give the list a name.';
  if (n.length > MAX_LIST_NAME) return `Keep the name to ${MAX_LIST_NAME} characters or fewer.`;
  const clash = lists.find((l) => l.id !== exceptId && nameKey(l.name) === nameKey(n));
  return clash ? `There’s already a list called “${clash.name}”.` : null;
}

/** "WCP order (copy)", then "(copy 2)", … — the first name not taken. */
export function copyName(name: string, lists: readonly { name: string }[]): string {
  const taken = new Set(lists.map((l) => nameKey(l.name)));
  const base = name.trim().slice(0, MAX_LIST_NAME - 9);
  for (let n = 1; ; n++) {
    const candidate = `${base} (copy${n === 1 ? '' : ` ${n}`})`;
    if (!taken.has(nameKey(candidate))) return candidate;
  }
}

/** Order lists keep only lines for items that exist (a deleted item leaves every list, F27). */
export function withoutMissingItems(list: NamedOrderList, itemIds: ReadonlySet<string>): NamedOrderList {
  const lines = list.lines.filter((l) => itemIds.has(l.itemId));
  return lines.length === list.lines.length ? list : { ...list, lines };
}

/** Random list id, like an item id but "ol-" (never shown; only ties CSV rows together). */
export function newListId(isTaken: (id: string) => boolean, random: () => number = Math.random): string {
  const alphabet = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  for (let attempt = 0; attempt < 1000; attempt++) {
    let s = 'ol-';
    for (let i = 0; i < 6; i++) s += alphabet[Math.floor(random() * alphabet.length)];
    if (!isTaken(s)) return s;
  }
  throw new Error('could not find a free list id');
}
