// The count report for one import (§18.5, v0.20): one row per item the import changed, with the
// spot-check flags. Starts with a row saying what it is, and uses the F13 spreadsheet guard.
import { FLAG_LABEL, type ReportRow } from '../domain/import-report';
import type { Item } from '../domain/types';
import { writeRows } from './csv';
import { guardCell } from './order-csv';

export const REPORT_COLUMNS = ['Item id', 'Item', 'Category', 'Location', 'Before', 'After', 'Change', 'Counted by', 'Counted at', 'Spot-check'] as const;

export function serializeImportReport(rows: readonly ReportRow[], items: readonly Pick<Item, 'id' | 'name' | 'category'>[], note: string): string {
  const byId = new Map(items.map((i) => [i.id, i]));
  const data = rows.map((r) => {
    const item = byId.get(r.itemId);
    const change = r.after.onHand - r.before.onHand;
    return [
      r.itemId,
      guardCell(item?.name ?? '(deleted item)'),
      guardCell(item?.category ?? ''),
      guardCell(r.after.location),
      String(r.before.onHand),
      String(r.after.onHand),
      change > 0 ? `+${change}` : String(change),
      guardCell(r.after.countedBy),
      r.after.lastCounted,
      r.flags.map((f) => FLAG_LABEL[f]).join('; '),
    ];
  });
  return writeRows([[guardCell(note)], [...REPORT_COLUMNS], ...data]);
}

/** count-report-2026-11-12-1430.csv (local time). */
export function importReportFileName(at: number): string {
  const d = new Date(at);
  const p = (n: number) => String(n).padStart(2, '0');
  return `count-report-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.csv`;
}
