// Order history exports (F32, §21.5): Export CSV (the orders, then the summary by supplier and
// by category, each under a heading row) and Export lines CSV (one row per line). Both start
// with a row naming the range and filters, and use the F13 spreadsheet guard. A discount is
// written as a negative amount, so Parts + Discount + Tax + Shipping + Fees = Total across a row.
import { centsToPlain } from '../domain/money';
import { OTHER_CATEGORY, filtersText, rangeText, type DateRange, type HistoryFilters, type RangeKind, type SpendingSummary, type SupplierRow } from '../domain/order-history';
import { STATUS_LABEL, lineTotalCents, lineUnits, orderStatus, orderTotals, type PlacedOrder } from '../domain/placed-orders';
import { writeRows } from './csv';
import { guardCell } from './order-csv';

export const HISTORY_ORDER_COLUMNS = ['Placed', 'Supplier', 'Order #', 'Payment', 'Paid from', 'Status', 'Parts', 'Discount', 'Tax', 'Shipping', 'Fees', 'Total', 'Receipts', 'From list', 'Notes'] as const;

export const HISTORY_SUPPLIER_COLUMNS = ['Supplier', 'Orders', 'Parts', 'Discount', 'Tax', 'Shipping', 'Fees', 'Total'] as const;

export const HISTORY_CATEGORY_COLUMNS = ['Category', 'Amount'] as const;

export const HISTORY_FUNDING_COLUMNS = ['Paid from', 'Orders', 'Total'] as const;

export const HISTORY_LINE_COLUMNS = ['Placed', 'Supplier', 'Order #', 'Status', 'Item id', 'Item', 'Part #', 'Category', 'Unit', 'Packs', 'Pack size', 'Qty', 'Pack price', 'Line total', 'Received'] as const;

export const SUPPLIER_HEADING = 'Spending by supplier (cancelled orders left out)';
export const CATEGORY_HEADING = 'Spending by category (cancelled orders left out)';
export const FUNDING_HEADING = 'Spending by funding (cancelled orders left out)';

const money = centsToPlain;
const minus = (cents: number) => centsToPlain(-cents);

export interface HistoryExport {
  kind: RangeKind;
  range: DateRange;
  filters: HistoryFilters;
}

/** The file's first row: what it holds. */
export function historyNote(x: HistoryExport, what: string): string {
  return `${what}: ${rangeText(x.kind, x.range)} · ${filtersText(x.filters)}`;
}

function supplierRow(r: SupplierRow): string[] {
  return [guardCell(r.supplier), String(r.orders), money(r.partsCents), minus(r.discountCents), money(r.taxCents), money(r.shippingCents), money(r.feesCents), money(r.totalCents)];
}

/** The category summary's rows (§21.5): parts by category, then discount, tax, shipping, fees, Total. */
export function categoryRows(s: SpendingSummary): [string, number][] {
  const t = s.total;
  return [
    ...s.categories.map((c): [string, number] => [c.category, c.partsCents]),
    ['Discount', -t.discountCents],
    ['Tax', t.taxCents],
    ['Shipping', t.shippingCents],
    ['Fees', t.feesCents],
    ['Total', t.totalCents],
  ];
}

export function serializeHistoryCsv(x: HistoryExport, orders: readonly PlacedOrder[], summary: SpendingSummary): string {
  const rows: string[][] = [[guardCell(historyNote(x, 'Order history'))], [...HISTORY_ORDER_COLUMNS]];
  for (const o of orders) {
    const t = orderTotals(o);
    rows.push([
      o.placedOn,
      guardCell(o.supplier),
      guardCell(o.orderNo),
      guardCell(o.payment),
      guardCell(o.funding),
      STATUS_LABEL[orderStatus(o)],
      money(t.partsCents),
      minus(t.discountCents),
      money(t.taxCents),
      money(t.shippingCents),
      money(t.feesCents),
      money(t.totalCents),
      String(o.receipts.length),
      guardCell(o.fromList),
      guardCell(o.notes),
    ]);
  }
  rows.push([], [SUPPLIER_HEADING], [...HISTORY_SUPPLIER_COLUMNS], ...summary.suppliers.map(supplierRow), supplierRow(summary.total));
  rows.push([], [CATEGORY_HEADING], [...HISTORY_CATEGORY_COLUMNS], ...categoryRows(summary).map(([c, cents]) => [guardCell(c), money(cents)]));
  rows.push(
    [],
    [FUNDING_HEADING],
    [...HISTORY_FUNDING_COLUMNS],
    ...summary.funding.map((f) => [guardCell(f.funding), String(f.orders), money(f.totalCents)]),
    ['Total', String(summary.total.orders), money(summary.total.totalCents)],
  );
  return writeRows(rows);
}

export function serializeHistoryLinesCsv(x: HistoryExport, orders: readonly PlacedOrder[]): string {
  const rows: string[][] = [[guardCell(historyNote(x, 'Order lines'))], [...HISTORY_LINE_COLUMNS]];
  for (const o of orders) {
    const status = STATUS_LABEL[orderStatus(o)];
    for (const l of o.lines) {
      rows.push([
        o.placedOn,
        guardCell(o.supplier),
        guardCell(o.orderNo),
        status,
        guardCell(l.itemId),
        guardCell(l.description),
        guardCell(l.partNo),
        guardCell(l.itemId === '' || l.category.trim() === '' ? OTHER_CATEGORY : l.category),
        guardCell(l.unit),
        String(l.packs),
        String(l.packSize),
        String(lineUnits(l)),
        money(l.packPriceCents),
        money(lineTotalCents(l)),
        String(l.received),
      ]);
    }
  }
  return writeRows(rows);
}

/** order-history-2026-08-01-to-2026-10-29.csv; the lines file adds "-lines". */
export function historyFileName(r: DateRange, lines = false): string {
  return `order-history${lines ? '-lines' : ''}-${r.from}-to-${r.to}.csv`;
}
