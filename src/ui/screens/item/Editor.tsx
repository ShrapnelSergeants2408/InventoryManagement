// Add and edit an item: one form. Nothing is stored until Save, including a photo taken or
// removed here.
import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { addItem, getRecentLocations, updateItem } from '../../../data/items';
import { addLocation } from '../../../data/lists';
import type { PhotoChange } from '../../../data/photos';
import { newItemId } from '../../../domain/ids';
import { buildItem, draftFromItem, newDraft, type FormError, type ItemDraft } from '../../../domain/item-form';
import { checkName, takenLocationNames } from '../../../domain/lists';
import { nameKey, type Item } from '../../../domain/types';
import type { InventorySnapshot } from '../../../data/inventory';
import { TopBar } from '../../components/common';
import { Dialog, DialogActions } from '../../components/Dialog';
import { PhotoButtons } from '../../components/PhotoButtons';
import { LocationScanDialog } from '../../components/LocationScanDialog';
import { ScanDialog } from '../../components/ScanDialog';
import { forgetThumbnail, useDb, useSnapshot, useThumbnail } from '../../data-hooks';
import { Icon } from '../../icons';
import { goBack, href, openedFrom, replaceRoute } from '../../shell/router';
import { showToast } from '../../shell/toast';
import { StorageError } from '../StorageError';
import { DeleteItemButton } from './DeleteItem';
import { ItemMissing } from './Detail';

const NEW = '__new';

export function EditorScreen(props: { mode: 'add'; name: string; barcode?: string } | { mode: 'edit'; id: string }) {
  const live = useSnapshot();
  const fallback = props.mode === 'edit' ? href.item(props.id) : href.tab('inventory');
  const cancel = (
    <button type="button" class="btn" onClick={() => goBack(fallback)}>
      <Icon name="close" />
      Cancel
    </button>
  );
  if (live.state === 'error') {
    return (
      <>
        <TopBar title={props.mode === 'add' ? 'Add item' : 'Edit item'} back={cancel} />
        <StorageError error={live.error} />
      </>
    );
  }
  if (live.state === 'loading') {
    return (
      <>
        <TopBar title={props.mode === 'add' ? 'Add item' : 'Edit item'} kicker="" back={cancel} />
        <div class="state" aria-busy="true">
          <p class="state-text muted">Loading…</p>
        </div>
      </>
    );
  }
  if (props.mode === 'edit') {
    const item = live.value.items.find((i) => i.id === props.id);
    if (!item) return <ItemMissing id={props.id} back={cancel} />;
    return <Form snap={live.value} base={item} startName="" fallback={fallback} />;
  }
  return <Form snap={live.value} base={null} startName={props.name} startBarcode={props.barcode ?? ''} fallback={fallback} />;
}

/** Field-level message under an input. */
function FieldError({ errors, field }: { errors: FormError[]; field: string }) {
  const e = errors.find((x) => x.field === field);
  if (!e) return null;
  return (
    <div class="err">
      <Icon name="short" />
      {e.message}
    </div>
  );
}

function Form(props: { snap: InventorySnapshot; base: Item | null; startName: string; startBarcode?: string; fallback: string }) {
  const db = useDb();
  const { snap } = props;
  const adding = props.base === null;
  // The editor works on the item as it was when opened; later list changes don't reset the form.
  const [base] = useState(props.base);
  const [initial] = useState<ItemDraft>(() =>
    base ? draftFromItem(base, snap.categories) : { ...newDraft(snap.categories[0]?.name ?? '', props.startName), barcode: props.startBarcode ?? '' },
  );
  const [d, setD] = useState<ItemDraft>(initial);
  const [errors, setErrors] = useState<FormError[]>([]);
  const [busy, setBusy] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  const [newLoc, setNewLoc] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanningLoc, setScanningLoc] = useState(false);
  const thumb = useThumbnail(base?.id ?? '', base?.hasPhoto ?? false);
  // A photo taken or removed in the form; undefined keeps the stored one.
  const [photo, setPhotoChange] = useState<PhotoChange | undefined>(undefined);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  useEffect(() => {
    const url = photo && photo !== 'remove' ? URL.createObjectURL(photo.thumb ?? photo.full) : null;
    setPhotoUrl(url);
    return () => void (url && URL.revokeObjectURL(url));
  }, [photo]);
  const shownPhoto = photo === 'remove' ? null : photo ? photoUrl : base?.hasPhoto ? thumb : null;
  const showsPhoto = photo === undefined ? (base?.hasPhoto ?? false) : photo !== 'remove';

  useEffect(() => {
    void getRecentLocations(db).then(setRecent);
  }, [db]);

  const set = (patch: Partial<ItemDraft>) => setD((prev) => ({ ...prev, ...patch }));

  const cat = snap.categories.find((c) => nameKey(c.name) === nameKey(d.category));
  const subs = cat?.subcategories ?? [];
  // An item's own subcategory is kept even if the list doesn't have it (e.g. restored).
  const subOptions = d.subcategory && !subs.some((s) => nameKey(s) === nameKey(d.subcategory)) ? [...subs, d.subcategory] : subs;
  const locNames = snap.locations.map((l) => l.name);
  const locOptions = d.location && !locNames.some((n) => n === d.location) ? [...locNames, d.location] : locNames;
  const quickLocs = recent.filter((r) => locNames.includes(r)).slice(0, 5);

  const dirty = JSON.stringify(d) !== JSON.stringify(initial) || photo !== undefined;

  const locCheck = newLoc === null || newLoc.trim() === '' ? null : checkName(newLoc, takenLocationNames(locNames), 'Location');
  const saveNewLocation = async () => {
    if (!locCheck || !locCheck.ok) return;
    try {
      const loc = await addLocation(db, locCheck.name);
      set({ location: loc.name });
      setNewLoc(null);
      showToast(`Added location “${loc.name}”.`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e));
    }
  };

  const save = async () => {
    if (busy) return;
    const taken = new Set(snap.items.map((i) => i.id));
    const id = base ? base.id : newItemId((x) => taken.has(x));
    const r = buildItem(d, { id, base, categories: snap.categories });
    if (!r.ok) {
      setErrors(r.errors);
      document.querySelector('.fbody')?.scrollTo({ top: 0 });
      return;
    }
    setErrors([]);
    setBusy(true);
    try {
      const saved = base ? await updateItem(db, base, r.item, undefined, photo) : await addItem(db, r.item, undefined, photo);
      if (photo) forgetThumbnail(saved.id);
      showToast(base ? 'Saved.' : `Added “${saved.name}”.`);
      // Opened from this item's card: go back to it. Otherwise (a new item, or the editor
      // opened directly) the card replaces the form, so Back never returns to the form.
      if (base && openedFrom() === href.item(saved.id)) history.back();
      else replaceRoute(href.item(saved.id));
    } catch (e) {
      setBusy(false);
      showToast(`Couldn't save: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const cancel = () => (dirty ? setDiscarding(true) : goBack(props.fallback));

  return (
    <>
      <TopBar
        title={adding ? 'Add item' : d.name.trim() || base!.name}
        kicker={adding ? 'New item' : base!.id}
        back={
          <button type="button" class="btn" onClick={cancel}>
            <Icon name="close" />
            Cancel
          </button>
        }
        actions={
          <button type="button" class="btn pri lg" disabled={busy} onClick={() => void save()}>
            <Icon name="check" />
            {adding ? 'Add item' : 'Save'}
          </button>
        }
      />
      <div class="fbody">
        {errors.length > 0 && (
          <div class="errsum" role="alert">
            <strong>
              Fix {errors.length === 1 ? '1 thing' : `${errors.length} things`} before saving
            </strong>
            <ul>
              {errors.map((e) => (
                <li key={e.field + e.message}>{e.message}</li>
              ))}
            </ul>
          </div>
        )}
        <div class="egrid">
          <div class="card sec">
            <h2 class="h2">Item</h2>
            <div class="photo-row">
              {shownPhoto ? (
                <img class="thumbL" src={shownPhoto} alt={photo ? 'New photo' : 'Current photo'} />
              ) : (
                <span class="thumbL nophoto">
                  <Icon name="photo" class="ic xl" />
                </span>
              )}
              <div class="photo-side">
                <PhotoButtons
                  small
                  hasPhoto={showsPhoto}
                  retakeLabel="Take photo"
                  onPhoto={(p) => setPhotoChange(p)}
                  // Removing a photo taken in this form just drops it; a stored one is removed on Save.
                  onRemove={() => setPhotoChange(base?.hasPhoto ? 'remove' : undefined)}
                />
                <span class="small muted">
                  {photo === 'remove' ? 'The photo is removed when you save.' : photo ? 'New photo: saved with the item.' : 'Optional; one per item.'}
                </span>
              </div>
            </div>
            <Field id="nm" label="Name" required>
              <input
                id="nm"
                class={errors.some((e) => e.field === 'name') ? 'field bad' : 'field'}
                value={d.name}
                onInput={(e) => set({ name: (e.currentTarget as HTMLInputElement).value })}
                placeholder="e.g. Snowman string lights"
                autoComplete="off"
              />
              <FieldError errors={errors} field="name" />
            </Field>
            <div class="row2">
              <Field id="cat" label="Category" required>
                <select id="cat" class="field" value={d.category} onChange={(e) => set({ category: (e.currentTarget as HTMLSelectElement).value, subcategory: '', newSubcategory: null })}>
                  {snap.categories.map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <FieldError errors={errors} field="category" />
              </Field>
              <Field id="sub" label="Subcategory">
                <select
                  id="sub"
                  class="field"
                  value={d.newSubcategory !== null ? NEW : d.subcategory}
                  onChange={(e) => {
                    const v = (e.currentTarget as HTMLSelectElement).value;
                    set(v === NEW ? { newSubcategory: '' } : { subcategory: v, newSubcategory: null });
                  }}
                >
                  <option value="">None</option>
                  {subOptions.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                  <option value={NEW}>+ New subcategory…</option>
                </select>
              </Field>
            </div>
            {d.newSubcategory !== null && (
              <Field id="ns" label={`New subcategory in ${d.category}`}>
                <input
                  id="ns"
                  class={errors.some((e) => e.field === 'newSubcategory') ? 'field bad' : 'field'}
                  value={d.newSubcategory}
                  onInput={(e) => set({ newSubcategory: (e.currentTarget as HTMLInputElement).value })}
                  placeholder="Name of the new subcategory"
                  autoComplete="off"
                />
                <FieldError errors={errors} field="newSubcategory" />
              </Field>
            )}
            <Field id="loc" label="Location" optional>
              <div class="inline-add">
                <select
                  id="loc"
                  class="field"
                  value={newLoc !== null ? NEW : d.location}
                  onChange={(e) => {
                    const v = (e.currentTarget as HTMLSelectElement).value;
                    if (v === NEW) setNewLoc('');
                    else {
                      setNewLoc(null);
                      set({ location: v });
                    }
                  }}
                >
                  <option value="">No location</option>
                  {locOptions.map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                  <option value={NEW}>+ New location…</option>
                </select>
                {/* F29: the bin's QR code holds the location's name. */}
                <button type="button" class="btn" aria-label="Scan a location" onClick={() => setScanningLoc(true)}>
                  <Icon name="scan" />
                  Scan
                </button>
              </div>
              {newLoc !== null && (
                <>
                  <div class="inline-add">
                    <input
                      class={locCheck && !locCheck.ok ? 'field bad' : 'field'}
                      aria-label="New location name"
                      value={newLoc}
                      onInput={(e) => setNewLoc((e.currentTarget as HTMLInputElement).value)}
                      onKeyDown={(e) => e.key === 'Enter' && void saveNewLocation()}
                      placeholder="New location name — e.g. Attic shelf B"
                      autoComplete="off"
                    />
                    <button type="button" class="btn" disabled={!locCheck?.ok} onClick={() => void saveNewLocation()}>
                      Add
                    </button>
                  </div>
                  {locCheck && !locCheck.ok && (
                    <div class="err" role="alert">
                      {locCheck.error}
                    </div>
                  )}
                  <div class="small muted hint">Renaming, removing and walk order are in More › Locations.</div>
                </>
              )}
              {quickLocs.length > 0 && (
                <div class="chips-row">
                  <span class="small muted">Recent:</span>
                  {quickLocs.map((l) => (
                    <button key={l} type="button" class={d.location === l ? 'fchip on' : 'fchip'} aria-pressed={d.location === l} onClick={() => {
                        setNewLoc(null);
                        set({ location: l });
                      }}>
                      {l}
                    </button>
                  ))}
                </div>
              )}
            </Field>
            <Field id="bc" label="Product barcode" optional>
              <div class="inline-add">
                <input
                  id="bc"
                  class="field"
                  inputMode="numeric"
                  value={d.barcode}
                  onInput={(e) => set({ barcode: (e.currentTarget as HTMLInputElement).value })}
                  placeholder="Type or scan the UPC"
                  autoComplete="off"
                />
                <button type="button" class="btn" onClick={() => setScanning(true)}>
                  <Icon name="scan" />
                  Scan
                </button>
              </div>
            </Field>
          </div>

          <div class="ecol">
            <div class="card sec">
              <h2 class="h2">Quantity and notes</h2>
              <div class="counts">
                <DraftCount label="Quantity" value={d.quantity} onChange={(v) => set({ quantity: v })} errors={errors} field="quantity" />
              </div>
              <Field id="nt" label="Notes">
                <textarea
                  id="nt"
                  class="field"
                  value={d.notes}
                  onInput={(e) => set({ notes: (e.currentTarget as HTMLTextAreaElement).value })}
                  placeholder="e.g. left strand is dim · goes on the mantel"
                />
              </Field>
            </div>

            {base && <DeleteItemButton item={base} label="Delete this item…" />}
          </div>
        </div>
      </div>

      {scanning && (
        <ScanDialog
          onClose={() => setScanning(false)}
          onCode={(code) => {
            set({ barcode: code });
            setScanning(false);
            showToast(`Barcode ${code} filled in. Save to keep it.`);
          }}
        />
      )}
      {scanningLoc && (
        <LocationScanDialog
          locations={snap.locations}
          notFound="offer"
          onClose={() => setScanningLoc(false)}
          onPicked={(l, how) => {
            setNewLoc(null);
            set({ location: l.name });
            setScanningLoc(false);
            if (how === 'found') showToast(`Location set to ${l.name}. Save to keep it.`);
          }}
        />
      )}
      {discarding && (
        <Dialog label="Discard changes" onClose={() => setDiscarding(false)}>
          <h2 class="h2">Discard your changes?</h2>
          <p class="dlg-p">{adding ? 'The new item hasn’t been added yet.' : 'Your changes to this item haven’t been saved.'}</p>
          <DialogActions>
            <button type="button" class="btn lg" data-autofocus onClick={() => setDiscarding(false)}>
              Keep editing
            </button>
            <button type="button" class="btn danger lg" onClick={() => goBack(props.fallback)}>
              Discard changes
            </button>
          </DialogActions>
        </Dialog>
      )}
    </>
  );
}

function Field(props: { id: string; label: string; required?: boolean; optional?: boolean; children: ComponentChildren }) {
  return (
    <div>
      <label class="lbl" for={props.id}>
        {props.label}
        {props.required && <span class="req">*</span>}
        {props.optional && <span class="lbl-opt">(optional)</span>}
      </label>
      {props.children}
    </div>
  );
}

/** A count in the form: −, typed number, +. Stored only when the form is saved. */
function DraftCount(props: { label: string; value: string; onChange: (v: string) => void; errors: FormError[]; field: string }) {
  const n = /^\d+$/.test(props.value.trim()) ? Number(props.value) : null;
  const bad = props.errors.some((e) => e.field === props.field);
  return (
    <div class="count-line">
      <span class="lbl" id={`${props.field}-l`}>
        {props.label}
      </span>
      <div class="stepper-row" role="group" aria-labelledby={`${props.field}-l`}>
        <button type="button" class="step" aria-label={`${props.label} minus one`} disabled={n === null || n <= 0} onClick={() => n !== null && props.onChange(String(n - 1))}>
          <Icon name="minus" />
        </button>
        <input
          class={bad ? 'num bad' : 'num'}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          aria-label={props.label}
          value={props.value}
          onFocus={(e) => (e.currentTarget as HTMLInputElement).select()}
          onInput={(e) => props.onChange((e.currentTarget as HTMLInputElement).value)}
        />
        <button type="button" class="step plus" aria-label={`${props.label} plus one`} disabled={n === null} onClick={() => n !== null && props.onChange(String(n + 1))}>
          <Icon name="plus" />
        </button>
      </div>
    </div>
  );
}
