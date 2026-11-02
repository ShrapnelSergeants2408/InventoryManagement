// A record's photos (SPEC v2.0 §8, F16): a swipeable strip at the top of item, bin and spot
// screens. Tap to enlarge. Take or pick more; reorder (the first is the thumbnail), caption and
// delete (after confirming) the one in view. Each change is saved at once.
import { useEffect, useRef, useState } from 'preact/hooks';
import { addPhotos, deletePhoto, movePhoto, setCaption } from '../../data/photos';
import type { PhotoOwner } from '../../domain/types';
import { forgetThumbnail, useDb, usePhotos, type PhotoView } from '../data-hooks';
import { Icon } from '../icons';
import { showToast } from '../shell/toast';
import { Dialog, DialogActions } from './Dialog';
import { PhotoButtons, type PreparedPhoto } from './PhotoButtons';

export function PhotoCarousel(props: { ownerType: PhotoOwner; ownerId: string; name: string }) {
  const db = useDb();
  const photos = usePhotos(props.ownerId);
  const [at, setAt] = useState(0);
  const [enlarged, setEnlarged] = useState(false);
  const [removing, setRemoving] = useState<PhotoView | null>(null);
  const [captioning, setCaptioning] = useState<PhotoView | null>(null);
  const strip = useRef<HTMLDivElement>(null);
  const current = photos[Math.min(at, photos.length - 1)] ?? null;

  // Keep the index in range when photos are removed elsewhere.
  useEffect(() => {
    if (at > 0 && at >= photos.length) setAt(Math.max(0, photos.length - 1));
  }, [photos.length]);

  const fail = (e: unknown) => showToast(`Couldn't save: ${e instanceof Error ? e.message : String(e)}`);
  const changed = () => forgetThumbnail(props.ownerId);
  const show = (i: number) => {
    setAt(i);
    const el = strip.current?.children[i] as HTMLElement | undefined;
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  };
  const add = async (p: PreparedPhoto) => {
    try {
      await addPhotos(db, props.ownerType, props.ownerId, [p]);
      changed();
      showToast('Photo saved.');
      // The new photo is last.
      setTimeout(() => show(photos.length), 50);
    } catch (e) {
      fail(e);
    }
  };
  const move = async (delta: number) => {
    if (!current) return;
    try {
      await movePhoto(db, current.id, delta);
      changed();
      show(at + delta);
    } catch (e) {
      fail(e);
    }
  };

  return (
    <div class="carousel">
      {photos.length === 0 ? (
        <div class="photo nophoto">
          <Icon name="photo" class="ic xxl" />
          <span class="nophoto-t">No photo yet</span>
          <span class="small muted">Add one so it’s easy to recognize.</span>
        </div>
      ) : (
        <div
          class="cstrip"
          ref={strip}
          onScroll={(e) => {
            const el = e.currentTarget as HTMLDivElement;
            const i = Math.round(el.scrollLeft / Math.max(1, el.clientWidth));
            if (i !== at && i >= 0 && i < photos.length) setAt(i);
          }}
        >
          {photos.map((p, i) => (
            <button key={p.id} type="button" class="cphoto" onClick={() => (setAt(i), setEnlarged(true))} aria-label={`Photo ${i + 1} of ${photos.length}: enlarge`}>
              <img src={p.url} alt={p.caption || props.name} />
              {p.caption && <span class="ccap">{p.caption}</span>}
            </button>
          ))}
        </div>
      )}
      {photos.length > 1 && (
        <div class="cdots" aria-hidden="true">
          {photos.map((p, i) => (
            <span key={p.id} class={i === at ? 'on' : undefined} />
          ))}
        </div>
      )}
      <PhotoButtons hasPhoto={false} small addLabel={photos.length ? 'Add photo' : 'Take photo'} onPhoto={(p) => add(p)} onRemove={() => undefined} />
      {current && (
        <div class="pacts">
          <button type="button" class="btn sm" disabled={at === 0} onClick={() => void move(-1)} aria-label="Move this photo earlier">
            <Icon name="chevLeft" />
            {at === 1 ? 'Make first' : 'Earlier'}
          </button>
          <button type="button" class="btn sm" disabled={at >= photos.length - 1} onClick={() => void move(1)} aria-label="Move this photo later">
            Later
            <Icon name="chevRight" />
          </button>
          <button type="button" class="btn sm" onClick={() => setCaptioning(current)}>
            <Icon name="pencil" />
            Caption
          </button>
          <button type="button" class="btn sm" onClick={() => setRemoving(current)}>
            <Icon name="trash" />
            Delete
          </button>
        </div>
      )}

      {enlarged && current && (
        <div class="lb" role="dialog" aria-modal="true" aria-label="Photo" onClick={() => setEnlarged(false)}>
          <img src={current.url} alt={current.caption || props.name} />
          <div class="lb-cap">
            {current.caption || props.name}
            {photos.length > 1 && <div class="small lb-note">{`${at + 1} of ${photos.length}`}</div>}
          </div>
          <div class="lb-acts">
            <button type="button" class="btn pri lg" autoFocus onClick={() => setEnlarged(false)}>
              <Icon name="close" />
              Close
            </button>
          </div>
        </div>
      )}
      {removing && (
        <Dialog label="Delete photo" role="alertdialog" onClose={() => setRemoving(null)}>
          <h2 class="h2">Delete this photo?</h2>
          <p class="dlg-p">It’s deleted from this phone. Backups made before now still have it.</p>
          <DialogActions>
            <button type="button" class="btn lg" data-autofocus onClick={() => setRemoving(null)}>
              Keep photo
            </button>
            <button
              type="button"
              class="btn danger lg"
              onClick={() => {
                const id = removing.id;
                setRemoving(null);
                void deletePhoto(db, id).then(() => (changed(), showToast('Photo deleted.')), fail);
              }}
            >
              <Icon name="trash" />
              Delete photo
            </button>
          </DialogActions>
        </Dialog>
      )}
      {captioning && <CaptionDialog photo={captioning} onClose={() => setCaptioning(null)} onSave={(c) => setCaption(db, captioning.id, c).then(() => setCaptioning(null), fail)} />}
    </div>
  );
}

function CaptionDialog(props: { photo: PhotoView; onClose: () => void; onSave: (caption: string) => Promise<void> }) {
  const [text, setText] = useState(props.photo.caption);
  return (
    <Dialog label="Photo caption" onClose={props.onClose}>
      <form
        class="dlg-form"
        onSubmit={(e) => {
          e.preventDefault();
          void props.onSave(text);
        }}
      >
        <h2 class="h2">Caption</h2>
        <input class="field" aria-label="Caption" value={text} placeholder="e.g. Mantel, left to right" autoComplete="off" onInput={(e) => setText((e.currentTarget as HTMLInputElement).value)} />
        <DialogActions>
          <button type="button" class="btn lg" onClick={props.onClose}>
            Cancel
          </button>
          <button type="submit" class="btn pri lg">
            Save caption
          </button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
