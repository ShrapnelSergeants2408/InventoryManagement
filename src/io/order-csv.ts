// Order list CSV (F13, spec-questions D4): one row per line, a subtotal row after each
// supplier, the grand total at the end, then "n items without prices" when there are any.
import { centsToPlain } from '../domain/money';
import type { OrderList } from '../domain/order';
import { writeCsv } from './csv';

export const ORDER_COLUMNS = [
  'Supplier',
  'Part #',
  'Item',
  'Unit',
  'Need',
  'Pack size',
  'Packs',
  'Order qty',
  'Pack price',
  'Line total',
  'Price checked',
  'URL',
  'Notes',
] as const;

/** Pack price of a line whose preferred vendor has no price (D4). */
export const NO_PRICE = 'NO PRICE';

const LINE_TOTAL = ORDER_COLUMNS.indexOf('Line total');

/**
 * This file is opened in Excel or Google Sheets, not read back by the app, so text that a
 * spreadsheet would run as a formula (=, +, @, or - before a letter) gets a leading
 * apostrophe and shows as typed. Plain numbers and part numbers like "-20" are untouched.
 */
export function guardCell(s: string): string {
  return /^[=+@\t\r]/.test(s) || /^-[^\d.\s]/.test(s) ? `'${s}` : s;
}

function totalRow(label: string, cents: number): string[] {
  const row: string[] = ORDER_COLUMNS.map(() => '');
  row[0] = label;
  row[LINE_TOTAL] = centsToPlain(cents);
  return row;
}

export function orderCsvRows(list: OrderList): string[][] {
  const rows: string[][] = [];
  for (const g of list.groups) {
    for (const l of g.lines) {
      const v = l.vendor;
      rows.push([
        guardCell(g.supplier),
        guardCell(v.partNo),
        guardCell(l.item.name),
        guardCell(l.item.unit),
        String(l.need),
        String(v.packSize),
        String(l.packs),
        String(l.orderQty),
        v.packPriceCents === null ? NO_PRICE : centsToPlain(v.packPriceCents),
        l.lineTotalCents === null ? '' : centsToPlain(l.lineTotalCents),
        v.priceChecked,
        guardCell(v.url),
        guardCell(l.item.notes),
      ]);
    }
    rows.push(totalRow(`${guardCell(g.supplier)} subtotal`, g.subtotalCents));
  }
  rows.push(totalRow('Grand total', list.grandTotalCents));
  if (list.noPriceCount > 0) {
    const row: string[] = ORDER_COLUMNS.map(() => '');
    row[0] = list.noPriceCount === 1 ? '1 item without a price' : `${list.noPriceCount} items without prices`;
    rows.push(row);
  }
  return rows;
}

export function serializeOrderCsv(list: OrderList): string {
  return writeCsv(ORDER_COLUMNS, orderCsvRows(list));
}

/** order-list-2026-10-17-1235.csv (local time). */
export function orderCsvFileName(now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `order-list-${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}.csv`;
}
