// File-check results (mockups 8d, 8e): problems by row with nothing changed, and the
// price-update summary.
import type { PricePlan, PriceProblem } from '../../../io/price-import';
import { Dialog, DialogActions } from '../../components/Dialog';
import { plural } from '../../components/common';
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
