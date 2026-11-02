// Item detail card (F16): photo (tap to enlarge; take, replace or remove it), the quantity
// stepper, and location, category, barcode and notes. H2 adds the carousel, path breadcrumbs
// and status chips.
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { adjustQuantity, setQuantity } from '../../../data/inventory';
import { setPhoto, type PhotoChange } from '../../../data/photos';
import { noteViewed } from '../../../data/prefs';
import type { Item } from '../../../domain/types';
import { BackButton, StateMessage, TopBar } from '../../components/common';
import { Dialog, DialogActions } from '../../components/Dialog';
import { CountStepper } from '../../components/QuantityStepper';
import { PhotoButtons } from '../../components/PhotoButtons';
import { forgetThumbnail, useDb, usePhoto, useSnapshot } from '../../data-hooks';
import { Icon } from '../../icons';
import { href } from '../../shell/router';
import { showToast } from '../../shell/toast';
import { StorageError } from '../StorageError';
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
        title={`No item “${id}”`}
        actions={
          <a class="btn pri" href={href.tab('inventory')}>
            <Icon name="inventory" />
            Go to the inventory
          </a>
        }
      >
        <p class="state-text">It may have been deleted, or this phone was restored from an older backup.</p>
      </StateMessage>
    </>
  );
}

function Detail({ item, back }: { item: Item; back: ComponentChildren }) {
  const db = useDb();
  const photo = usePhoto(item.id, item.hasPhoto);
  const [enlarged, setEnlarged] = useState(false);
  const [removing, setRemoving] = useState(false);
  const camera = useRef<HTMLInputElement>(null);
  // Offered under the Inventory search box (F1).
  useEffect(() => noteViewed(item.id), [item.id]);

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
  const stepper = (
    <CountStepper
      value={item.quantity}
      itemName={item.name}
      size="xl"
      onStep={(d) => void adjustQuantity(db, item.id, d).catch(fail)}
      onSet={(n) =>
        setQuantity(db, item.id, n).catch((e: unknown) => {
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
                {!item.hasPhoto && <span class="small muted">Add one so it’s easy to recognize.</span>}
              </div>
            )}
            <PhotoButtons
              hasPhoto={item.hasPhoto}
              cameraRef={camera}
              onPhoto={(p) => changePhoto(p)}
              onRemove={() => setRemoving(true)}
            />
            <span class="small muted">{photoNote(item)}</span>
          </div>
          <div class="dacts">
            <a class="btn pri lg" href={href.edit(item.id)}>
              <Icon name="pencil" />
              Edit item
            </a>
            <a class="btn" href={href.labels([item.id])}>
              <Icon name="print" />
              Print QR label
            </a>
            <DeleteItemButton item={item} />
          </div>
        </div>

        <div class="dright">
          <div class="dchips">
            <span class="chip mut">ID {item.id}</span>
          </div>

          <div class="card box">
            <span class="lbl">Quantity</span>
            <div class="qty">{stepper}</div>
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

        </div>
      </div>

      {enlarged && photo && (
        <Lightbox
          src={photo.url}
          name={item.name}
          note={photoNote(item)}
          onReplace={() => camera.current?.click()}
          onClose={() => setEnlarged(false)}
        />
      )}
      {removing && (
        <Dialog label="Remove photo" role="alertdialog" onClose={() => setRemoving(false)}>
          <h2 class="h2">Remove this photo?</h2>
          <p class="dlg-p">
            The photo is deleted from this phone. Backups made before now still have it.
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
    </>
  );
}

function photoNote(item: Item): string {
  return item.hasPhoto ? '' : 'Photos are optional.';
}

/** Tap-to-enlarge photo. A tap anywhere, Close or Escape closes it. */
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
          Replace photo
        </button>
        <button type="button" class="btn pri lg" autoFocus onClick={props.onClose}>
          <Icon name="close" />
          Close
        </button>
      </div>
    </div>
  );
}
