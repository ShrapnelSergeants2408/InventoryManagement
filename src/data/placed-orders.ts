// Placed orders (F30, F31, §21): record, edit, cancel, delete and receive, copy charged prices
// into the catalog, and receipts. The screens ask for the PIN (§6) except for receiving; each
// write runs in one transaction with the change marker, so a failure changes nothing.
import {
  MAX_RECEIPTS,
  isOpen,
  lineUnits,
  newOrderId,
  nextReceiptId,
  onOrderMap,
  orderProblems,
  receiveProblem,
  receivedAnything,
  sortOrders,
  type PlacedOrder,
  type PriceChange,
  type ReceiptType,
} from '../domain/placed-orders';
import { nameKey } from '../domain/types';
import { fromItemRow, fromOrderListRow, fromOrderRow, toItemRow, toOrderListRow, toOrderRow, type InventoryDb } from './db';

/** Every order, newest first (§21.5). */
export async function loadOrders(db: InventoryDb): Promise<PlacedOrder[]> {
  return sortOrders((await db.orders.toArray()).map(fromOrderRow));
}

export async function getOrder(db: InventoryDb, id: string): Promise<PlacedOrder | null> {
  const row = await db.orders.get(id);
  return row ? fromOrderRow(row) : null;
}

/** Units on open orders per item id (§4). */
export async function loadOnOrder(db: InventoryDb): Promise<Map<string, number>> {
  return onOrderMap((await db.orders.toArray()).map(fromOrderRow));
}

async function touch(db: InventoryDb, now: number): Promise<void> {
  await db.settings.put({ key: 'lastChangeAt', value: now });
}

async function mustGet(db: InventoryDb, id: string): Promise<PlacedOrder> {
  const row = await db.orders.get(id);
  if (!row) throw new Error('that order was deleted');
  return fromOrderRow(row);
}

function check(order: OrderInput): void {
  const problems = orderProblems(order);
  if (problems.length > 0) throw new Error(problems.map((p) => p.message).join(' '));
}

export type OrderInput = Omit<PlacedOrder, 'id' | 'created' | 'updated' | 'receipts' | 'cancelled'>;

export interface RecordResult {
  order: PlacedOrder;
  /** The named list it came from, after the ordered lines left it; null for the automatic list. */
  list: { id: string; name: string; linesLeft: number } | null;
}

/**
 * Mark ordered (F30, §21.1): stores the order as placed and, for a named list, removes the
 * lines of the items that were ordered (unticked lines stay). Received starts at 0.
 */
export async function recordOrder(db: InventoryDb, input: OrderInput, from: { listId: string } | null, now = Date.now()): Promise<RecordResult> {
  const order: Omit<PlacedOrder, 'id'> = { ...input, lines: input.lines.map((l) => ({ ...l, received: 0 })), cancelled: false, receipts: [], created: now, updated: now };
  check(order);
  return db.transaction('rw', db.orders, db.orderLists, db.settings, async () => {
    const taken = new Set(await db.orders.toCollection().primaryKeys());
    const saved: PlacedOrder = { ...order, id: newOrderId((id) => taken.has(id)) };
    await db.orders.add(toOrderRow(saved));
    let list: RecordResult['list'] = null;
    if (from) {
      const row = await db.orderLists.get(from.listId);
      if (!row) throw new Error('that order list was deleted');
      const named = fromOrderListRow(row);
      const ordered = new Set(saved.lines.map((l) => l.itemId).filter(Boolean));
      const lines = named.lines.filter((l) => !ordered.has(l.itemId));
      if (lines.length !== named.lines.length) await db.orderLists.put(toOrderListRow({ ...named, lines, updated: now }));
      list = { id: named.id, name: named.name, linesLeft: lines.length };
    }
    await touch(db, now);
    return { order: saved, list };
  });
}

/**
 * Edit (§21.4): every field and line; packs can't go below what was received, and received
 * amounts can be corrected without touching on hand. Inventory and order lists don't change.
 */
export async function updateOrder(db: InventoryDb, id: string, input: OrderInput, now = Date.now()): Promise<PlacedOrder> {
  return db.transaction('rw', db.orders, db.settings, async () => {
    const was = await mustGet(db, id);
    const next: PlacedOrder = { ...was, ...input, id, receipts: was.receipts, cancelled: was.cancelled, created: was.created, updated: now };
    check(next);
    if (next.cancelled && receivedAnything(next)) throw new Error('A cancelled order can’t have received parts. Un-cancel it first.');
    await db.orders.put(toOrderRow(next));
    await touch(db, now);
    return next;
  });
}

/** Cancel (only while nothing has been received) or un-cancel (§21.4). */
export async function setCancelled(db: InventoryDb, id: string, cancelled: boolean, now = Date.now()): Promise<PlacedOrder> {
  return db.transaction('rw', db.orders, db.settings, async () => {
    const was = await mustGet(db, id);
    if (cancelled && receivedAnything(was)) throw new Error('Parts on this order were already received, so it can’t be cancelled. Edit it down to what arrived instead.');
    const next = { ...was, cancelled, updated: now };
    await db.orders.put(toOrderRow(next));
    await touch(db, now);
    return next;
  });
}

/** Delete (§21.4): the order and its receipts. Received parts stay in on hand. */
export async function deleteOrder(db: InventoryDb, id: string, now = Date.now()): Promise<void> {
  await db.transaction('rw', db.orders, db.receipts, db.settings, async () => {
    await mustGet(db, id);
    await db.orders.delete(id);
    await db.receipts.where('orderId').equals(id).delete();
    await touch(db, now);
  });
}

export interface ReceiveResult {
  order: PlacedOrder;
  /** Inventory items whose on hand went up, and by how many units in all. */
  items: number;
  units: number;
}

/**
 * Receive (F31): adds each line's received-now units to the line and to the item's on hand, in
 * one transaction. Typed lines and lines for deleted items are marked received without changing
 * inventory. last_counted isn't touched: receiving isn't a count.
 */
export async function receiveOrder(db: InventoryDb, id: string, amounts: readonly number[], now = Date.now()): Promise<ReceiveResult> {
  return db.transaction('rw', db.orders, db.items, db.settings, async () => {
    const was = await mustGet(db, id);
    const problem = receiveProblem(was, amounts);
    if (problem) throw new Error(problem);
    const add = new Map<string, number>();
    const lines = was.lines.map((l, i) => {
      const a = amounts[i]!;
      if (a > 0 && l.itemId) add.set(l.itemId, (add.get(l.itemId) ?? 0) + a);
      return a > 0 ? { ...l, received: l.received + a } : l;
    });
    let items = 0;
    let units = 0;
    for (const [itemId, n] of add) {
      const row = await db.items.get(itemId);
      if (!row) continue;
      await db.items.update(itemId, { onHand: row.onHand + n, updatedAt: now });
      items++;
      units += n;
    }
    const order = { ...was, lines, updated: now };
    await db.orders.put(toOrderRow(order));
    await touch(db, now);
    return { order, items, units };
  });
}

/**
 * Copy charged prices into the catalog (§21.3): for each change, the vendor option's pack price
 * and pack size, and price_checked = the placed date. `checked` only sets price_checked. Items
 * deleted or changed to another supplier since are skipped. Returns how many options changed.
 */
export async function applyPriceChanges(db: InventoryDb, supplier: string, changes: readonly PriceChange[], checked: readonly PriceChange[], placedOn: string, now = Date.now()): Promise<number> {
  return db.transaction('rw', db.items, db.settings, async () => {
    let n = 0;
    const write = async (c: PriceChange, setPrice: boolean) => {
      const row = await db.items.get(c.itemId);
      const v = row?.vendors[c.slot - 1];
      if (!row || !v || nameKey(v.supplier) !== nameKey(supplier)) return;
      const vendors = [...row.vendors] as typeof row.vendors;
      vendors[c.slot - 1] = setPrice ? { ...v, packPriceCents: c.toPriceCents, packSize: c.toPackSize, priceChecked: placedOn } : { ...v, priceChecked: placedOn };
      await db.items.put(toItemRow({ ...fromItemRow(row), vendors }, now));
      n++;
    };
    for (const c of changes) await write(c, true);
    for (const c of checked) await write(c, false);
    if (n > 0) await touch(db, now);
    return n;
  });
}

/** Adds a receipt (§21.2): a prepared JPEG or a PDF up to the limit, at most 5 per order. */
export async function addReceipt(db: InventoryDb, orderId: string, blob: Blob, type: ReceiptType, now = Date.now()): Promise<PlacedOrder> {
  return db.transaction('rw', db.orders, db.receipts, db.settings, async () => {
    const was = await mustGet(db, orderId);
    const id = nextReceiptId(was);
    if (!id) throw new Error(`An order can have up to ${MAX_RECEIPTS} receipts. Remove one first.`);
    await db.receipts.put({ id, orderId, blob: new Blob([blob], { type }) });
    const next = { ...was, receipts: [...was.receipts, { id, type }], updated: now };
    await db.orders.put(toOrderRow(next));
    await touch(db, now);
    return next;
  });
}

export async function removeReceipt(db: InventoryDb, orderId: string, receiptId: string, now = Date.now()): Promise<PlacedOrder> {
  return db.transaction('rw', db.orders, db.receipts, db.settings, async () => {
    const was = await mustGet(db, orderId);
    await db.receipts.delete(receiptId);
    const next = { ...was, receipts: was.receipts.filter((r) => r.id !== receiptId), updated: now };
    await db.orders.put(toOrderRow(next));
    await touch(db, now);
    return next;
  });
}

export async function getReceipt(db: InventoryDb, receiptId: string): Promise<Blob | null> {
  return (await db.receipts.get(receiptId))?.blob ?? null;
}

/**
 * Restore (§21.6): the backup's orders and receipts replace the tablet's. A receipt the ZIP
 * didn't have is dropped from its order. Runs inside the caller's transaction.
 */
export async function replaceOrders(db: InventoryDb, orders: readonly PlacedOrder[], receipts: ReadonlyMap<string, Blob>): Promise<void> {
  await db.orders.clear();
  await db.receipts.clear();
  await db.orders.bulkAdd(orders.map((o) => toOrderRow({ ...o, receipts: o.receipts.filter((r) => receipts.has(r.id)) })));
  await db.receipts.bulkAdd(orders.flatMap((o) => o.receipts.flatMap((r) => (receipts.has(r.id) ? [{ id: r.id, orderId: o.id, blob: new Blob([receipts.get(r.id)!], { type: r.type }) }] : []))));
}

/** Open orders an item is on, and how many of its units are still due (the delete confirmation, §21.4). */
export async function openOrdersWithItem(db: InventoryDb, itemId: string): Promise<{ orders: number; units: number }> {
  const orders = (await db.orders.where('itemIds').equals(itemId).toArray()).map(fromOrderRow).filter(isOpen);
  const units = orders.reduce((n, o) => n + o.lines.filter((l) => l.itemId === itemId).reduce((m, l) => m + Math.max(0, lineUnits(l) - l.received), 0), 0);
  return { orders: orders.length, units };
}
