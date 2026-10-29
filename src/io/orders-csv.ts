// orders.csv and order-lines.csv in full backups (SPEC §21.6): one row per placed order, and one
// row per order line. Money in dollars with two decimals. Read back by restore, so every field
// is checked and a problem names the file and row.
import { centsToPlain, parsePrice } from '../domain/money';
import { orderProblems, parsePercent, percentText, sortOrders, type DiscountKind, type PlacedLine, type PlacedOrder, type ReceiptRef } from '../domain/placed-orders';
import { parseWholeNumber } from '../domain/validate';
import { cellGetter, readCsv, writeCsv, type FileProblem } from './csv';

export const ORDERS_FILE = 'orders.csv';
export const ORDER_LINES_FILE = 'order-lines.csv';
export const RECEIPTS_DIR = 'receipts/';

export const ORDER_COLUMNS = [
  'order_id',
  'supplier',
  'placed_on',
  'order_no',
  'payment',
  'cancelled',
  'tax',
  'shipping',
  'fees',
  'discount_kind',
  'discount',
  'notes',
  'from_list',
  'receipts',
  'created',
  'updated',
] as const;
export const ORDER_LINE_COLUMNS = ['order_id', 'line', 'item_id', 'description', 'part_no', 'unit', 'category', 'packs', 'pack_size', 'pack_price', 'received'] as const;

/** receipts/po-ABC234-1.jpg or .pdf */
export function receiptPath(r: ReceiptRef): string {
  return `${RECEIPTS_DIR}${r.id}.${r.type === 'application/pdf' ? 'pdf' : 'jpg'}`;
}

export function serializeOrdersCsv(orders: readonly PlacedOrder[]): string {
  return writeCsv(
    ORDER_COLUMNS,
    sortOrders(orders).map((o) => [
      o.id,
      o.supplier,
      o.placedOn,
      o.orderNo,
      o.payment,
      o.cancelled ? 'yes' : '',
      centsToPlain(o.taxCents),
      centsToPlain(o.shippingCents),
      centsToPlain(o.feesCents),
      o.discount.kind,
      o.discount.kind === '$' ? centsToPlain(o.discount.value) : percentText(o.discount.value),
      o.notes,
      o.fromList,
      o.receipts.map(receiptPath).join(';'),
      new Date(o.created).toISOString(),
      new Date(o.updated).toISOString(),
    ]),
  );
}

export function serializeOrderLinesCsv(orders: readonly PlacedOrder[]): string {
  const rows: string[][] = [];
  for (const o of sortOrders(orders)) {
    o.lines.forEach((l, i) =>
      rows.push([o.id, String(i + 1), l.itemId, l.description, l.partNo, l.unit, l.category, String(l.packs), String(l.packSize), centsToPlain(l.packPriceCents), String(l.received)]),
    );
  }
  return writeCsv(ORDER_LINE_COLUMNS, rows);
}

export interface ParsedOrders {
  orders: PlacedOrder[];
  /** Receipt id → its path in the ZIP. */
  receiptFiles: Map<string, string>;
  problems: FileProblem[];
}

const missingColumns = (have: Map<string, number>, want: readonly string[]) => want.filter((c) => !have.has(c));

function money(raw: string, field: string): { ok: true; cents: number } | { ok: false; error: string } {
  if (raw.trim() === '') return { ok: true, cents: 0 };
  const p = parsePrice(raw);
  if (!p.ok) return { ok: false, error: `${field}: ${p.error}` };
  return { ok: true, cents: p.cents ?? 0 };
}

function time(raw: string): number | null {
  if (raw.trim() === '') return null;
  const t = Date.parse(raw.trim());
  return Number.isNaN(t) ? null : t;
}

/**
 * Both files together (lines need their order). `now` stands in for missing created/updated
 * times. A line naming an order that isn't in orders.csv, and an order with no lines, are problems.
 */
export function parseOrdersCsv(ordersText: string, linesText: string, now = Date.now()): ParsedOrders {
  const problems: FileProblem[] = [];
  const receiptFiles = new Map<string, string>();
  const ot = readCsv(ordersText, ORDERS_FILE);
  const lt = readCsv(linesText, ORDER_LINES_FILE);
  problems.push(...ot.problems, ...lt.problems);
  const oMissing = missingColumns(ot.columns, ['order_id', 'supplier', 'placed_on']);
  const lMissing = missingColumns(lt.columns, ['order_id', 'description', 'packs', 'pack_size', 'pack_price']);
  if (oMissing.length) problems.push({ file: ORDERS_FILE, row: 1, message: `missing column${oMissing.length > 1 ? 's' : ''}: ${oMissing.join(', ')}` });
  if (lMissing.length) problems.push({ file: ORDER_LINES_FILE, row: 1, message: `missing column${lMissing.length > 1 ? 's' : ''}: ${lMissing.join(', ')}` });
  if (oMissing.length || lMissing.length) return { orders: [], receiptFiles, problems };

  const byId = new Map<string, { order: PlacedOrder; row: number }>();
  const lineNo = new Map<PlacedLine, number>();
  for (const { row, cells } of ot.rows) {
    const get = cellGetter(ot, cells);
    const file = ORDERS_FILE;
    const id = get('order_id').trim();
    if (id === '') {
      problems.push({ file, row, message: 'order_id is required' });
      continue;
    }
    if (byId.has(id)) {
      problems.push({ file, row, message: `order ${id} appears twice (first on row ${byId.get(id)!.row})` });
      continue;
    }
    const amounts: Record<'tax' | 'shipping' | 'fees', number> = { tax: 0, shipping: 0, fees: 0 };
    let bad = false;
    for (const f of ['tax', 'shipping', 'fees'] as const) {
      const m = money(get(f), f);
      if (m.ok) amounts[f] = m.cents;
      else {
        problems.push({ file, row, message: m.error });
        bad = true;
      }
    }
    const kind = (get('discount_kind').trim() || '$') as DiscountKind;
    let discountValue = 0;
    if (kind === '%') {
      const p = get('discount').trim() === '' ? 0 : parsePercent(get('discount'));
      if (p === null) {
        problems.push({ file, row, message: `discount "${get('discount').trim()}" is not a percent` });
        bad = true;
      } else discountValue = p;
    } else if (kind === '$') {
      const m = money(get('discount'), 'discount');
      if (m.ok) discountValue = m.cents;
      else {
        problems.push({ file, row, message: m.error });
        bad = true;
      }
    } else {
      problems.push({ file, row, message: `discount_kind "${kind}" must be $ or %` });
      bad = true;
    }
    const cancelled = get('cancelled').trim().toLowerCase();
    if (!['', 'yes', 'no', 'true', 'false'].includes(cancelled)) {
      problems.push({ file, row, message: `cancelled "${get('cancelled').trim()}" must be yes or blank` });
      bad = true;
    }
    const receipts: ReceiptRef[] = [];
    for (const path of get('receipts').split(';').map((s) => s.trim()).filter(Boolean)) {
      const m = /^receipts\/(.+)\.(jpg|jpeg|pdf)$/i.exec(path);
      if (!m) {
        problems.push({ file, row, message: `receipt "${path}" must be receipts/<name>.jpg or .pdf` });
        bad = true;
        continue;
      }
      const r: ReceiptRef = { id: m[1]!, type: m[2]!.toLowerCase() === 'pdf' ? 'application/pdf' : 'image/jpeg' };
      receipts.push(r);
      receiptFiles.set(r.id, path);
    }
    if (bad) continue;
    const created = time(get('created')) ?? now;
    byId.set(id, {
      row,
      order: {
        id,
        supplier: get('supplier').trim(),
        placedOn: get('placed_on').trim(),
        orderNo: get('order_no').trim(),
        payment: get('payment').trim(),
        cancelled: cancelled === 'yes' || cancelled === 'true',
        taxCents: amounts.tax,
        shippingCents: amounts.shipping,
        feesCents: amounts.fees,
        discount: { kind, value: discountValue },
        notes: get('notes').trim(),
        fromList: get('from_list').trim(),
        receipts,
        created,
        updated: time(get('updated')) ?? created,
        lines: [],
      },
    });
  }

  for (const { row, cells } of lt.rows) {
    const get = cellGetter(lt, cells);
    const file = ORDER_LINES_FILE;
    const id = get('order_id').trim();
    const entry = byId.get(id);
    if (!entry) {
      problems.push({ file, row, message: `order ${id || '(blank)'} isn't in ${ORDERS_FILE}` });
      continue;
    }
    const packs = parseWholeNumber(get('packs'), 'packs', 1);
    const size = parseWholeNumber(get('pack_size'), 'pack_size', 1);
    const received = get('received').trim() === '' ? ({ ok: true, value: 0 } as const) : parseWholeNumber(get('received'), 'received', 0);
    const price = parsePrice(get('pack_price'));
    const errs = [packs, size, received].flatMap((p) => (p.ok ? [] : [p.error]));
    if (!price.ok) errs.push(price.error);
    else if (price.cents === null) errs.push('pack_price is required');
    if (errs.length) {
      for (const message of errs) problems.push({ file, row, message });
      continue;
    }
    const line: PlacedLine = {
      itemId: get('item_id').trim(),
      description: get('description').trim(),
      partNo: get('part_no').trim(),
      unit: get('unit').trim() || 'each',
      category: get('category').trim(),
      packs: (packs as { value: number }).value,
      packSize: (size as { value: number }).value,
      packPriceCents: (price as { cents: number }).cents,
      received: (received as { value: number }).value,
    };
    entry.order.lines.push(line);
    const n = get('line').trim();
    lineNo.set(line, /^\d+$/.test(n) ? Number(n) : Infinity);
  }
  // Lines go back in their `line` order, so a file sorted in a spreadsheet keeps them; a blank
  // or unreadable number keeps the file order (the sort is stable).
  const by = (a: PlacedLine, b: PlacedLine) => {
    const x = lineNo.get(a)!;
    const y = lineNo.get(b)!;
    return x === y ? 0 : x < y ? -1 : 1;
  };
  for (const { order } of byId.values()) order.lines.sort(by);

  const orders: PlacedOrder[] = [];
  for (const { order, row } of byId.values()) {
    if (order.lines.length === 0) {
      problems.push({ file: ORDERS_FILE, row, message: `order ${order.id} has no lines in ${ORDER_LINES_FILE}` });
      continue;
    }
    const found = orderProblems(order);
    if (order.cancelled && order.lines.some((l) => l.received > 0)) found.push({ field: 'lines', message: 'a cancelled order has received parts' });
    if (found.length) {
      for (const p of found) problems.push({ file: ORDERS_FILE, row, message: `order ${order.id}: ${p.message.replace(/\.$/, '')}` });
      continue;
    }
    orders.push(order);
  }
  return { orders, receiptFiles, problems };
}
