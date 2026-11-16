// Add items from a file (F33, SPEC §23.6): the preview before anything is added, the summary
// after, and Undo this import.
import { useState } from 'preact/hooks';
import type { AddResult, AddUndo, UndoAddResult } from '../../../data/add-items';
import type { AddPlan } from '../../../io/add-items';
import { Dialog, DialogActions } from '../../components/Dialog';
import { PinMark, plural } from '../../components/common';
import { Icon } from '../../icons';
import { href } from '../../shell/router';
import { showToast } from '../../shell/toast';

const SHOWN = 40;

/** A list that opens on tap, with its count in the heading (§23.6). */
function Section(props: { title: string; count: number; children: preact.ComponentChildren; open?: boolean }) {
  if (props.count === 0) return null;
  return (
    <details class="ai-sec" open={props.open}>
      <summary>
        <strong>{props.count}</strong> {props.title}
      </summary>
      {props.children}
    </details>
  );
}

function more(total: number, one: string) {
  return total > SHOWN ? <p class="small muted">… and {plural(total - SHOWN, one)}.</p> : null;
}

export function skippedText(plan: AddPlan): string {
  return plan.skipped.map((s) => `Row ${s.row}${s.name ? ` (${s.name})` : ''}: ${s.message}`).join('\n');
}

export function AddItemsPreview({ plan, busy, onAdd, onClose }: { plan: AddPlan; busy: boolean; onAdd: () => void; onClose: () => void }) {
  const n = plan.newItems.length;
  const lists = [
    ...plan.newCategories.map((c) => `category ${c.name}`),
    ...plan.newSubcategories.map((s) => `${s.category} › ${s.name}`),
    ...plan.newSuppliers.map((s) => `supplier ${s.name}`),
  ];
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(skippedText(plan));
      showToast('Skipped rows copied.');
    } catch {
      showToast('Couldn’t copy. Select the text instead.');
    }
  };
  return (
    <Dialog label={n === 0 ? 'Nothing to add' : 'Check the items to add'} onClose={() => !busy && onClose()}>
      <div class="dlg-head">
        <span class="dlg-ic navy">
          <Icon name="upload" />
        </span>
        <h2 class="h2 grow">{n === 0 ? 'Nothing to add' : 'Check the items to add'}</h2>
      </div>
      <div class="mono small">
        {plan.fileName} · {plural(plan.rowCount, 'row')}
      </div>
      <p class="dlg-p">
        {n === 0 ? (
          <>
            None of the rows can be added. {plan.present.length > 0 ? `${plural(plan.present.length, 'row')} ${plan.present.length === 1 ? 'is' : 'are'} already on this tablet. ` : ''}
            {plan.skipped.length > 0 ? `${plural(plan.skipped.length, 'row')} can’t be read.` : ''}
          </>
        ) : (
          <>
            <strong>{plural(n, 'new item')}</strong> will be added, each with on hand 0 and desired 0.
            {lists.length > 0 ? ` It also adds ${plural(lists.length, 'name')} to the lists.` : ''} Existing items, counts and settings are never changed.
          </>
        )}
      </p>
      <div class="ai-secs">
        <Section title={n === 1 ? 'new item' : 'new items'} count={n} open>
          <ul class="pv-list">
            {plan.newItems.slice(0, SHOWN).map((i) => (
              <li key={i.row}>
                <strong>{i.item.name}</strong>
                <div class="small muted">
                  {i.item.category}
                  {i.item.subcategory ? ` › ${i.item.subcategory}` : ''} · {i.item.vendors.flatMap((v) => (v ? [`${v.supplier}${v.partNo ? ` ${v.partNo}` : ''}`] : [])).join(', ')}
                </div>
              </li>
            ))}
          </ul>
          {more(n, 'more item')}
        </Section>
        <Section title={plan.present.length === 1 ? 'row already on this tablet (skipped)' : 'rows already on this tablet (skipped)'} count={plan.present.length}>
          <ul class="pv-list">
            {plan.present.slice(0, SHOWN).map((p) => (
              <li key={p.row}>
                <strong>{p.name}</strong>
                <div class="small muted">
                  Row {p.row}: {p.reason}
                </div>
              </li>
            ))}
          </ul>
          {more(plan.present.length, 'more row')}
        </Section>
        <Section title={plan.skipped.length === 1 ? 'row can’t be read (skipped)' : 'rows can’t be read (skipped)'} count={plan.skipped.length}>
          <ul class="pv-list">
            {plan.skipped.slice(0, SHOWN).map((s) => (
              <li key={s.row}>
                <strong>Row {s.row}</strong>
                {s.name ? ` (${s.name})` : ''}
                <div class="small muted">{s.message}</div>
              </li>
            ))}
          </ul>
          {more(plan.skipped.length, 'more row')}
          <button type="button" class="btn" onClick={() => void copy()}>
            Copy skipped rows
          </button>
        </Section>
        <Section title={lists.length === 1 ? 'name added to the lists' : 'names added to the lists'} count={lists.length}>
          <ul class="pv-list">
            {lists.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </Section>
      </div>
      {plan.missingPhotos > 0 && <p class="dlg-p small muted">{plural(plan.missingPhotos, 'photo')} named in the file {plan.missingPhotos === 1 ? 'isn’t' : 'aren’t'} in the ZIP; those items are added without one.</p>}
      {plan.barcodesCleared > 0 && <p class="dlg-p small muted">{plural(plan.barcodesCleared, 'barcode')} left off because another item already has the same code.</p>}
      {plan.ignoredColumns.length > 0 && <p class="dlg-p small muted">Not used by this import: {plan.ignoredColumns.join(', ')}</p>}
      {plan.warnings.map((w) => (
        <p class="dlg-p small muted" key={w}>
          {w}
        </p>
      ))}
      <DialogActions>
        <button type="button" class="btn lg" data-autofocus disabled={busy} onClick={onClose}>
          {n === 0 ? 'OK' : 'Cancel'}
        </button>
        {n > 0 && (
          <button type="button" class="btn pri lg" disabled={busy} onClick={onAdd}>
            Add {plural(n, 'item')}
            <PinMark />
          </button>
        )}
      </DialogActions>
    </Dialog>
  );
}

export function AddItemsDone({ fileName, result, onClose }: { fileName: string; result: AddResult; onClose: () => void }) {
  const rows: [number, string][] = [
    [result.added, 'items added, each with on hand 0 and desired 0'],
    ...(result.categories ? [[result.categories, 'categories added'] as [number, string]] : []),
    ...(result.subcategories ? [[result.subcategories, 'subcategories added'] as [number, string]] : []),
    ...(result.suppliers ? [[result.suppliers, 'suppliers added'] as [number, string]] : []),
    ...(result.photos ? [[result.photos, 'photos stored'] as [number, string]] : []),
    ...(result.skippedLate ? [[result.skippedLate, 'rows skipped: the tablet gained them since the check'] as [number, string]] : []),
    [0, 'existing items, counts or settings changed'],
  ];
  return (
    <Dialog label="Items added" onClose={onClose}>
      <div class="dlg-head">
        <span class="bigic sm done">
          <Icon name="check" />
        </span>
        <h2 class="h2 grow">{result.added === 0 ? 'Nothing was added' : 'Items added'}</h2>
      </div>
      <div class="mono small">{fileName}</div>
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
      <p class="dlg-p small muted">The new items show as “not counted”. Undo this import is on this screen until the next add or a restore.</p>
      <DialogActions>
        <button
          type="button"
          class="btn lg"
          onClick={() => {
            onClose();
            location.hash = href.tab('inventory');
          }}
        >
          See the inventory
        </button>
        <button type="button" class="btn pri lg" data-autofocus onClick={onClose}>
          Done
        </button>
      </DialogActions>
    </Dialog>
  );
}

/** Asks first; after the PIN and the undo it shows what was removed and what was kept (§23.4). */
export function AddItemsUndoDialog({ undo, onUndo, onClose }: { undo: AddUndo; onUndo: () => Promise<UndoAddResult | null>; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<UndoAddResult | null>(null);
  if (result) {
    return (
      <Dialog label="Import undone" onClose={onClose}>
        <div class="dlg-head">
          <span class="bigic sm done">
            <Icon name="check" />
          </span>
          <h2 class="h2 grow">Import undone</h2>
        </div>
        <p class="dlg-p">{plural(result.removed, 'item')} removed.</p>
        {result.kept.length > 0 && (
          <p class="dlg-p pv-warn" role="alert">
            <strong>{plural(result.kept.length, 'item')} kept</strong>, because {result.kept.length === 1 ? 'it has' : 'they have'} been counted, edited or ordered since: {result.kept.slice(0, 12).join(', ')}
            {result.kept.length > 12 ? ', …' : ''}.
          </p>
        )}
        <DialogActions>
          <button type="button" class="btn pri lg" data-autofocus onClick={onClose}>
            Done
          </button>
        </DialogActions>
      </Dialog>
    );
  }
  return (
    <Dialog label="Undo this import?" role="alertdialog" onClose={() => !busy && onClose()}>
      <div class="dlg-head">
        <span class="bigic alert sm">
          <Icon name="retry" />
        </span>
        <h2 class="h2 grow">Undo this import?</h2>
      </div>
      <p class="dlg-p">
        This removes the {plural(undo.items.length, 'item')} added from <span class="mono">{undo.fileName}</span>
        {undo.categories.length + undo.subcategories.length + undo.suppliers.length > 0 ? ' and the category and supplier names it created, unless something still uses them' : ''}. An item that has been counted, edited or ordered since is kept.
      </p>
      <DialogActions>
        <button type="button" class="btn lg" data-autofocus disabled={busy} onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          class="btn danger lg"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const r = await onUndo();
              if (r) setResult(r);
            } finally {
              setBusy(false);
            }
          }}
        >
          Undo this import
          <PinMark />
        </button>
      </DialogActions>
    </Dialog>
  );
}
