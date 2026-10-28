// Delete item (F8): mentor PIN, then a confirmation that shows the item's name and on-hand
// count (mockup 2c), and how many named order lists it's on (F27). No undo: the confirmation is
// the only safeguard.
import { useState } from 'preact/hooks';
import { deleteItem } from '../../../data/items';
import { listsWithItem } from '../../../data/order-lists';
import { openOrdersWithItem } from '../../../data/placed-orders';
import type { Item } from '../../../domain/types';
import { gate } from '../../../security/gate';
import { PinMark, plural } from '../../components/common';
import { Dialog, DialogActions } from '../../components/Dialog';
import { useDb, useThumbnail } from '../../data-hooks';
import { Icon } from '../../icons';
import { useCloseOnRelock } from '../../shell/LockPill';
import { href, replaceRoute } from '../../shell/router';
import { showToast } from '../../shell/toast';

export function DeleteItemButton({ item, label = 'Delete item' }: { item: Item; label?: string }) {
  const db = useDb();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [onLists, setOnLists] = useState<string[]>([]);
  const [ordered, setOrdered] = useState<{ orders: number; units: number }>({ orders: 0, units: 0 });
  const thumb = useThumbnail(item.id, item.hasPhoto);

  useCloseOnRelock(confirming && !busy, () => setConfirming(false));

  const reason = 'Deleting an item needs the mentor PIN.';
  const ask = async () => {
    if (!(await gate(reason))) return;
    setOnLists(await listsWithItem(db, item.id).catch(() => []));
    setOrdered(await openOrdersWithItem(db, item.id).catch(() => ({ orders: 0, units: 0 })));
    setConfirming(true);
  };
  const doDelete = async () => {
    // Checked again here: the tablet may have relocked while the confirmation was open.
    if (busy || !(await gate(reason))) return;
    setBusy(true);
    try {
      const lists = await deleteItem(db, item.id);
      showToast(`Deleted “${item.name}”${lists > 0 ? ` and took it off ${plural(lists, 'order list')}` : ''}.`);
      replaceRoute(href.tab('inventory'));
    } catch (e) {
      showToast(`Couldn't delete: ${e instanceof Error ? e.message : String(e)}`);
      setBusy(false);
      setConfirming(false);
    }
  };

  return (
    <>
      <button type="button" class="btn danger" onClick={() => void ask()}>
        <Icon name="trash" />
        {label}
        <PinMark />
      </button>
      {confirming && (
        <Dialog label="Delete item" role="alertdialog" onClose={() => !busy && setConfirming(false)}>
          <div class="dlg-head">
            <span class="dlg-ic red">
              <Icon name="trash" />
            </span>
            <h2 class="h2">Delete this item?</h2>
          </div>
          <div class="card del-card">
            {thumb && <img src={thumb} alt="" class="del-thumb" />}
            <div>
              <div class="del-name">{item.name}</div>
              <div class="dlg-big">
                On hand:{' '}
                <strong>
                  {item.onHand} {item.unit}
                </strong>
              </div>
            </div>
          </div>
          <p class="dlg-p">It disappears from the list, the order list and QR label scans. The only way back is restoring a backup made before now.</p>
          {onLists.length > 0 && (
            <p class="dlg-p">
              It’s also on {plural(onLists.length, 'named order list')} ({onLists.join(', ')}) and will be taken off {onLists.length === 1 ? 'it' : 'them'}.
            </p>
          )}
          {ordered.units > 0 && (
            <p class="dlg-p">
              {ordered.units} {item.unit} {ordered.units === 1 ? 'is' : 'are'} on order ({plural(ordered.orders, 'open order')}). The orders keep their record; when the parts
              arrive, receiving marks them received without adding them anywhere.
            </p>
          )}
          <DialogActions>
            <button type="button" class="btn lg" data-autofocus disabled={busy} onClick={() => setConfirming(false)}>
              Keep item
            </button>
            <button type="button" class="btn danger lg" disabled={busy} onClick={() => void doDelete()}>
              <Icon name="trash" />
              Delete item
            </button>
          </DialogActions>
        </Dialog>
      )}
    </>
  );
}
