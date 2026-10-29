import 'fake-indexeddb/auto';
import JSZip from 'jszip';
import { afterEach, describe, expect, it } from 'vitest';
import { applyRestore, buildBackup } from '../src/data/backup';
import { InventoryDb } from '../src/data/db';
import { loadSnapshot, replaceAll, type ReplaceAllInput } from '../src/data/inventory';
import { deleteItem } from '../src/data/items';
import { renameCategory, updateSupplier, removeSupplier } from '../src/data/lists';
import { addManyToOrderList, createOrderList, addToOrderList, loadOrderLists } from '../src/data/order-lists';
import {
  addReceipt,
  applyPriceChanges,
  deleteOrder,
  getOrder,
  loadOnOrder,
  loadOrders,
  openOrdersWithItem,
  receiveOrder,
  recordOrder,
  removeReceipt,
  setCancelled,
  updateOrder,
  type OrderInput,
} from '../src/data/placed-orders';
import { startInventory } from '../src/data/setup';
import { orderTotalCents } from '../src/domain/count';
import { passesFilters, NO_FILTERS } from '../src/domain/filters';
import { orderLines } from '../src/domain/item-text';
import { buildOrderList } from '../src/domain/order';
import { ruleQuantity, defaultQuantity, buildNamedOrder } from '../src/domain/order-lists';
import {
  addedItemLine,
  draftLines,
  isOpen,
  itemLine,
  lineDue,
  lineTotalCents,
  lineUnits,
  nextReceiptId,
  onOrderMap,
  orderProblems,
  orderStatus,
  orderTotals,
  parsePercent,
  percentOf,
  percentText,
  priceChanges,
  receiveProblem,
  sortOrders,
  typedLine,
  type PlacedLine,
  type PlacedOrder,
} from '../src/domain/placed-orders';
import { stockStatus } from '../src/domain/status';
import { parseOrdersCsv, serializeOrderLinesCsv, serializeOrdersCsv } from '../src/io/orders-csv';
import { readRestoreFile } from '../src/io/restore';
import { item, vendor } from './helpers';

// SPEC v0.13 F30, F31, §4 on order, §21.1–§21.4, §21.6 and the §22 tests for them.

const dbs: InventoryDb[] = [];
afterEach(() => {
  for (const d of dbs.splice(0)) d.close();
});
const newDb = () => {
  const d = new InventoryDb(`po-${Math.random()}`);
  dbs.push(d);
  return d;
};

const line = (over: Partial<PlacedLine> = {}): PlacedLine => ({
  itemId: 'a',
  description: 'A',
  partNo: '',
  unit: 'each',
  category: 'Electrical',
  packs: 1,
  packSize: 1,
  packPriceCents: 1000,
  received: 0,
  ...over,
});

const order = (over: Partial<PlacedOrder> = {}): PlacedOrder => ({
  id: 'po-1',
  supplier: 'REV',
  placedOn: '2026-10-28',
  orderNo: '',
  payment: '',
  cancelled: false,
  taxCents: 0,
  shippingCents: 0,
  feesCents: 0,
  discount: { kind: '$', value: 0 },
  notes: '',
  fromList: 'Automatic',
  receipts: [],
  created: 1,
  updated: 1,
  lines: [line()],
  ...over,
});

const input = (over: Partial<OrderInput> = {}): OrderInput => {
  const { id: _i, created: _c, updated: _u, receipts: _r, cancelled: _x, ...o } = order();
  return { ...o, ...over };
};

/** A tablet: a (REV, pack 1, $10), b (REV, pack 25, $5, WCP option 2), c (WCP), all short. */
function tablet(): ReplaceAllInput {
  return {
    items: [
      item({ id: 'a', name: 'NEO', category: 'Electrical', desired: 4, spares: 2, onHand: 1, vendors: [vendor({ supplier: 'REV', partNo: 'REV-21', packSize: 1, packPriceCents: 1000 }), null, null] }),
      item({
        id: 'b',
        name: 'Bolt',
        category: 'Fasteners',
        unit: 'each',
        desired: 30,
        onHand: 0,
        vendors: [vendor({ supplier: 'REV', partNo: 'REV-B', packSize: 25, packPriceCents: 500 }), vendor({ supplier: 'WCP', partNo: 'WCP-B', packSize: 10, packPriceCents: 300 }), null],
      }),
      item({ id: 'c', name: 'Belt', category: 'Power Transfer', desired: 2, onHand: 0, vendors: [vendor({ supplier: 'WCP', packSize: 1, packPriceCents: null }), null, null] }),
    ],
    photos: new Map(),
    suppliers: [
      { name: 'REV', website: '', notes: '' },
      { name: 'WCP', website: '', notes: '' },
      { name: 'other', website: '', notes: '' },
    ],
    locations: [],
    categories: [
      { name: 'Electrical', order: 0, subcategories: [] },
      { name: 'Fasteners', order: 1, subcategories: [] },
      { name: 'Power Transfer', order: 2, subcategories: [] },
    ],
  };
}

async function setUp() {
  const db = newDb();
  await replaceAll(db, tablet());
  return db;
}

const itemsOf = async (db: InventoryDb) => new Map((await loadSnapshot(db)).items.map((i) => [i.id, i]));

describe('totals (§21.1)', () => {
  it('parts − discount + tax + shipping + fees, to the cent', () => {
    const o = order({ lines: [line({ packs: 3, packPriceCents: 1999 }), line({ packs: 2, packSize: 25, packPriceCents: 505 })], taxCents: 412, shippingCents: 1095, feesCents: 150, discount: { kind: '$', value: 500 } });
    expect(orderTotals(o)).toEqual({ partsCents: 7007, discountCents: 500, taxCents: 412, shippingCents: 1095, feesCents: 150, totalCents: 8164 });
  });

  it('a percent discount rounds to the cent, half up', () => {
    expect(percentOf(1005, 1000)).toBe(101); // 10% of $10.05 = 100.5¢ → 101
    expect(percentOf(1004, 1000)).toBe(100); // 100.4¢ → 100
    expect(percentOf(999, 750)).toBe(75); // 7.5% of $9.99 = 74.925¢ → 75
    expect(percentOf(0, 10000)).toBe(0);
    expect(orderTotals(order({ lines: [line({ packs: 1, packPriceCents: 1005 })], discount: { kind: '%', value: 1000 } })).totalCents).toBe(904);
  });

  it('percent text and parsing', () => {
    expect([parsePercent('10'), parsePercent('7.5'), parsePercent(' 12.25 % '), parsePercent('100'), parsePercent('0')]).toEqual([1000, 750, 1225, 10000, 0]);
    expect([parsePercent(''), parsePercent('-1'), parsePercent('1.234'), parsePercent('abc'), parsePercent('1000')]).toEqual([null, null, null, null, null]);
    expect([percentText(1000), percentText(750), percentText(1225), percentText(5)]).toEqual(['10', '7.5', '12.25', '0.05']);
  });

  it('the checks refuse each bad value', () => {
    const msgs = (o: Partial<OrderInput>) => orderProblems(input(o)).map((p) => p.message);
    expect(msgs({})).toEqual([]);
    expect(msgs({ lines: [] })).toEqual(['Tick at least one line that was ordered.']);
    expect(msgs({ placedOn: '2026-02-30' })).toEqual(['Enter the date the order was placed.']);
    expect(msgs({ supplier: ' ' })).toEqual(['Choose the supplier.']);
    expect(msgs({ lines: [line({ packs: 0 })] })).toEqual(['Packs must be a whole number of at least 1.']);
    expect(msgs({ lines: [line({ packSize: 1.5 })] })).toEqual(['Pack size must be a whole number of at least 1.']);
    expect(msgs({ lines: [line({ packPriceCents: -1 })] })).toEqual(['Enter the price charged ($0.00 or more).']);
    expect(msgs({ lines: [line({ description: '' })] })).toEqual(['Describe what was ordered.']);
    expect(msgs({ lines: [line({ received: 2 })] })).toEqual(['Received can be 0 to 1.']);
    expect(msgs({ taxCents: -5 })).toEqual(['Enter an amount of $0.00 or more.']);
    expect(msgs({ shippingCents: 0.5 })).toEqual(['Enter an amount of $0.00 or more.']);
    expect(msgs({ feesCents: -1 })).toEqual(['Enter an amount of $0.00 or more.']);
    expect(msgs({ discount: { kind: '%', value: 10001 } })).toEqual(['A percent from 0 to 100.']);
    expect(msgs({ discount: { kind: '$', value: 1001 } })).toEqual(['The discount can’t be more than the parts total.']);
    expect(msgs({ discount: { kind: '$', value: 1000 } })).toEqual([]);
    expect(msgs({ lines: [line({ packPriceCents: 0 })] })).toEqual([]);
  });

  it('with today, a placed date after it is refused; without (a restore), it reads', () => {
    expect(orderProblems(input({ placedOn: '2026-10-30' }), '2026-10-29').map((p) => p.message)).toEqual(['The placed date can’t be after today.']);
    expect(orderProblems(input({ placedOn: '2026-10-29' }), '2026-10-29')).toEqual([]);
    expect(orderProblems(input({ placedOn: '2099-01-01' }))).toEqual([]);
  });

  it('amounts each valid but too large to add up exactly are refused', () => {
    expect(orderProblems(input({ lines: [line({ packs: 2 ** 26, packPriceCents: 2 ** 28 })] })).map((p) => p.message)).toEqual(['These amounts are too large to add up exactly.']);
    expect(orderProblems(input({ lines: [line({ packs: 1000, packSize: 100, packPriceCents: 9_999_999 })] }))).toEqual([]);
  });
});

describe('status and on order (§3, §4)', () => {
  it('placed → partly received → received; cancelled set by hand', () => {
    const o = order({ lines: [line({ packs: 2, packSize: 5 }), line({ itemId: '', packs: 1 })] });
    expect(orderStatus(o)).toBe('placed');
    expect(orderStatus({ ...o, lines: [{ ...o.lines[0]!, received: 3 }, o.lines[1]!] })).toBe('partly received');
    expect(orderStatus({ ...o, lines: [{ ...o.lines[0]!, received: 10 }, o.lines[1]!] })).toBe('partly received');
    expect(orderStatus({ ...o, lines: [{ ...o.lines[0]!, received: 10 }, { ...o.lines[1]!, received: 1 }] })).toBe('received');
    expect(orderStatus({ ...o, cancelled: true })).toBe('cancelled');
    expect(isOpen({ ...o, cancelled: true })).toBe(false);
  });

  it('counts what open orders still have due, item lines only', () => {
    const orders = [
      order({ id: 'p1', lines: [line({ itemId: 'a', packs: 2, packSize: 5, received: 3 }), line({ itemId: '', packs: 9 })] }),
      order({ id: 'p2', lines: [line({ itemId: 'a', packs: 1 }), line({ itemId: 'b', packs: 1, packSize: 25 })] }),
      order({ id: 'p3', cancelled: true, lines: [line({ itemId: 'a', packs: 100 })] }),
      order({ id: 'p4', lines: [line({ itemId: 'c', packs: 1, received: 1 })] }),
    ];
    expect(Object.fromEntries(onOrderMap(orders))).toEqual({ a: 8, b: 25 });
  });

  it('need subtracts units on order; stock highlighting doesn’t', () => {
    const a = tablet().items[0]!; // need 6 − 1 = 5
    expect(buildOrderList([a]).grandTotalCents).toBe(5000);
    expect(buildOrderList([a], new Map([['a', 2]])).groups[0]!.lines[0]!.orderQty).toBe(3);
    expect(buildOrderList([a], new Map([['a', 5]])).lineCount).toBe(0);
    expect(orderTotalCents([a], new Map([['a', 4]]))).toBe(1000);
    expect(stockStatus(a.onHand, a.desired, a.spares).kind).toBe('short');
    expect(passesFilters(a, { ...NO_FILTERS, needsOrder: true }, 5)).toBe(false);
    expect(passesFilters(a, { ...NO_FILTERS, needsOrder: true }, 4)).toBe(true);
    expect(orderLines(a, 5).sub).toBe('On hand + 5 on order covers desired + spares');
  });

  it('the quantity rules and the default subtract it too', () => {
    const a = tablet().items[0]!; // desired 4, spares 2, on hand 1
    expect([ruleQuantity(a, 'desired'), ruleQuantity(a, 'desired', 2), ruleQuantity(a, 'desired', 3)]).toEqual([3, 1, 0]);
    expect([ruleQuantity(a, 'spares', 2), ruleQuantity(a, 'pack', 99)]).toEqual([3, 1]);
    expect([defaultQuantity(a), defaultQuantity(a, 5)]).toEqual([5, 1]);
  });
});

describe('the order form’s lines (§21.1)', () => {
  it('come from one supplier group, with the list’s packs and the stored price', () => {
    const list = buildOrderList(tablet().items);
    const rev = list.groups.find((g) => g.supplier === 'REV')!;
    const lines = draftLines(rev);
    expect(lines.map((d) => [d.line.itemId, d.line.description, d.line.partNo, d.line.category, d.line.packs, d.line.packSize, d.line.packPriceCents, d.storedPriceCents])).toEqual([
      ['a', 'NEO', 'REV-21', 'Electrical', 5, 1, 1000, 1000],
      ['b', 'Bolt', 'REV-B', 'Fasteners', 2, 25, 500, 500],
    ]);
    const wcp = draftLines(list.groups.find((g) => g.supplier === 'WCP')!);
    expect(wcp.map((d) => [d.line.itemId, d.storedPriceCents])).toEqual([['c', null]]);
  });

  it('an added item uses its option for this supplier, else its preferred pack size and no price', () => {
    const [a, b] = tablet().items;
    expect(addedItemLine(b!, 'WCP')).toEqual({ line: itemLine(b!, 1, 10, 300, 'WCP-B'), storedPriceCents: 300 });
    expect(addedItemLine(a!, 'WCP')).toEqual({ line: itemLine(a!, 1, 1, 0, ''), storedPriceCents: null });
    expect(typedLine('  Team shirts ', 12, 1500)).toEqual({ itemId: '', description: 'Team shirts', partNo: '', unit: 'each', category: '', packs: 12, packSize: 1, packPriceCents: 1500, received: 0 });
  });

  it('a typed line keeps its own pack size and unit; a blank unit is "each" (M19 detail (c))', () => {
    const l = typedLine('Zip ties', 3, 799, 100, ' bag ');
    expect([l.packSize, l.unit, lineUnits(l), lineTotalCents(l), lineDue(l)]).toEqual([100, 'bag', 300, 2397, 300]);
    expect(typedLine('Cord', 2, 500, 50, '  ').unit).toBe('each');
    expect(orderProblems(input({ lines: [typedLine('Wire', 1, 100, 0, 'ft')] })).map((p) => p.field)).toEqual([{ line: 0, field: 'packSize' }]);
    expect(onOrderMap([order({ lines: [typedLine('Wire', 2, 100, 25, 'ft')] })]).size).toBe(0);
  });
});

describe('Mark ordered (F30)', () => {
  it('stores the order as placed, removes ordered lines from the named list, and adds to on order', async () => {
    const db = await setUp();
    const list = await createOrderList(db, 'Nov', '');
    for (const id of ['a', 'b', 'c']) await addToOrderList(db, list.id, id, 2);
    const items = await itemsOf(db);
    const r = await recordOrder(db, input({ lines: [itemLine(items.get('a')!, 2, 1, 1100, 'REV-21'), typedLine('Shirts', 3, 1500)], fromList: 'Nov', received: 0 } as Partial<OrderInput>), { listId: list.id }, 50);
    expect(r.order.id).toMatch(/^po-[2-9A-Z]{6}$/);
    expect([r.order.cancelled, r.order.created, r.order.receipts]).toEqual([false, 50, []]);
    expect(r.list).toEqual({ id: list.id, name: 'Nov', linesLeft: 2 });
    expect((await loadOrderLists(db))[0]!.lines.map((l) => l.itemId)).toEqual(['b', 'c']);
    expect(Object.fromEntries(await loadOnOrder(db))).toEqual({ a: 2 });
    expect((await itemsOf(db)).get('a')!.onHand).toBe(1);
  });

  it('a list left empty says so; the automatic list has no list; received always starts at 0', async () => {
    const db = await setUp();
    const list = await createOrderList(db, 'One', '');
    await addToOrderList(db, list.id, 'a', 1);
    const items = await itemsOf(db);
    const r = await recordOrder(db, input({ lines: [{ ...itemLine(items.get('a')!, 1, 1, 1000, ''), received: 1 }] }), { listId: list.id });
    expect(r.list!.linesLeft).toBe(0);
    expect(r.order.lines[0]!.received).toBe(0);
    const r2 = await recordOrder(db, input(), null);
    expect(r2.list).toBeNull();
  });

  it('bad input saves nothing', async () => {
    const db = await setUp();
    const list = await createOrderList(db, 'Nov', '');
    await addToOrderList(db, list.id, 'a', 2);
    await expect(recordOrder(db, input({ taxCents: -1 }), { listId: list.id })).rejects.toThrow('$0.00 or more');
    expect(await db.orders.count()).toBe(0);
    expect((await loadOrderLists(db))[0]!.lines.length).toBe(1);
  });
});

describe('copying prices into the catalog (§21.3)', () => {
  it('offers only changed lines, and sets price, pack size and price_checked to the placed date', async () => {
    const db = await setUp();
    const items = await itemsOf(db);
    const o = order({ supplier: 'wcp', placedOn: '2026-10-20', lines: [itemLine(items.get('b')!, 1, 10, 300, ''), itemLine(items.get('c')!, 1, 1, 899, ''), itemLine(items.get('a')!, 1, 1, 1, ''), typedLine('x', 1, 1)] });
    const pc = priceChanges(o, [...items.values()]);
    expect(pc.changed.map((c) => [c.itemId, c.slot, c.fromPriceCents, c.toPriceCents])).toEqual([['c', 1, null, 899]]);
    expect(pc.unchanged.map((c) => [c.itemId, c.slot])).toEqual([['b', 2]]);
    expect(await applyPriceChanges(db, 'WCP', pc.changed, pc.unchanged, '2026-10-20')).toBe(2);
    const after = await itemsOf(db);
    expect(after.get('c')!.vendors[0]).toMatchObject({ packPriceCents: 899, packSize: 1, priceChecked: '2026-10-20' });
    expect(after.get('b')!.vendors[1]).toMatchObject({ packPriceCents: 300, packSize: 10, priceChecked: '2026-10-20' });
    expect(after.get('b')!.vendors[0]).toEqual(items.get('b')!.vendors[0]);
    expect(after.get('a')).toEqual(items.get('a'));
  });

  it('an item on the order twice is offered once, by its first line', async () => {
    const items = new Map(tablet().items.map((i) => [i.id, i]));
    const pc = priceChanges(order({ lines: [itemLine(items.get('a')!, 1, 1, 1100, ''), itemLine(items.get('a')!, 1, 1, 1200, '')] }), [...items.values()]);
    expect(pc.changed.map((c) => [c.itemId, c.toPriceCents])).toEqual([['a', 1100]]);
    expect(pc.unchanged).toEqual([]);
  });

  it('a pack-size change is a change; nothing is written when skipped or when the item changed supplier since', async () => {
    const db = await setUp();
    const items = await itemsOf(db);
    const pc = priceChanges(order({ lines: [itemLine(items.get('b')!, 1, 50, 500, '')] }), [...items.values()]);
    expect(pc.changed.map((c) => [c.fromPackSize, c.toPackSize])).toEqual([[25, 50]]);
    await db.items.update('b', { vendors: [vendor({ supplier: 'AndyMark' }), null, null] });
    expect(await applyPriceChanges(db, 'REV', pc.changed, [], '2026-10-28')).toBe(0);
  });
});

describe('receiving (F31)', () => {
  async function placed(db: InventoryDb) {
    const items = await itemsOf(db);
    return (await recordOrder(db, input({ lines: [itemLine(items.get('b')!, 2, 25, 500, ''), itemLine(items.get('a')!, 3, 1, 1000, ''), typedLine('Shirts', 2, 1500)] }), null)).order;
  }

  it('adds exactly the received units to on hand; partial then full; last_counted untouched', async () => {
    const db = await setUp();
    await db.items.update('a', { lastCounted: '2026-10-01T10:00:00-05:00' });
    const o = await placed(db);
    const r1 = await receiveOrder(db, o.id, [25, 1, 0]);
    expect([r1.items, r1.units, orderStatus(r1.order)]).toEqual([2, 26, 'partly received']);
    let items = await itemsOf(db);
    expect([items.get('b')!.onHand, items.get('a')!.onHand, items.get('a')!.lastCounted]).toEqual([25, 2, '2026-10-01T10:00:00-05:00']);
    expect(Object.fromEntries(await loadOnOrder(db))).toEqual({ b: 25, a: 2 });
    const r2 = await receiveOrder(db, o.id, [25, 2, 2]);
    expect(orderStatus(r2.order)).toBe('received');
    items = await itemsOf(db);
    expect([items.get('b')!.onHand, items.get('a')!.onHand]).toEqual([50, 4]);
    expect(await loadOnOrder(db)).toEqual(new Map());
    await expect(receiveOrder(db, o.id, [0, 0, 0])).rejects.toThrow('Everything on this order has been received.');
  });

  it('typed lines and deleted items change no inventory', async () => {
    const db = await setUp();
    const o = await placed(db);
    await deleteItem(db, 'a');
    const before = await itemsOf(db);
    const r = await receiveOrder(db, o.id, [0, 3, 2]);
    expect([r.items, r.units, orderStatus(r.order)]).toEqual([0, 0, 'partly received']);
    expect(await itemsOf(db)).toEqual(before);
    expect(Object.fromEntries(await loadOnOrder(db))).toEqual({ b: 50 });
  });

  it('refuses more than is due, wrong lengths, nothing at all, and cancelled orders', async () => {
    const db = await setUp();
    const o = await placed(db);
    expect(receiveProblem(o, [51, 0, 0])).toBe('Line 1: receive 0 to 50.');
    expect(receiveProblem(o, [1, 0])).toBe('The order changed. Close this and try again.');
    expect(receiveProblem(o, [0, 0, 0])).toBe('Nothing to receive: every amount is 0.');
    expect(receiveProblem({ ...o, cancelled: true }, [1, 0, 0])).toBe('This order is cancelled.');
    await expect(receiveOrder(db, o.id, [-1, 0, 0])).rejects.toThrow('Line 1');
    expect((await itemsOf(db)).get('b')!.onHand).toBe(0);
  });
});

describe('edit, cancel, delete (§21.4)', () => {
  it('packs can’t go below received; received can be corrected without touching on hand', async () => {
    const db = await setUp();
    const items = await itemsOf(db);
    const o = (await recordOrder(db, input({ lines: [itemLine(items.get('a')!, 3, 1, 1000, '')] }), null)).order;
    await receiveOrder(db, o.id, [2]);
    const { id: _i, created: _c, updated: _u, receipts: _r, cancelled: _x, ...was } = (await getOrder(db, o.id))!;
    await expect(updateOrder(db, o.id, { ...was, lines: [{ ...was.lines[0]!, packs: 1 }] })).rejects.toThrow('Received can be 0 to 1.');
    const fixed = await updateOrder(db, o.id, { ...was, lines: [{ ...was.lines[0]!, received: 1 }], taxCents: 99 });
    expect([fixed.lines[0]!.received, fixed.taxCents, orderStatus(fixed)]).toEqual([1, 99, 'partly received']);
    expect((await itemsOf(db)).get('a')!.onHand).toBe(3);
  });

  it('cancel only with nothing received; cancelled orders leave on order; un-cancel puts it back', async () => {
    const db = await setUp();
    const items = await itemsOf(db);
    const o = (await recordOrder(db, input({ lines: [itemLine(items.get('a')!, 3, 1, 1000, '')] }), null)).order;
    await setCancelled(db, o.id, true);
    expect(await loadOnOrder(db)).toEqual(new Map());
    await setCancelled(db, o.id, false);
    expect(Object.fromEntries(await loadOnOrder(db))).toEqual({ a: 3 });
    await receiveOrder(db, o.id, [1]);
    await expect(setCancelled(db, o.id, true)).rejects.toThrow('can’t be cancelled');
  });

  it('delete removes the order and its receipts and leaves on hand alone', async () => {
    const db = await setUp();
    const items = await itemsOf(db);
    const o = (await recordOrder(db, input({ lines: [itemLine(items.get('a')!, 3, 1, 1000, '')] }), null)).order;
    await receiveOrder(db, o.id, [2]);
    await addReceipt(db, o.id, new Blob([new Uint8Array([1])]), 'image/jpeg');
    await deleteOrder(db, o.id);
    expect([await db.orders.count(), await db.receipts.count(), (await itemsOf(db)).get('a')!.onHand]).toEqual([0, 0, 3]);
  });

  it('a supplier rename follows into orders; a removal doesn’t; a category rename follows into lines', async () => {
    const db = await setUp();
    const items = await itemsOf(db);
    await recordOrder(db, input({ supplier: 'REV', lines: [itemLine(items.get('a')!, 1, 1, 1000, '')] }), null);
    await recordOrder(db, input({ supplier: 'WCP', lines: [itemLine(items.get('c')!, 1, 1, 1000, '')] }), null);
    await updateSupplier(db, 'REV', { name: 'REV Robotics', website: '', notes: '' });
    await renameCategory(db, 'Electrical', 'Electronics');
    await removeSupplier(db, 'WCP', 'other');
    const orders = await loadOrders(db);
    expect(orders.map((o) => o.supplier).sort()).toEqual(['REV Robotics', 'WCP']);
    expect(orders.find((o) => o.supplier === 'REV Robotics')!.lines[0]!.category).toBe('Electronics');
    expect(orders.find((o) => o.supplier === 'WCP')!.lines[0]!.category).toBe('Power Transfer');
  });

  it('a deleted item keeps its line; the delete confirmation can say what is on order', async () => {
    const db = await setUp();
    const items = await itemsOf(db);
    await recordOrder(db, input({ lines: [itemLine(items.get('a')!, 3, 1, 1000, ''), itemLine(items.get('a')!, 1, 1, 1000, '')] }), null);
    expect(await openOrdersWithItem(db, 'a')).toEqual({ orders: 1, units: 4 });
    await deleteItem(db, 'a');
    expect((await loadOrders(db))[0]!.lines.map((l) => l.description)).toEqual(['NEO', 'NEO']);
  });
});

describe('receipts (§21.2)', () => {
  it('up to five, numbered with the lowest free number', async () => {
    const db = await setUp();
    let o = (await recordOrder(db, input(), null)).order;
    for (let i = 0; i < 5; i++) o = await addReceipt(db, o.id, new Blob([new Uint8Array([i])]), i === 0 ? 'application/pdf' : 'image/jpeg');
    expect(o.receipts.map((r) => r.id.slice(o.id.length))).toEqual(['-1', '-2', '-3', '-4', '-5']);
    await expect(addReceipt(db, o.id, new Blob([]), 'image/jpeg')).rejects.toThrow('up to 5 receipts');
    o = await removeReceipt(db, o.id, `${o.id}-2`);
    expect(nextReceiptId(o)).toBe(`${o.id}-2`);
    expect(await db.receipts.count()).toBe(4);
  });
});

describe('orders in named lists and add-many (§4)', () => {
  it('add-many counts units on order', async () => {
    const db = await setUp();
    const items = await itemsOf(db);
    await recordOrder(db, input({ lines: [itemLine(items.get('a')!, 3, 1, 1000, '')] }), null);
    const r = await addManyToOrderList(db, { newName: 'X' }, ['a'], 'desired', false);
    expect(r.list.lines).toEqual([]);
    expect(r.skipped).toBe(1);
    const named = buildNamedOrder({ id: 'x', name: 'x', notes: '', created: 1, updated: 1, lines: [{ itemId: 'a', quantity: 2 }] }, [...items.values()]);
    expect(named.lineCount).toBe(1); // a named list is what was asked for: on order doesn't change it
  });
});

describe('orders.csv and order-lines.csv (§21.6)', () => {
  const tricky = order({
    id: 'po-AAAAAA',
    supplier: 'Shop, "Local"',
    orderNo: '=cmd',
    payment: 'PO 2408-17',
    notes: 'line 1\nline, "2"',
    taxCents: 412,
    shippingCents: 1095,
    feesCents: 0,
    discount: { kind: '%', value: 750 },
    receipts: [
      { id: 'po-AAAAAA-1', type: 'image/jpeg' },
      { id: 'po-AAAAAA-2', type: 'application/pdf' },
    ],
    created: Date.UTC(2026, 9, 28, 17),
    updated: Date.UTC(2026, 9, 28, 18),
    lines: [line({ itemId: 'a', description: 'NEO, "2.0"', partNo: 'REV-21', received: 1, packs: 2 }), line({ itemId: '', description: 'Shirts', category: '', packs: 12, packPriceCents: 1500 })],
  });

  it('round-trips every field', () => {
    const other = order({ id: 'po-BBBBBB', cancelled: true, placedOn: '2026-09-01', discount: { kind: '$', value: 250 } });
    const r = parseOrdersCsv(serializeOrdersCsv([other, tricky]), serializeOrderLinesCsv([other, tricky]));
    expect(r.problems).toEqual([]);
    expect(r.orders).toEqual(sortOrders([tricky, other]));
    expect([...r.receiptFiles]).toEqual([
      ['po-AAAAAA-1', 'receipts/po-AAAAAA-1.jpg'],
      ['po-AAAAAA-2', 'receipts/po-AAAAAA-2.pdf'],
    ]);
  });

  it('lines come back in their line-number order, even from a file sorted in a spreadsheet', () => {
    const three = order({ lines: [line({ description: 'one' }), line({ description: 'two' }), line({ description: 'three' })] });
    const [head, ...rows] = serializeOrderLinesCsv([three]).trim().split('\r\n');
    const r = parseOrdersCsv(serializeOrdersCsv([three]), [head, ...rows.reverse()].join('\r\n'));
    expect(r.orders[0]!.lines.map((l) => l.description)).toEqual(['one', 'two', 'three']);
    // A blank line number keeps the file order, after the numbered lines.
    const blank = [head, rows[2]!.replace(/^(po-[^,]+),1,/, '$1,,'), rows[0], rows[1]].join('\r\n');
    expect(blank).not.toContain(',1,one');
    expect(parseOrdersCsv(serializeOrdersCsv([three]), blank).orders[0]!.lines.map((l) => l.description)).toEqual(['two', 'three', 'one']);
  });

  it('an empty history writes both headers', () => {
    expect(serializeOrdersCsv([]).trim().split('\r\n')).toHaveLength(1);
    expect(parseOrdersCsv(serializeOrdersCsv([]), serializeOrderLinesCsv([]))).toEqual({ orders: [], receiptFiles: new Map(), problems: [] });
  });

  it('reports bad rows by file and row', () => {
    const orders = serializeOrdersCsv([tricky]).replace(',4.12,', ',4.125,');
    const lines = serializeOrderLinesCsv([tricky]) + 'po-ZZZ,1,,X,,each,,1,1,1.00,0\r\n';
    const r = parseOrdersCsv(orders, lines);
    expect(r.problems.map((p) => [p.file, p.row, p.message])).toEqual([
      ['orders.csv', 2, 'tax: price "4.125" has more than 2 decimal places'],
      ['order-lines.csv', 2, 'order po-AAAAAA isn\'t in orders.csv'],
      ['order-lines.csv', 3, 'order po-AAAAAA isn\'t in orders.csv'],
      ['order-lines.csv', 4, 'order po-ZZZ isn\'t in orders.csv'],
    ]);
  });

  it('a receipt named twice, or more than 5 on an order, is a row problem (review finding 6)', () => {
    const jpg = (id: string) => ({ id, type: 'image/jpeg' as const });
    const twice = order({ id: 'po-BBBBBB', placedOn: '2026-09-01', receipts: [jpg('po-AAAAAA-1')] });
    const six = order({ id: 'po-CCCCCC', placedOn: '2026-08-01', receipts: [1, 2, 3, 4, 5, 6].map((n) => jpg(`po-CCCCCC-${n}`)) });
    const r = parseOrdersCsv(serializeOrdersCsv([tricky, twice, six]), serializeOrderLinesCsv([tricky, twice, six]));
    expect(r.problems.map((p) => [p.file, p.row, p.message])).toEqual([
      ['orders.csv', 3, 'receipt "receipts/po-AAAAAA-1.jpg" is named twice (first on row 2)'],
      ['orders.csv', 4, 'an order can have at most 5 receipts (this one names 6)'],
      ['order-lines.csv', 4, 'order po-BBBBBB isn\'t in orders.csv'],
      ['order-lines.csv', 5, 'order po-CCCCCC isn\'t in orders.csv'],
    ]);
    expect(r.orders.map((o) => o.id)).toEqual(['po-AAAAAA']);
  });

  it('an order with 5 receipts reads back (the file isn’t taken for semicolon-separated)', () => {
    const five = order({ id: 'po-DDDDDD', receipts: [1, 2, 3, 4, 5].map((n) => ({ id: `po-DDDDDD-${n}`, type: 'image/jpeg' as const })) });
    const r = parseOrdersCsv(serializeOrdersCsv([five]), serializeOrderLinesCsv([five]));
    expect([r.problems, r.orders[0]?.receipts.length]).toEqual([[], 5]);
  });
});

describe('backups (§21.6)', () => {
  async function withOrders() {
    const db = await setUp();
    const items = await itemsOf(db);
    const o = (await recordOrder(db, input({ orderNo: 'INV-1', lines: [itemLine(items.get('a')!, 2, 1, 1100, 'REV-21'), typedLine('Shirts', 3, 1500)], taxCents: 50 }), null)).order;
    await receiveOrder(db, o.id, [1, 0]);
    await addReceipt(db, o.id, new Blob([new Uint8Array([0xff, 0xd8, 9])], { type: 'image/jpeg' }), 'image/jpeg');
    await addReceipt(db, o.id, new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46])], { type: 'application/pdf' }), 'application/pdf');
    return { db, id: o.id };
  }
  const zipBytes = async (b: Blob) => new Uint8Array(await b.arrayBuffer());
  const receiptBytes = async (db: InventoryDb) =>
    Object.fromEntries(await Promise.all((await db.receipts.toArray()).map(async (r) => [r.id, [r.blob.type, ...new Uint8Array(await r.blob.arrayBuffer())]] as const)));

  it('a full backup round-trips orders, lines, amounts, status and receipts', async () => {
    const { db } = await withOrders();
    const before = await loadOrders(db);
    const beforeReceipts = await receiptBytes(db);
    const bytes = await zipBytes(await buildBackup(db, 'full', new Date(2026, 9, 28, 12)));
    const z = await JSZip.loadAsync(bytes);
    expect(Object.keys(z.files).filter((n) => n.startsWith('receipts/')).sort()).toEqual(['receipts/', `receipts/${before[0]!.id}-1.jpg`, `receipts/${before[0]!.id}-2.pdf`]);

    const other = newDb();
    await replaceAll(other, tablet());
    await recordOrder(other, input(), null);
    const read = await readRestoreFile({ name: 'b.zip', bytes }, await loadSnapshot(other));
    if (!read.ok) throw new Error(JSON.stringify(read.problems));
    await applyRestore(other, read.plan);
    expect(await loadOrders(other)).toEqual(before);
    expect(await receiptBytes(other)).toEqual(beforeReceipts);
  });

  it('a receipt whose file is missing on the tablet isn’t named in the backup', async () => {
    const { db, id } = await withOrders();
    await db.receipts.delete(`${id}-2`);
    const z = await JSZip.loadAsync(await zipBytes(await buildBackup(db, 'full', new Date())));
    expect(await z.file('orders.csv')!.async('string')).toContain(`receipts/${id}-1.jpg,`);
    expect(await z.file('orders.csv')!.async('string')).not.toContain(`${id}-2`);
  });

  it('a backup with no orders still has both files, and restoring it clears the tablet’s orders', async () => {
    const empty = await setUp();
    const bytes = await zipBytes(await buildBackup(empty, 'full', new Date()));
    const z = await JSZip.loadAsync(bytes);
    expect(['orders.csv', 'order-lines.csv'].every((f) => z.file(f))).toBe(true);
    const { db } = await withOrders();
    const read = await readRestoreFile({ name: 'b.zip', bytes }, await loadSnapshot(db));
    if (!read.ok) throw new Error('expected a plan');
    expect(read.plan.orders).toEqual([]);
    await applyRestore(db, read.plan);
    expect([await db.orders.count(), await db.receipts.count()]).toEqual([0, 0]);
  });

  it('an older backup without orders.csv, and a CSV-only restore, keep the tablet’s orders', async () => {
    const { db } = await withOrders();
    const before = await loadOrders(db);
    const bytes = await zipBytes(await buildBackup(db, 'full', new Date()));
    const z = await JSZip.loadAsync(bytes);
    z.remove('orders.csv');
    z.remove('order-lines.csv');
    const older = await z.generateAsync({ type: 'uint8array' });
    const read = await readRestoreFile({ name: 'old.zip', bytes: older }, await loadSnapshot(db));
    if (!read.ok) throw new Error('expected a plan');
    expect(read.plan.orders).toBeNull();
    await applyRestore(db, read.plan);
    expect(await loadOrders(db)).toEqual(before);

    const csv = await zipBytes(await buildBackup(db, 'data', new Date()));
    const read2 = await readRestoreFile({ name: 'd.csv', bytes: csv }, await loadSnapshot(db));
    if (!read2.ok) throw new Error('expected a plan');
    await applyRestore(db, read2.plan);
    expect(await loadOrders(db)).toEqual(before);
    expect(await db.receipts.count()).toBe(2);
  });

  it('lines for items not in the backup survive as deleted-item lines; a missing receipt is reported and left off', async () => {
    const { db, id } = await withOrders();
    const z = await JSZip.loadAsync(await zipBytes(await buildBackup(db, 'full', new Date())));
    z.remove(`receipts/${id}-2.pdf`);
    const inv = (await z.file('inventory.csv')!.async('string')).split('\r\n').filter((l) => !l.startsWith('a,')).join('\r\n');
    z.file('inventory.csv', inv);
    const read = await readRestoreFile({ name: 'b.zip', bytes: await z.generateAsync({ type: 'uint8array' }) }, await loadSnapshot(db));
    if (!read.ok) throw new Error(JSON.stringify(read.problems));
    expect(read.plan.warnings.some((w) => w.includes(`receipts/${id}-2.pdf`))).toBe(true);
    await applyRestore(db, read.plan);
    const o = (await loadOrders(db))[0]!;
    expect(o.lines[0]!.description).toBe('NEO');
    expect(o.receipts.map((r) => r.id)).toEqual([`${id}-1`]);
    expect(await db.receipts.count()).toBe(1);
    expect(await loadOnOrder(db)).toEqual(new Map([['a', 1]]));
  });

  it('restoring at first launch brings the backup’s orders and order lists', async () => {
    const { db } = await withOrders();
    const list = await createOrderList(db, 'Kept', '');
    await addToOrderList(db, list.id, 'b', 5);
    const before = await loadOrders(db);
    const bytes = await zipBytes(await buildBackup(db, 'full', new Date()));
    const fresh = newDb();
    const read = await readRestoreFile({ name: 'b.zip', bytes }, await loadSnapshot(fresh));
    if (!read.ok) throw new Error('expected a plan');
    await startInventory(fresh, 'restore', read.plan);
    expect(await loadOrders(fresh)).toEqual(before);
    expect((await loadOrderLists(fresh)).map((l) => [l.name, l.lines])).toEqual([['Kept', [{ itemId: 'b', quantity: 5 }]]]);
    expect(await fresh.receipts.count()).toBe(2);
  });
});
