// Order list CSV (F13, spec-questions D4): one row per line, a subtotal row after each
// supplier, the grand total at the end, then "n items without prices" when there are any.
import { centsToPlain } from '../domain/money';
import type { OrderList } from '../domain/order';
import { normalize } from '../domain/search';
import { BOM, writeCsv } from './csv';

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

/**
 * The CSV file. `note` (Export shown lines only, F12) goes in the file's first row, before the
 * column headers, so whoever opens the file sees it isn't the whole order.
 */
export function serializeOrderCsv(list: OrderList, note?: string): string {
  const body = writeCsv(ORDER_COLUMNS, orderCsvRows(list));
  if (note === undefined) return body;
  // A one-cell row, quoted like any other; writeCsv with no data rows ends in a blank line,
  // which is dropped. Both parts start with the byte-order mark; the file keeps only the first.
  const noteRow = writeCsv([guardCell(note)], []).replace(/(\r\n)+$/, '\r\n');
  return noteRow + body.slice(BOM.length);
}

/** First-row note for Export shown lines only (F12). */
export function filteredNote(query: string, shown: OrderList, all: OrderList): string {
  return `Filtered order list: only the ${shown.lineCount} of ${all.lineCount} lines matching "${query.trim()}". Shown total ${centsToPlain(shown.grandTotalCents)}; whole list ${centsToPlain(all.grandTotalCents)}.`;
}

/** Text reduced to letters, digits and dashes, at most 30 characters, for a file name. */
function slug(text: string): string {
  return normalize(text)
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 30)
    .replace(/^-+|-+$/g, '');
}

/**
 * order-list-2026-10-17-1235.csv (local time). With a search (Export shown lines only, F12):
 * order-list-filtered-neo-2-0-2026-10-17-1235.csv. A named list (F27) puts its name first:
 * order-list-wcp-order-nov-2026-10-17-1235.csv, or …-wcp-order-nov-filtered-neo-….
 */
export function orderCsvFileName(now: Date, query?: string, listName?: string): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}`;
  const named = listName === undefined ? '' : slug(listName);
  const parts = ['order-list', named];
  if (query !== undefined) parts.push('filtered', slug(query));
  return `${parts.filter(Boolean).join('-')}-${stamp}.csv`;
}

/** First-row note for a named list's export (F27). */
export function listNote(name: string, notes: string): string {
  const n = notes.trim().replace(/\s+/g, ' ');
  return `Order list: ${name.trim()}${n ? ` (${n})` : ''}`;
}
