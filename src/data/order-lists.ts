// Named order lists (F27): create, rename, duplicate, delete, and their lines. No PIN (§6).
// Lists never change an item; each write runs in one transaction with the change marker.
import { applyAddMany, copyName, listNameProblem, newListId, planAddMany, sortLists, type NamedOrderList, type QuantityRule } from '../domain/order-lists';
import { fromItemRow, fromOrderListRow, toOrderListRow, type InventoryDb } from './db';

export async function loadOrderLists(db: InventoryDb): Promise<NamedOrderList[]> {
  return sortLists((await db.orderLists.toArray()).map(fromOrderListRow));
}

/** Names of the lists an item is on (the delete confirmation says how many, F27). */
export async function listsWithItem(db: InventoryDb, itemId: string): Promise<string[]> {
  return sortLists(await db.orderLists.where('itemIds').equals(itemId).toArray()).map((l) => l.name);
}

async function touch(db: InventoryDb, now: number): Promise<void> {
  await db.settings.put({ key: 'lastChangeAt', value: now });
}

async function current(db: InventoryDb): Promise<NamedOrderList[]> {
  return (await db.orderLists.toArray()).map(fromOrderListRow);
}

async function getList(db: InventoryDb, id: string): Promise<NamedOrderList> {
  const row = await db.orderLists.get(id);
  if (!row) throw new Error('that order list was deleted');
  return fromOrderListRow(row);
}

async function save(db: InventoryDb, list: NamedOrderList, now: number): Promise<NamedOrderList> {
  const saved = { ...list, updated: now };
  await db.orderLists.put(toOrderListRow(saved));
  await touch(db, now);
  return saved;
}

export async function createOrderList(db: InventoryDb, name: string, notes: string, now = Date.now()): Promise<NamedOrderList> {
  return db.transaction('rw', db.orderLists, db.settings, async () => {
    const lists = await current(db);
    const problem = listNameProblem(name, lists);
    if (problem) throw new Error(problem);
    const ids = new Set(lists.map((l) => l.id));
    const list: NamedOrderList = { id: newListId((id) => ids.has(id)), name: name.trim(), notes: notes.trim(), created: now, updated: now, lines: [] };
    return save(db, list, now);
  });
}

/** Rename and/or change the notes. */
export async function editOrderList(db: InventoryDb, id: string, name: string, notes: string, now = Date.now()): Promise<NamedOrderList> {
  return db.transaction('rw', db.orderLists, db.settings, async () => {
    const problem = listNameProblem(name, await current(db), id);
    if (problem) throw new Error(problem);
    return save(db, { ...(await getList(db, id)), name: name.trim(), notes: notes.trim() }, now);
  });
}

/** A copy with the same lines, named "… (copy)" unless a name is given. */
export async function duplicateOrderList(db: InventoryDb, id: string, name?: string, now = Date.now()): Promise<NamedOrderList> {
  return db.transaction('rw', db.orderLists, db.settings, async () => {
    const lists = await current(db);
    const from = await getList(db, id);
    const newName = name ?? copyName(from.name, lists);
    const problem = listNameProblem(newName, lists);
    if (problem) throw new Error(problem);
    const ids = new Set(lists.map((l) => l.id));
    return save(db, { ...from, id: newListId((x) => ids.has(x)), name: newName.trim(), created: now, lines: from.lines.map((l) => ({ ...l })) }, now);
  });
}

export async function deleteOrderList(db: InventoryDb, id: string, now = Date.now()): Promise<void> {
  await db.transaction('rw', db.orderLists, db.settings, async () => {
    await getList(db, id);
    await db.orderLists.delete(id);
    await touch(db, now);
  });
}

export type AddResult = { kind: 'added' } | { kind: 'replaced'; was: number } | { kind: 'exists'; quantity: number };

/**
 * Adds an item to a list (F27). When it's already there, nothing changes and the result says
 * so (the screen asks first), unless `replace` is set: then the quantity is replaced.
 */
export async function addToOrderList(db: InventoryDb, listId: string, itemId: string, quantity: number, opts: { replace?: boolean } = {}, now = Date.now()): Promise<AddResult> {
  checkQuantity(quantity);
  return db.transaction('rw', db.orderLists, db.items, db.settings, async () => {
    if (!(await db.items.get(itemId))) throw new Error('that item was deleted');
    const list = await getList(db, listId);
    const at = list.lines.findIndex((l) => l.itemId === itemId);
    if (at >= 0 && !opts.replace) return { kind: 'exists', quantity: list.lines[at]!.quantity };
    const lines = [...list.lines];
    const was = at >= 0 ? lines[at]!.quantity : null;
    if (at >= 0) lines[at] = { itemId, quantity };
    else lines.push({ itemId, quantity });
    await save(db, { ...list, lines }, now);
    return was === null ? { kind: 'added' } : { kind: 'replaced', was };
  });
}

/** The line's quantity (+/−, F27). */
export async function setLineQuantity(db: InventoryDb, listId: string, itemId: string, quantity: number, now = Date.now()): Promise<void> {
  checkQuantity(quantity);
  await db.transaction('rw', db.orderLists, db.settings, async () => {
    const list = await getList(db, listId);
    if (!list.lines.some((l) => l.itemId === itemId)) throw new Error('that line was removed');
    await save(db, { ...list, lines: list.lines.map((l) => (l.itemId === itemId ? { itemId, quantity } : l)) }, now);
  });
}

export async function removeLine(db: InventoryDb, listId: string, itemId: string, now = Date.now()): Promise<void> {
  await db.transaction('rw', db.orderLists, db.settings, async () => {
    const list = await getList(db, listId);
    await save(db, { ...list, lines: list.lines.filter((l) => l.itemId !== itemId) }, now);
  });
}

function checkQuantity(quantity: number): void {
  if (!Number.isSafeInteger(quantity) || quantity < 1) throw new RangeError('quantity must be a whole number ≥ 1');
}

export interface AddManyResult {
  list: NamedOrderList;
  added: number;
  /** Already on the list: replaced, or kept as they were. */
  replaced: number;
  kept: number;
  skipped: number;
}

/**
 * Adds many items at once (F27 "Add many at once") to a list, or to a new list when `to` has
 * a name, in one transaction. The plan is worked out from the items as stored now.
 */
export async function addManyToOrderList(
  db: InventoryDb,
  to: { listId: string } | { newName: string },
  itemIds: readonly string[],
  rule: QuantityRule,
  replace: boolean,
  now = Date.now(),
): Promise<AddManyResult> {
  return db.transaction('rw', db.orderLists, db.items, db.settings, async () => {
    const items = (await db.items.bulkGet([...itemIds])).flatMap((r) => (r ? [fromItemRow(r)] : []));
    if (items.length === 0) throw new Error('none of those items are here any more');
    let list: NamedOrderList;
    if ('newName' in to) {
      const lists = await current(db);
      const problem = listNameProblem(to.newName, lists);
      if (problem) throw new Error(problem);
      const ids = new Set(lists.map((l) => l.id));
      list = { id: newListId((id) => ids.has(id)), name: to.newName.trim(), notes: '', created: now, updated: now, lines: [] };
    } else list = await getList(db, to.listId);
    const plan = planAddMany(items, rule, list);
    const saved = await save(db, { ...list, lines: applyAddMany(list, plan, replace) }, now);
    return {
      list: saved,
      added: plan.add.length,
      replaced: replace ? plan.onList.length : 0,
      kept: replace ? 0 : plan.onList.length,
      skipped: plan.skipped.length,
    };
  });
}
