// Export order list (F13, mockup 4c): file name, a preview of the first supplier group and the
// totals, then the share sheet — or a download when the browser can't share the file (Q1).
// With a search (Export shown lines only, F12): just those lines, a note row first and
// "filtered" in the file name. A named list (F27): its name in the file name and the first row.
import { useState } from 'preact/hooks';
import type { OrderList } from '../../../domain/order';
import type { NamedOrderList } from '../../../domain/order-lists';
import { ORDER_COLUMNS, filteredNote, listNote, orderCsvFileName, orderCsvRows, serializeOrderCsv } from '../../../io/order-csv';
import { shareOrDownload } from '../../../io/share';
import { Dialog, DialogActions } from '../../components/Dialog';
import { plural } from '../../components/common';
import { Icon } from '../../icons';
import { showToast } from '../../shell/toast';

const PREVIEW_COLUMNS = ['Supplier', 'Part #', 'Item', 'Order qty', 'Line total'] as const;
const RIGHT = new Set<string>(['Order qty', 'Line total']);
const PREVIEW_LINES = 6;

export function ExportDialog(props: { list: OrderList; whole?: OrderList; query?: string; named?: NamedOrderList; onClose: () => void }) {
  const { list, whole, query, named, onClose } = props;
  const [now] = useState(() => new Date());
  const [busy, setBusy] = useState(false);
  const filtered = whole !== undefined && query !== undefined;
  const notes = [named ? listNote(named.name, named.notes) : null, filtered ? filteredNote(query, list, whole) : null].filter((n): n is string => n !== null);
  const note = notes.length > 0 ? notes.join(' · ') : undefined;
  const name = orderCsvFileName(now, filtered ? query : undefined, named?.name);
  const rows = orderCsvRows(list);
  const idx = PREVIEW_COLUMNS.map((c) => ORDER_COLUMNS.indexOf(c));
  const first = list.groups[0];
  const firstRows = first ? rows.slice(0, first.lines.length + 1) : [];
  const shownLines = firstRows.slice(0, Math.min(PREVIEW_LINES, first?.lines.length ?? 0));
  const tail = rows.slice(rows.findIndex((r) => r[0] === 'Grand total'));

  const go = async () => {
    setBusy(true);
    try {
      const file = new File([serializeOrderCsv(list, note)], name, { type: 'text/csv' });
      const r = await shareOrDownload(file, 'Order list');
      if (r === 'cancelled') {
        setBusy(false);
        return;
      }
      showToast(r === 'shared' ? `Shared ${name}.` : `Saved ${name} to Downloads.`);
      onClose();
    } catch (e) {
      setBusy(false);
      showToast(`Couldn't export: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const cells = (r: string[]) => idx.map((i) => r[i] ?? '');
  return (
    <Dialog label="Export order list" onClose={() => !busy && onClose()}>
      <div class="dlg-head">
        <h2 class="h2 grow">{filtered ? 'Export shown lines only (CSV)' : named ? 'Export this list (CSV)' : 'Export order list (CSV)'}</h2>
        <button type="button" class="ib" aria-label="Close" onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>
      <div>
        <strong class="mono">{name}</strong>
        <div class="small muted">
          {plural(list.lineCount, 'line')} · {plural(list.groups.length, 'supplier group')}, each followed by a subtotal row · grand total row at the end · opens in Excel or
          Google Sheets
        </div>
        {note && <div class="xnote">First row: {note}</div>}
      </div>
      <div class="csv">
        <table>
          <thead>
            <tr>
              {PREVIEW_COLUMNS.map((h) => (
                <th key={h} class={RIGHT.has(h) ? 'r' : undefined}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shownLines.map((r, i) => (
              <tr key={i}>
                {cells(r).map((c, j) => (
                  <td key={j} class={RIGHT.has(PREVIEW_COLUMNS[j]!) ? 'r' : undefined}>
                    {c}
                  </td>
                ))}
              </tr>
            ))}
            {first && first.lines.length > PREVIEW_LINES && (
              <tr class="more">
                <td colSpan={PREVIEW_COLUMNS.length}>
                  … {first.lines.length - PREVIEW_LINES} more {first.supplier} rows
                </td>
              </tr>
            )}
            {firstRows.length > 0 && (
              <tr class="tot">
                {cells(firstRows[firstRows.length - 1]!).map((c, j) => (
                  <td key={j} class={RIGHT.has(PREVIEW_COLUMNS[j]!) ? 'r' : undefined}>
                    {c}
                  </td>
                ))}
              </tr>
            )}
            {list.groups.length > 1 && (
              <tr class="more">
                <td colSpan={PREVIEW_COLUMNS.length}>… {plural(list.groups.length - 1, 'more supplier group')}, each with its subtotal row</td>
              </tr>
            )}
            {tail.map((r, i) => (
              <tr key={`t${i}`} class="tot">
                {cells(r).map((c, j) => (
                  <td key={j} class={RIGHT.has(PREVIEW_COLUMNS[j]!) ? 'r' : undefined}>
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p class="dlg-p small muted">
        The file has all 13 columns (Supplier, Part #, Item, Unit, Need, Pack size, Packs, Order qty, Pack price, Line total, Price checked, URL, Notes). Items without a
        price show NO PRICE, a blank line total, and are left out of the subtotals.
      </p>
      <DialogActions>
        <button type="button" class="btn lg" disabled={busy} onClick={onClose}>
          Cancel
        </button>
        <button type="button" class="btn pri lg" data-autofocus disabled={busy} onClick={() => void go()}>
          <Icon name="upload" />
          Share CSV…
        </button>
      </DialogActions>
    </Dialog>
  );
}
