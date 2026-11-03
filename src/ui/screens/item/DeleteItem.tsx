// Delete item (F16, SPEC v2.0 §6): a confirmation that shows the item's name and quantity. No
// undo: the confirmation is the only safeguard.
import { useState } from 'preact/hooks';
import { deleteItem } from '../../../data/items';
import type { Item } from '../../../domain/types';
import { Dialog, DialogActions } from '../../components/Dialog';
import { useDb, useThumbnail } from '../../data-hooks';
import { Icon } from '../../icons';
import { href, replaceRoute } from '../../shell/router';
import { getPart } from '../../part';
import { showToast } from '../../shell/toast';

export function DeleteItemButton({ item, label = 'Delete item' }: { item: Item; label?: string }) {
  const db = useDb();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const thumb = useThumbnail(item.id, item.hasPhoto);

  const doDelete = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await deleteItem(db, item.id);
      showToast(`Deleted “${item.name}”.`);
      replaceRoute(href.home(getPart()));
    } catch (e) {
      showToast(`Couldn't delete: ${e instanceof Error ? e.message : String(e)}`);
      setBusy(false);
      setConfirming(false);
    }
  };

  return (
    <>
      <button type="button" class="btn danger" onClick={() => setConfirming(true)}>
        <Icon name="trash" />
        {label}
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
                Quantity: <strong>{item.quantity}</strong>
              </div>
            </div>
          </div>
          <p class="dlg-p">It disappears from the list and from QR label scans. The only way back is restoring a backup made before now.</p>
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
