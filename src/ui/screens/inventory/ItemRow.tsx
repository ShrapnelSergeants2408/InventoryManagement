// One item row (F2): thumbnail, name, note icon, part # · supplier · pack price · location,
// desired / spares / order, status chip, On-hand stepper (F3), and the row menu (⋮): Add to
// order list (F27), details, QR label.
import { useState } from 'preact/hooks';
import type { ItemInfo } from '../../../domain/inventory-view';
import { formatCents } from '../../../domain/money';
import { Dialog, DialogActions } from '../../components/Dialog';
import { StatusChip } from '../../components/common';
import { OnHandStepper } from '../../components/OnHandStepper';
import { useThumbnail } from '../../data-hooks';
import { Icon } from '../../icons';
import { href } from '../../shell/router';
import { AddToListDialog } from '../order/ListDialogs';

export function Thumb({ itemId, hasPhoto }: { itemId: string; hasPhoto: boolean }) {
  const url = useThumbnail(itemId, hasPhoto);
  if (url) return <img class="thumb" src={url} alt="" />;
  return (
    <span class="thumb nophoto">
      <Icon name="photo" />
    </span>
  );
}

function priceText(info: ItemInfo): string {
  const v = info.vendor;
  if (!v || v.packPriceCents === null) return 'No price';
  return formatCents(v.packPriceCents) + (v.packSize > 1 ? ` / ${v.packSize}` : '');
}

export function ItemRow(props: {
  info: ItemInfo;
  onStep: (id: string, delta: number) => void;
  onSet: (id: string, value: number) => Promise<unknown>;
}) {
  const { item, status, vendor, order, onOrder } = props.info;
  const [menu, setMenu] = useState<'menu' | 'add' | null>(null);
  const tint = status.kind === 'short' ? 'row red' : status.kind === 'low' ? 'row yel' : 'row';
  return (
    <div class={tint}>
      <a class="rlink" href={href.item(item.id)} aria-label={`Open details for ${item.name}`}>
        <Thumb itemId={item.id} hasPhoto={item.hasPhoto} />
        <span class="rtext">
          <span class="rname">
            {item.name}
            {item.notes.trim() !== '' && <Icon name="note" label="Has notes" />}
          </span>
          <span class="rmeta">
            <span>{vendor?.partNo || 'No part #'}</span>
            <span>{vendor?.supplier ?? 'No supplier'}</span>
            <span>{priceText(props.info)}</span>
            <span class={item.location ? '' : 'noloc'}>
              <Icon name="pin" /> {item.location || 'No location'}
            </span>
          </span>
        </span>
      </a>
      <div class="nums">
        <div class="col">
          <span class="cl">Desired</span>
          <span class="cv">{item.desired}</span>
        </div>
        <div class="col">
          <span class="cl">Spares</span>
          <span class="cv">{item.spares}</span>
        </div>
        <div class="col w">
          <span class="cl">Order</span>
          <span class="cv">{order ? order.orderQty : '—'}</span>
          {order && <span class="cs">{order.vendor.packSize > 1 ? `${order.packs} × ${order.vendor.packSize}` : item.unit}</span>}
          {onOrder > 0 && <span class="cs onord-t">On order {onOrder}</span>}
        </div>
      </div>
      <span class="rchip">
        <StatusChip status={status} />
      </span>
      <OnHandStepper
        value={item.onHand}
        unit={item.unit}
        itemName={item.name}
        onStep={(d) => props.onStep(item.id, d)}
        onSet={(n) => props.onSet(item.id, n)}
      />
      <button type="button" class="ib rmenu" aria-label={`More for ${item.name}`} onClick={() => setMenu('menu')}>
        <Icon name="dots" />
      </button>
      {menu === 'menu' && (
        <Dialog label={item.name} onClose={() => setMenu(null)}>
          <h2 class="h2">{item.name}</h2>
          <div class="menu-acts">
            <button type="button" class="btn lg" data-autofocus onClick={() => setMenu('add')}>
              <Icon name="listAdd" />
              Add to order list…
            </button>
            <a class="btn lg" href={href.item(item.id)}>
              <Icon name="info" />
              Open details
            </a>
            <a class="btn lg" href={href.labels([item.id])}>
              <Icon name="print" />
              Print QR label
            </a>
          </div>
          <DialogActions>
            <button type="button" class="btn lg" onClick={() => setMenu(null)}>
              Close
            </button>
          </DialogActions>
        </Dialog>
      )}
      {menu === 'add' && <AddToListDialog item={item} onClose={() => setMenu(null)} />}
    </div>
  );
}
