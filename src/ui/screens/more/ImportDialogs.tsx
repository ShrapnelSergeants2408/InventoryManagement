// File-check results (mockups 8d, 8e): problems by row with nothing changed, the price-update
// preview (what will change, before the PIN) and the price-update summary.
import { isDetailChange, type PricePlan, type PriceProblem } from '../../../io/price-import';
import { Dialog, DialogActions } from '../../components/Dialog';
import { PinMark, plural } from '../../components/common';
import { Icon } from '../../icons';
import { href } from '../../shell/router';

const SHOWN = 30;

export function ProblemsDialog(props: { title: string; fileName: string; problems: PriceProblem[]; warnings: string[]; footer: string; onClose: () => void }) {
  const shown = props.problems.slice(0, SHOWN);
  return (
    <Dialog label={props.title} role="alertdialog" onClose={props.onClose}>
      <div class="dlg-head">
        <span class="bigic alert sm">
          <Icon name="short" />
        </span>
        <h2 class="h2 grow">{props.title}</h2>
      </div>
      <div class="mono small">{props.fileName}</div>
      <ul class="problems">
        {shown.map((p, i) => (
          <li key={i}>
            {p.row !== null && (
              <strong>
                Row {p.row}
                {p.id ? ` (${p.id})` : ''}:{' '}
              </strong>
            )}
            {p.row === null && p.file !== props.fileName && <strong>{p.file}: </strong>}
            {p.message}
          </li>
        ))}
      </ul>
      {props.problems.length > SHOWN && <p class="dlg-p small muted">… and {plural(props.problems.length - SHOWN, 'more problem')}.</p>}
      {props.warnings.map((w) => (
        <p class="dlg-p small muted" key={w}>
          {w}
        </p>
      ))}
      <p class="dlg-p">{props.footer}</p>
      <DialogActions>
        <button type="button" class="btn pri lg" data-autofocus onClick={props.onClose}>
          OK
        </button>
      </DialogActions>
    </Dialog>
  );
}

const PREVIEW_ITEMS = 40;

/**
 * Before the PIN: every vendor field the file would change, item by item. Anything other than a
 * price or price-checked date (or a new vendor option) is flagged, because an old data-only export
 * carries vendor details as they were then and would undo edits made since.
 */
export function PriceImportPreview({ plan, busy, onImport, onClose }: { plan: PricePlan; busy: boolean; onImport: () => void; onClose: () => void }) {
  const shownItems = plan.preview.slice(0, PREVIEW_ITEMS);
  const options = plan.optionsChanged + plan.optionsAdded;
  return (
    <Dialog label="Check the price update" onClose={() => !busy && onClose()}>
      <div class="dlg-head">
        <span class="dlg-ic navy">
          <Icon name="upload" />
        </span>
        <h2 class="h2 grow">Check the price update</h2>
      </div>
      <div class="mono small">
        {plan.fileName} · {plural(plan.rowCount, 'row')}
      </div>
      <p class="dlg-p">
        {plural(options, 'vendor option')} on {plural(plan.preview.length, 'item')} will change
        {plan.newSuppliers.length > 0 ? `, and ${plural(plan.newSuppliers.length, 'new supplier')} will be added (${plan.newSuppliers.join(', ')})` : ''}. Counts are never changed.
      </p>
      {plan.detailChanges > 0 && (
        <p class="dlg-p pv-warn" role="alert">
          <strong>
            {plural(plan.detailChanges, 'change')} besides prices and dates (marked !).
          </strong>{' '}
          If this file came from an older export, these may undo vendor edits or bring back deleted vendor options. Import only if they’re wanted.
        </p>
      )}
      <ul class="pv-list">
        {shownItems.map((it) => (
          <li key={it.id}>
            <div class="pv-item">
              <strong>{it.name}</strong> <span class="mono small muted">{it.id}</span>
            </div>
            {it.options.map((o) => (
              <div class="pv-opt" key={o.slot}>
                <div class={o.adds ? 'pv-flag' : 'small muted'}>
                  {o.adds ? '! ' : ''}Vendor option {o.slot}
                  {o.adds ? ' — new' : ''}
                </div>
                <ul>
                  {o.changes.map((c) => (
                    <li key={c.field} class={!o.adds && isDetailChange(c) ? 'pv-flag' : undefined}>
                      {!o.adds && isDetailChange(c) ? '! ' : ''}
                      {c.field}: {o.adds ? c.after : `${c.before} → ${c.after}`}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </li>
        ))}
      </ul>
      {plan.preview.length > PREVIEW_ITEMS && <p class="dlg-p small muted">… and {plural(plan.preview.length - PREVIEW_ITEMS, 'more item')}.</p>}
      <DialogActions>
        <button type="button" class="btn lg" data-autofocus disabled={busy} onClick={onClose}>
          Cancel
        </button>
        <button type="button" class="btn pri lg" disabled={busy} onClick={onImport}>
          Import changes
          <PinMark />
        </button>
      </DialogActions>
    </Dialog>
  );
}

export function PriceImportDone({ plan, onClose }: { plan: PricePlan; onClose: () => void }) {
  const nothing = plan.items.length === 0 && plan.newSuppliers.length === 0;
  const rows: [number, string][] = [
    [plan.optionsChanged, 'vendor options updated — price, pack size, link, price-checked date'],
    ...(plan.optionsAdded ? [[plan.optionsAdded, 'new vendor options added'] as [number, string]] : []),
    [plan.optionsUnchanged, 'vendor options already up to date'],
    [0, 'counts changed — imports never touch on hand, desired or spares'],
    [plan.notFound.length, `ids not found, skipped${plan.notFound.length ? `: ${plan.notFound.slice(0, 12).join(', ')}${plan.notFound.length > 12 ? ', …' : ''}` : ''}`],
    [plan.newSuppliers.length, `new supplier${plan.newSuppliers.length === 1 ? '' : 's'} added to the list${plan.newSuppliers.length ? `: ${plan.newSuppliers.join(', ')}` : ''}`],
  ];
  return (
    <Dialog label="Price update imported" onClose={onClose}>
      <div class="dlg-head">
        <span class="bigic sm done">
          <Icon name="check" />
        </span>
        <h2 class="h2 grow">{nothing ? 'Prices already up to date' : 'Price update imported'}</h2>
      </div>
      <div class="mono small">
        {plan.fileName} · {plural(plan.rowCount, 'row')}
      </div>
      <table class="sumt">
        <tbody>
          {rows.map(([n, t]) => (
            <tr key={t}>
              <td class="n">{n}</td>
              <td>{t}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {plan.ignoredColumns.length > 0 && <p class="dlg-p small muted">Ignored columns (not price fields): {plan.ignoredColumns.join(', ')}</p>}
      <DialogActions>
        <button
          type="button"
          class="btn lg"
          onClick={() => {
            onClose();
            location.hash = href.tab('order');
          }}
        >
          See the order list
        </button>
        <button type="button" class="btn pri lg" data-autofocus onClick={onClose}>
          Done
        </button>
      </DialogActions>
    </Dialog>
  );
}
