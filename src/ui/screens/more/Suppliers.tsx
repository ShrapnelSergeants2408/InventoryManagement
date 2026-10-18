// Suppliers (F23, mockups 7a–7c): add, rename, remove — each needs the mentor PIN.
// Listed A–Z with `other` last, with how many vendor options use each.
import { useState } from 'preact/hooks';
import { addSupplier, removeSupplier, updateSupplier } from '../../../data/lists';
import { isOtherSupplier, sortSupplierNames, supplierUsage } from '../../../domain/lists';
import { OTHER_SUPPLIER, nameKey, type Supplier } from '../../../domain/types';
import { safeHref } from '../../../domain/url';
import { gate } from '../../../security/gate';
import { BackButton, PinMark, StateMessage, TopBar, plural } from '../../components/common';
import { Dialog, DialogActions } from '../../components/Dialog';
import { useDb, useSnapshot } from '../../data-hooks';
import { Icon } from '../../icons';
import { href } from '../../shell/router';
import { showToast } from '../../shell/toast';
import { StorageError } from '../StorageError';
import { EntryDialog } from './EntryDialog';

type Open = { kind: 'add' } | { kind: 'edit'; s: Supplier } | { kind: 'remove'; s: Supplier } | null;

export function SuppliersScreen() {
  const db = useDb();
  const live = useSnapshot();
  const [open, setOpen] = useState<Open>(null);
  const back = <BackButton label="More" fallback={href.tab('more')} />;

  if (live.state === 'error') {
    return (
      <>
        <TopBar title="Suppliers" back={back} />
        <StorageError error={live.error} />
      </>
    );
  }
  const snap = live.state === 'ready' ? live.value : null;
  const usage = snap ? supplierUsage(snap.items) : new Map();
  const names = snap ? snap.suppliers.map((s) => s.name) : [];
  const rows = snap ? sortSupplierNames(names).map((n) => snap.suppliers.find((s) => s.name === n)!) : [];
  const totalOptions = [...usage.values()].reduce((n, u) => n + u.options, 0);

  const withPin = async (reason: string, next: Open) => {
    if (await gate(reason)) setOpen(next);
  };

  return (
    <>
      <TopBar
        title="Suppliers"
        subtitle={snap ? `${plural(rows.length, 'supplier')} · used by ${plural(totalOptions, 'vendor option')}` : 'Loading…'}
        back={back}
        actions={
          <button type="button" class="btn pri" disabled={!snap} onClick={() => void withPin('Adding a supplier needs the mentor PIN.', { kind: 'add' })}>
            <Icon name="plus" />
            Add supplier
            <PinMark />
          </button>
        }
      />
      <div class="mlist">
        <p class="small muted lockline">
          <Icon name="lock" />
          Adding, renaming and removing suppliers needs the mentor PIN. Item editors list suppliers A–Z with “other” last.
        </p>
        {!snap ? (
          <StateMessage icon="truck" title="Loading suppliers…" />
        ) : (
          rows.map((s) => {
            const u = usage.get(nameKey(s.name));
            const site = safeHref(s.website);
            const other = isOtherSupplier(s.name);
            return (
              <div class="srow" key={s.name}>
                <div class="srow-main">
                  <div class="srow-name">
                    <span class="sname">{s.name}</span>
                    {site && (
                      <a class="ib" href={site} target="_blank" rel="noopener noreferrer" aria-label={`Open the ${s.name} website`}>
                        <Icon name="external" />
                      </a>
                    )}
                  </div>
                  {s.notes && <div class="small muted">{s.notes}</div>}
                </div>
                <div class="used">
                  {u ? (
                    <>
                      <strong>{plural(u.options, 'vendor option')}</strong>
                      <div class="small muted">{u.preferred} as preferred vendor</div>
                    </>
                  ) : (
                    <>
                      <strong>Not used yet</strong>
                      <div class="small muted">{other ? 'Fallback for removed suppliers' : 'Safe to remove'}</div>
                    </>
                  )}
                </div>
                <div class="acts">
                  <button type="button" class="btn sm" onClick={() => void withPin(other ? 'Editing a supplier needs the mentor PIN.' : 'Renaming a supplier needs the mentor PIN.', { kind: 'edit', s })}>
                    {other ? 'Edit notes' : 'Rename'}
                    <PinMark />
                  </button>
                  {other ? (
                    <span class="chip mut tall">Fallback — can’t remove</span>
                  ) : (
                    <button type="button" class="btn sm danger" onClick={() => void withPin('Removing a supplier needs the mentor PIN.', { kind: 'remove', s })}>
                      Remove
                      <PinMark />
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {open?.kind === 'add' && (
        <EntryDialog
          title="Add a supplier"
          what="Supplier"
          existing={names}
          website
          notes
          placeholder="e.g. Digi-Key"
          notesPlaceholder="e.g. team account login is in the mentor binder"
          submitLabel="Add supplier"
          onClose={() => setOpen(null)}
          onSubmit={async (v) => {
            const s = await addSupplier(db, v);
            setOpen(null);
            showToast(`Added “${s.name}”.`);
          }}
        />
      )}
      {open?.kind === 'edit' && (
        <EntryDialog
          title={isOtherSupplier(open.s.name) ? `Edit “${open.s.name}”` : `Rename “${open.s.name}”`}
          what="Supplier"
          existing={names}
          self={open.s.name}
          initial={open.s}
          nameEditable={!isOtherSupplier(open.s.name)}
          website
          notes
          explain={
            isOtherSupplier(open.s.name)
              ? '“other” is the fallback supplier, so it keeps its name.'
              : `Updates ${plural(usage.get(nameKey(open.s.name))?.options ?? 0, 'vendor option')} and the order-list group name. Backups made after this use the new name.`
          }
          submitLabel={isOtherSupplier(open.s.name) ? 'Save' : 'Rename'}
          onClose={() => setOpen(null)}
          onSubmit={async (v) => {
            const s = await updateSupplier(db, open.s.name, v);
            setOpen(null);
            showToast(s.name === open.s.name ? 'Saved.' : `Renamed to “${s.name}”.`);
          }}
        />
      )}
      {open?.kind === 'remove' && snap && (
        <RemoveSupplier
          s={open.s}
          options={usage.get(nameKey(open.s.name))?.options ?? 0}
          preferred={usage.get(nameKey(open.s.name))?.preferred ?? 0}
          others={sortSupplierNames(names.filter((n) => n !== open.s.name))}
          onClose={() => setOpen(null)}
          onRemove={async (to) => {
            const moved = await removeSupplier(db, open.s.name, to);
            setOpen(null);
            showToast(moved > 0 ? `Removed ${open.s.name}; ${plural(moved, 'item')} now use ${to}.` : `Removed ${open.s.name}.`);
          }}
        />
      )}
    </>
  );
}

function RemoveSupplier(props: {
  s: Supplier;
  options: number;
  preferred: number;
  others: string[];
  onClose: () => void;
  onRemove: (replacement: string) => Promise<void>;
}) {
  const [to, setTo] = useState(OTHER_SUPPLIER);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = props.s.name;
  const used = props.options > 0;
  const go = async () => {
    setBusy(true);
    try {
      await props.onRemove(to);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };
  return (
    <Dialog label="Remove supplier" role="alertdialog" onClose={() => !busy && props.onClose()}>
      <h2 class="h2">Remove “{name}”?</h2>
      {used ? (
        <>
          <p class="dlg-big">
            <strong>{plural(props.options, 'vendor option')}</strong> use {name} ({props.preferred} preferred). They need a new supplier first.
          </p>
          <div>
            <span class="lbl" id="repl-l">
              Move them to
            </span>
            <div class="chips-row" role="radiogroup" aria-labelledby="repl-l">
              {props.others.map((o) => (
                <button key={o} type="button" role="radio" aria-checked={to === o} class={to === o ? 'fchip on' : 'fchip'} onClick={() => setTo(o)}>
                  {o}
                </button>
              ))}
            </div>
          </div>
          <p class="dlg-p small muted">Part numbers, links and prices stay as they are; check them later, since they belonged to {name}.</p>
        </>
      ) : (
        <p class="dlg-big">No vendor options use {name}.</p>
      )}
      {error && (
        <div class="err" role="alert">
          {error}
        </div>
      )}
      <DialogActions>
        <button type="button" class="btn lg" data-autofocus disabled={busy} onClick={props.onClose}>
          Keep {name}
        </button>
        <button type="button" class="btn danger lg" disabled={busy} onClick={() => void go()}>
          <Icon name="trash" />
          {used ? `Move to ${to} and remove` : `Remove ${name}`}
        </button>
      </DialogActions>
    </Dialog>
  );
}
