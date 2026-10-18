// Delete item (F8): mentor PIN, then a confirmation that shows the item's name and on-hand
// count (mockup 2c). No undo: the confirmation is the only safeguard.
import { useState } from 'preact/hooks';
import { deleteItem } from '../../../data/items';
import type { Item } from '../../../domain/types';
import { gate } from '../../../security/gate';
import { PinMark } from '../../components/common';
import { Dialog, DialogActions } from '../../components/Dialog';
import { useDb, useThumbnail } from '../../data-hooks';
import { Icon } from '../../icons';
import { href, replaceRoute } from '../../shell/router';
import { showToast } from '../../shell/toast';

export function DeleteItemButton({ item, label = 'Delete item' }: { item: Item; label?: string }) {
  const db = useDb();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const thumb = useThumbnail(item.id, item.hasPhoto);

  const ask = async () => {
    if (await gate('Deleting an item needs the mentor PIN.')) setConfirming(true);
  };
  const doDelete = async () => {
    setBusy(true);
    try {
      await deleteItem(db, item.id);
      showToast(`Deleted “${item.name}”.`);
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
