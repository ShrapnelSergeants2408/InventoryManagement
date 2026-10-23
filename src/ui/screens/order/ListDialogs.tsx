// Named order list dialogs (F27): Add to order list (from an item row, the detail card or a
// scan result), New list / Edit list (name and notes), and the delete confirmations. No PIN.
import { useState } from 'preact/hooks';
import { addToOrderList, createOrderList, deleteOrderList, editOrderList } from '../../../data/order-lists';
import { formatCents } from '../../../domain/money';
import { MAX_LIST_NAME, defaultQuantity, listNameProblem, packsFor, type NamedOrderList } from '../../../domain/order-lists';
import { preferredVendorOf, type Item } from '../../../domain/types';
import { Dialog, DialogActions } from '../../components/Dialog';
import { plural } from '../../components/common';
import { useDb, useOrderLists } from '../../data-hooks';
import { Icon } from '../../icons';
import { href, replaceRoute } from '../../shell/router';
import { showToast } from '../../shell/toast';

const NEW = '\u0000new';
/** The list picked last time, so adding several items to one list is one tap each. */
let lastListId: string | null = null;

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** "3 packs of 25 = 75 each" / "4 each". */
export function packText(quantity: number, packSize: number, unit: string): string {
  const { packs, orderQty } = packsFor(quantity, packSize);
  return packSize > 1 ? `${plural(packs, 'pack')} of ${packSize} = ${orderQty} ${unit}` : `${orderQty} ${unit}`;
}

export function AddToListDialog({ item, onClose }: { item: Item; onClose: () => void }) {
  const db = useDb();
  const live = useOrderLists();
  const lists = live.state === 'ready' ? live.value : [];
  const vendor = preferredVendorOf(item);
  const packSize = vendor?.packSize ?? 1;
  const [listId, setListId] = useState<string>(() => lastListId ?? NEW);
  const [newName, setNewName] = useState('');
  const [packs, setPacks] = useState(() => packsFor(defaultQuantity(item), packSize).packs);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exists, setExists] = useState<{ list: NamedOrderList; quantity: number } | null>(null);

  // A remembered list that was deleted since falls back to the first list, or a new one.
  const chosen = listId === NEW ? null : (lists.find((l) => l.id === listId) ?? null);
  const pick = chosen ? chosen.id : live.state === 'ready' && listId !== NEW ? (lists[0]?.id ?? NEW) : listId;
  const typing = pick === NEW;
  const quantity = packs * packSize;
  const nameProblem = typing && newName.trim() !== '' ? listNameProblem(newName, lists) : null;
  const ready = live.state === 'ready' && (!typing || (newName.trim() !== '' && !nameProblem));
  const price = vendor?.packPriceCents == null ? 'No price — not in the list total' : formatCents(packs * vendor.packPriceCents);

  const done = (list: NamedOrderList, verb: string) => {
    lastListId = list.id;
    showToast(`${verb} “${item.name}” ${verb === 'Added' ? 'to' : 'on'} ${list.name}.`);
    onClose();
  };

  const save = async (replace = false) => {
    setBusy(true);
    setError(null);
    try {
      const list = typing ? await createOrderList(db, newName, '') : lists.find((l) => l.id === pick)!;
      const r = await addToOrderList(db, list.id, item.id, quantity, { replace });
      if (r.kind === 'exists') {
        setExists({ list, quantity: r.quantity });
        setBusy(false);
        return;
      }
      done(list, r.kind === 'added' ? 'Added' : 'Updated');
    } catch (e) {
      setError(message(e));
      setBusy(false);
    }
  };

  if (exists) {
    return (
      <Dialog label="Already on this list" role="alertdialog" onClose={() => !busy && onClose()}>
        <h2 class="h2">Already on {exists.list.name}</h2>
        <p class="dlg-p">
          “{item.name}” is on this list with {packText(exists.quantity, packSize, item.unit)}. Change it to {packText(quantity, packSize, item.unit)}?
        </p>
        {error && (
          <div class="err" role="alert">
            {error}
          </div>
        )}
        <DialogActions>
          <button type="button" class="btn lg" data-autofocus disabled={busy} onClick={onClose}>
            Keep {exists.quantity}
          </button>
          <button type="button" class="btn pri lg" disabled={busy} onClick={() => void save(true)}>
            Change to {quantity}
          </button>
        </DialogActions>
      </Dialog>
    );
  }

  return (
    <Dialog label="Add to order list" onClose={() => !busy && onClose()}>
      <h2 class="h2">Add to order list</h2>
      <div class="small muted">
        {item.name}
        {vendor ? ` · ${vendor.supplier}${vendor.partNo ? ` ${vendor.partNo}` : ''}` : ''}
      </div>
      <div>
        <label class="lbl" for="alist">
          List
        </label>
        <select id="alist" class="field" value={pick} onChange={(e) => setListId((e.currentTarget as HTMLSelectElement).value)}>
          {lists.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
          <option value={NEW}>+ New list…</option>
        </select>
      </div>
      {typing && (
        <div>
          <label class="lbl" for="aname">
            Name of the new list
          </label>
          <input
            id="aname"
            class="field"
            value={newName}
            maxLength={MAX_LIST_NAME}
            placeholder="e.g. WCP order — Nov"
            autoComplete="off"
            onInput={(e) => setNewName((e.currentTarget as HTMLInputElement).value)}
          />
          {nameProblem && <div class="err small">{nameProblem}</div>}
        </div>
      )}
      <div>
        <span class="lbl" id="aqty">
          Quantity {packSize > 1 ? `(packs of ${packSize})` : `(${item.unit})`}
        </span>
        <div class="stepper-row" role="group" aria-labelledby="aqty">
          <button type="button" class="step" aria-label="One pack fewer" disabled={packs <= 1 || busy} onClick={() => setPacks((p) => Math.max(1, p - 1))}>
            <Icon name="minus" />
          </button>
          <span class="num" aria-live="polite">
            {packs}
          </span>
          <button type="button" class="step" aria-label="One pack more" disabled={busy} onClick={() => setPacks((p) => p + 1)}>
            <Icon name="plus" />
          </button>
        </div>
        <div class="small muted">
          {packText(quantity, packSize, item.unit)} · {price}
        </div>
      </div>
      <p class="small muted">The list is a plan: it doesn’t change on-hand counts or the automatic order list.</p>
      {error && (
        <div class="err" role="alert">
          {error}
        </div>
      )}
      <DialogActions>
        <button type="button" class="btn lg" disabled={busy} onClick={onClose}>
          Cancel
        </button>
        <button type="button" class="btn pri lg" data-autofocus disabled={busy || !ready} onClick={() => void save()}>
          <Icon name="listAdd" />
          Add to list
        </button>
      </DialogActions>
    </Dialog>
  );
}

/** New list (no `list`) or Edit list: name and notes. Opens the list after creating it. */
export function ListInfoDialog({ list, lists, onClose }: { list?: NamedOrderList; lists: readonly NamedOrderList[]; onClose: () => void }) {
  const db = useDb();
  const [name, setName] = useState(list?.name ?? '');
  const [notes, setNotes] = useState(list?.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const problem = name.trim() === '' ? null : listNameProblem(name, lists, list?.id);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      if (list) {
        await editOrderList(db, list.id, name, notes);
        onClose();
      } else {
        const made = await createOrderList(db, name, notes);
        showToast(`Made the list “${made.name}”. Add items from an item’s ⋮ menu, its detail card or a scan.`);
        onClose();
        location.hash = href.orderList(made.id);
      }
    } catch (e) {
      setError(message(e));
      setBusy(false);
    }
  };

  return (
    <Dialog label={list ? 'Edit list' : 'New order list'} onClose={() => !busy && onClose()}>
      <h2 class="h2">{list ? 'Edit list' : 'New order list'}</h2>
      <div>
        <label class="lbl" for="lname">
          Name
        </label>
        <input
          id="lname"
          class="field"
          value={name}
          maxLength={MAX_LIST_NAME}
          placeholder="e.g. WCP order — Nov"
          autoComplete="off"
          onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)}
        />
        {problem && <div class="err small">{problem}</div>}
      </div>
      <div>
        <label class="lbl" for="lnotes">
          Notes (optional)
        </label>
        <textarea id="lnotes" class="field" rows={3} value={notes} onInput={(e) => setNotes((e.currentTarget as HTMLTextAreaElement).value)} />
      </div>
      {error && (
        <div class="err" role="alert">
          {error}
        </div>
      )}
      <DialogActions>
        <button type="button" class="btn lg" disabled={busy} onClick={onClose}>
          Cancel
        </button>
        <button type="button" class="btn pri lg" disabled={busy || name.trim() === '' || !!problem} onClick={() => void save()}>
          {list ? 'Save' : 'Make list'}
        </button>
      </DialogActions>
    </Dialog>
  );
}

export function DeleteListDialog({ list, onClose }: { list: NamedOrderList; onClose: () => void }) {
  const db = useDb();
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      await deleteOrderList(db, list.id);
      showToast(`Deleted the list “${list.name}”.`);
      onClose();
      replaceRoute(href.tab('order'));
    } catch (e) {
      showToast(`Couldn't delete the list: ${message(e)}`);
      setBusy(false);
    }
  };
  return (
    <Dialog label="Delete list" role="alertdialog" onClose={() => !busy && onClose()}>
      <h2 class="h2">Delete the list “{list.name}”?</h2>
      <p class="dlg-p">
        Its {plural(list.lines.length, 'line')} {list.lines.length === 1 ? 'goes' : 'go'} with it. Items and counts stay as they are; only the list is deleted.
      </p>
      <DialogActions>
        <button type="button" class="btn lg" data-autofocus disabled={busy} onClick={onClose}>
          Keep list
        </button>
        <button type="button" class="btn danger lg" disabled={busy} onClick={() => void go()}>
          <Icon name="trash" />
          Delete list
        </button>
      </DialogActions>
    </Dialog>
  );
}
