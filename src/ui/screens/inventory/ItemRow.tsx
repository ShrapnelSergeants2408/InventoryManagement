// One item row (F2): thumbnail, name, note icon, part # · supplier · pack price · location,
// desired / spares / order, status chip, On-hand stepper (F3).
import type { ItemInfo } from '../../../domain/inventory-view';
import { formatCents } from '../../../domain/money';
import { StatusChip } from '../../components/common';
import { OnHandStepper } from '../../components/OnHandStepper';
import { useThumbnail } from '../../data-hooks';
import { Icon } from '../../icons';
import { href } from '../../shell/router';

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
  const { item, status, vendor, order } = props.info;
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
    </div>
  );
}
