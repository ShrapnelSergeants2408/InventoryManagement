// Item detail card (F10): photo (tap to enlarge; take, replace or remove it, F19), +/− for
// on hand, desired and spares,
// the order line, location/category/barcode/notes, every vendor option with its link (F11).
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { adjustCount, setCount, type CountField } from '../../../data/inventory';
import { setPhoto, type PhotoChange } from '../../../data/photos';
import { countedDate, formatIsoDate } from '../../../domain/dates';
import { orderLines, packText, stockLines } from '../../../domain/item-text';
import { formatCents } from '../../../domain/money';
import { stockStatus } from '../../../domain/status';
import type { Item } from '../../../domain/types';
import { safeHref } from '../../../domain/url';
import { BackButton, StateMessage, StatusChip, TopBar, plural } from '../../components/common';
import { Dialog, DialogActions } from '../../components/Dialog';
import { CountStepper, type StepperLabel } from '../../components/OnHandStepper';
import { PhotoButtons } from '../../components/PhotoButtons';
import { forgetThumbnail, useDb, usePhoto, useSnapshot, type PhotoView } from '../../data-hooks';
import { Icon } from '../../icons';
import { href } from '../../shell/router';
import { showToast } from '../../shell/toast';
import { StorageError } from '../StorageError';
import { AddToListDialog } from '../order/ListDialogs';
import { DeleteItemButton } from './DeleteItem';

const crumb = (i: Item) => (i.subcategory ? `${i.category} › ${i.subcategory}` : i.category);

export function DetailScreen({ id }: { id: string }) {
  const live = useSnapshot();
  const back = <BackButton fallback={href.tab('inventory')} />;
  if (live.state === 'error') {
    return (
      <>
        <TopBar title="Item" back={back} />
        <StorageError error={live.error} />
      </>
    );
  }
  if (live.state === 'loading') {
    return (
      <>
        <TopBar title="Loading…" kicker="" back={back} />
        <div class="state" aria-busy="true">
          <p class="state-text muted">Loading item…</p>
        </div>
      </>
    );
  }
  const item = live.value.items.find((i) => i.id === id);
  if (!item) return <ItemMissing id={id} back={back} />;
  return <Detail item={item} back={back} />;
}

export function ItemMissing({ id, back }: { id: string; back: ComponentChildren }) {
  return (
    <>
      <TopBar title="Item not found" back={back} />
      <StateMessage
        icon="search"
        title={`No item “${id}” on this tablet`}
        actions={
          <a class="btn pri" href={href.tab('inventory')}>
            <Icon name="inventory" />
            Go to the inventory
          </a>
        }
      >
        <p class="state-text">It may have been deleted, or this tablet was restored from an older backup.</p>
      </StateMessage>
    </>
  );
}

function Detail({ item, back }: { item: Item; back: ComponentChildren }) {
  const db = useDb();
  const photo = usePhoto(item.id, item.hasPhoto);
  const [enlarged, setEnlarged] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [adding, setAdding] = useState(false);
  const camera = useRef<HTMLInputElement>(null);
  const status = stockStatus(item.onHand, item.desired, item.spares);
  const stock = stockLines(item);
  const order = orderLines(item);
  const vendors = item.vendors.flatMap((v, i) => (v ? [{ v, slot: i + 1 }] : []));

  const fail = (e: unknown) => showToast(`Couldn't save: ${e instanceof Error ? e.message : String(e)}`);
  const changePhoto = async (change: PhotoChange) => {
    try {
      await setPhoto(db, item.id, change);
      showToast(change === 'remove' ? 'Photo removed.' : 'Photo saved.');
    } catch (e) {
      fail(e);
    } finally {
      forgetThumbnail(item.id);
    }
  };
  const stepper = (field: CountField, label: StepperLabel, size?: 'xl') => (
    <CountStepper
      label={label}
      value={item[field]}
      itemName={item.name}
      size={size}
      onStep={(d) => void adjustCount(db, item.id, field, d).catch(fail)}
      onSet={(n) =>
        setCount(db, item.id, field, n).catch((e: unknown) => {
          fail(e);
          throw e;
        })
      }
    />
  );

  return (
    <>
      <TopBar title={item.name} kicker={crumb(item)} back={back} />
      <div class="dbody">
        <div class="dleft">
          <div class="dphoto">
            {item.hasPhoto && photo ? (
              <button type="button" class="photo" onClick={() => setEnlarged(true)} aria-label="Enlarge photo">
                <img src={photo.url} alt={item.name} />
                <span class="hint">Tap to enlarge</span>
              </button>
            ) : (
              <div class="photo nophoto">
                <Icon name="photo" class="ic xxl" />
                <span class="nophoto-t">{item.hasPhoto ? 'Loading photo…' : 'No photo yet'}</span>
                {!item.hasPhoto && <span class="small muted">Add one so students can recognize the part.</span>}
              </div>
            )}
            <PhotoButtons
              hasPhoto={item.hasPhoto}
              cameraRef={camera}
              onPhoto={(p) => changePhoto(p)}
              onRemove={() => setRemoving(true)}
            />
            <span class="small muted">{photoNote(item, photo)}</span>
          </div>
          <div class="dacts">
            <a class="btn pri lg" href={href.edit(item.id)}>
              <Icon name="pencil" />
              Edit item
            </a>
            <button type="button" class="btn" onClick={() => setAdding(true)}>
              <Icon name="listAdd" />
              Add to order list
            </button>
            <a class="btn" href={href.labels([item.id])}>
              <Icon name="print" />
              Print QR label
            </a>
            <DeleteItemButton item={item} />
          </div>
        </div>

        <div class="dright">
          <div class="dchips">
            <span class="bigchip">
              <StatusChip status={status} />
            </span>
            <span class="chip mut">{item.source === 'starter' ? 'Starter item' : 'Team item'}</span>
            <span class="chip mut">ID {item.id}</span>
            <span class="chip mut">{item.lastCounted ? `Counted ${formatIsoDate(countedDate(item.lastCounted))}${item.countedBy ? ` by ${item.countedBy}` : ''}` : 'Not counted yet'}</span>
          </div>

          <div class="card box">
            <span class="lbl">On hand ({item.unit})</span>
            <div class="qty">
              {stepper('onHand', 'On hand', 'xl')}
              <div class="qty-text">
                <div class="qty-title">{stock.title}</div>
                <div class="small muted">{stock.sub}</div>
              </div>
            </div>
          </div>

          <div class="two">
            <div class="card box">
              <span class="lbl">Desired</span>
              {stepper('desired', 'Desired')}
            </div>
            <div class="card box">
              <span class="lbl">Spares</span>
              {stepper('spares', 'Spares')}
            </div>
          </div>

          <div class="card box ordbox">
            <Icon name="order" class="ic lg" />
            <div>
              <div class="qty-title">{order.title}</div>
              <div class="small muted">{order.sub}</div>
            </div>
          </div>

          <div class="card box kv">
            <span class="lbl">Location</span>
            <span class={item.location ? '' : 'noloc'}>{item.location || 'No location'}</span>
            <span class="lbl">Category</span>
            <span>{crumb(item)}</span>
            <span class="lbl">Barcode</span>
            <span class={item.barcode ? 'mono' : 'muted'}>{item.barcode || 'None'}</span>
            <span class="lbl">Notes</span>
            <span class={item.notes ? 'notes' : 'muted'}>{item.notes || 'No notes'}</span>
          </div>

          <section>
            <h2 class="h2 sec-h">Where to buy ({plural(vendors.length, 'vendor option')})</h2>
            <div class="vends">
              {vendors.map(({ v, slot }) => {
                const link = safeHref(v.url);
                return (
                  <div class="card vend" key={slot}>
                    <div class="vtext">
                      <div class="vname">
                        {v.supplier}
                        {slot === item.preferredVendor && (
                          <span class="chip pref">
                            <Icon name="star" />
                            Preferred
                          </span>
                        )}
                      </div>
                      <div>
                        <span class="mono">{v.partNo || 'No part #'}</span> · {packText(v)} ·{' '}
                        <strong>{v.packPriceCents === null ? 'No price' : `${formatCents(v.packPriceCents)}${v.packSize > 1 ? ' per pack' : ''}`}</strong>
                      </div>
                      <div class="small muted">{v.priceChecked ? `Price checked ${formatIsoDate(v.priceChecked)}` : 'Price date unknown'}</div>
                    </div>
                    {link ? (
                      <a class="btn" href={link} target="_blank" rel="noopener noreferrer">
                        Open product page
                        <Icon name="external" />
                      </a>
                    ) : (
                      <span class="small muted">No product link</span>
                    )}
                  </div>
                );
              })}
            </div>
            <p class="small muted lockline">
              <Icon name="lock" />
              Changing vendors, prices or the preferred vendor needs the mentor PIN (Edit item).
            </p>
          </section>
        </div>
      </div>

      {enlarged && photo && (
        <Lightbox
          src={photo.url}
          name={item.name}
          note={photoNote(item, photo)}
          onReplace={() => camera.current?.click()}
          onClose={() => setEnlarged(false)}
        />
      )}
      {removing && (
        <Dialog label="Remove photo" role="alertdialog" onClose={() => setRemoving(false)}>
          <h2 class="h2">Remove this photo?</h2>
          <p class="dlg-p">
            {isVendorPhoto(item, photo)
              ? 'The starter-catalog photo only comes back by restoring a backup that has it.'
              : 'The photo is deleted from this tablet. Backups made before now still have it.'}
          </p>
          <DialogActions>
            <button type="button" class="btn lg" data-autofocus onClick={() => setRemoving(false)}>
              Keep photo
            </button>
            <button
              type="button"
              class="btn danger lg"
              onClick={() => {
                setRemoving(false);
                void changePhoto('remove');
              }}
            >
              <Icon name="trash" />
              Remove photo
            </button>
          </DialogActions>
        </Dialog>
      )}
      {adding && <AddToListDialog item={item} onClose={() => setAdding(false)} />}
    </>
  );
}

/** A starter item's photo that wasn't taken on this tablet: the vendor's image (§8). */
const isVendorPhoto = (item: Item, photo: PhotoView | null) => item.source === 'starter' && photo !== null && !photo.taken;

function photoNote(item: Item, photo: PhotoView | null): string {
  if (!item.hasPhoto) return 'Photos are optional; one per item.';
  if (isVendorPhoto(item, photo)) return 'Vendor product photo from the starter catalog. Replace it with a photo of your own part any time.';
  return photo ? 'Team photo.' : '';
}

/** Tap-to-enlarge photo (F10, mockup 2b). A tap anywhere, Close or Escape closes it. */
function Lightbox(props: { src: string; name: string; note: string; onReplace: () => void; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && props.onClose();
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);
  return (
    <div class="lb" role="dialog" aria-modal="true" aria-label="Photo" onClick={props.onClose}>
      <img src={props.src} alt={props.name} />
      <div class="lb-cap">
        {props.name}
        {props.note && <div class="small lb-note">{props.note}</div>}
      </div>
      <div class="lb-acts">
        {/* Opens the camera from this tap; the tap then reaches the backdrop and closes the view. */}
        <button type="button" class="btn lg" onClick={props.onReplace}>
          <Icon name="camera" />
          Replace with my photo
        </button>
        <button type="button" class="btn pri lg" autoFocus onClick={props.onClose}>
          <Icon name="close" />
          Close
        </button>
      </div>
    </div>
  );
}
