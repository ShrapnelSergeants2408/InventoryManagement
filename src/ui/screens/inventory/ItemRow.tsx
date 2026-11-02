// One item row: thumbnail, name, note icon, category · path, the quantity stepper, and the row
// menu (⋮): details, QR label.
import { useState } from 'preact/hooks';
import { placeLabel } from '../../../domain/lists';
import { NO_HOME } from '../../../domain/places';
import type { Item } from '../../../domain/types';
import { Dialog, DialogActions } from '../../components/Dialog';
import { QuantityStepper } from '../../components/QuantityStepper';
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

export function ItemRow(props: {
  item: Item;
  /** Its path (§4), or "No home yet". */
  where: string;
  onStep: (id: string, delta: number) => void;
  onSet: (id: string, value: number) => Promise<unknown>;
}) {
  const { item } = props;
  const [menu, setMenu] = useState(false);
  return (
    <div class="row">
      <a class="rlink" href={href.item(item.id)} aria-label={`Open details for ${item.name}`}>
        <Thumb itemId={item.id} hasPhoto={item.hasPhoto} />
        <span class="rtext">
          <span class="rname">
            {item.name}
            {item.notes.trim() !== '' && <Icon name="note" label="Has notes" />}
          </span>
          <span class="rmeta">
            <span>{placeLabel(item)}</span>
            <span class={props.where === NO_HOME ? 'noloc' : ''}>
              <Icon name="pin" /> {props.where}
            </span>
          </span>
        </span>
      </a>
      <QuantityStepper
        value={item.quantity}
        itemName={item.name}
        onStep={(d) => props.onStep(item.id, d)}
        onSet={(n) => props.onSet(item.id, n)}
      />
      <button type="button" class="ib rmenu" aria-label={`More for ${item.name}`} onClick={() => setMenu(true)}>
        <Icon name="dots" />
      </button>
      {menu && (
        <Dialog label={item.name} onClose={() => setMenu(false)}>
          <h2 class="h2">{item.name}</h2>
          <div class="menu-acts">
            <a class="btn lg" data-autofocus href={href.item(item.id)}>
              <Icon name="info" />
              Open details
            </a>
            <a class="btn lg" href={href.labels([item.id])}>
              <Icon name="print" />
              Print QR label
            </a>
          </div>
          <DialogActions>
            <button type="button" class="btn lg" onClick={() => setMenu(false)}>
              Close
            </button>
          </DialogActions>
        </Dialog>
      )}
    </div>
  );
}
