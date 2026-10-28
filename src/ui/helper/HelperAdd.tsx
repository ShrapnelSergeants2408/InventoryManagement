// Add item not on the list (§18.3, mockup 11b): a helper's new item is saved as PENDING with a
// temporary id and sent with the counts; the shop tablet accepts, matches or discards it
// (§18.5). Required: name, category, unit, on hand. Everything else is optional. The helper's
// own form, smaller than the shop tablet's editor: a helper can't set spares, more vendors or
// the preferred vendor, and nothing here needs the PIN.
import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { addPendingItem, type HelperDb } from '../../data/helper-db';
import type { InventorySnapshot } from '../../data/inventory';
import { addLocation } from '../../data/lists';
import { blankPendingDraft, checkPendingItem, type PendingDraft } from '../../domain/helper-mode';
import { UNITS } from '../../domain/item-form';
import { checkName, sortSupplierNames, takenLocationNames } from '../../domain/lists';
import { nameKey } from '../../domain/types';
import { TopBar } from '../components/common';
import { PhotoButtons, type PreparedPhoto } from '../components/PhotoButtons';
import { ScanDialog } from '../components/ScanDialog';
import { useDb, useSnapshot } from '../data-hooks';
import { Icon } from '../icons';
import { showToast } from '../shell/toast';
import { StorageError } from '../screens/StorageError';
import { useHelper } from './session';

const NEW = '\u0000new';
type Errors = Partial<Record<keyof PendingDraft | 'vendor', string>>;

export function HelperAddScreen({ barcode }: { barcode: string }) {
  const live = useSnapshot();
  const helper = useHelper();
  if (live.state === 'error') return <StorageError error={live.error} />;
  if (live.state === 'loading' || !helper) {
    return (
      <div class="state" aria-busy="true">
        <p class="state-text muted">Loading…</p>
      </div>
    );
  }
  if (!helper.kit.allowNewItems) {
    return (
      <>
        <TopBar title="Add item not on the list" back={<Back />} />
        <div class="state">
          <h2 class="h2">This kit doesn’t allow new items</h2>
          <p class="state-text muted">Tell a mentor or the student at the shop tablet about the part instead.</p>
        </div>
      </>
    );
  }
  return <Form snap={live.value} barcode={barcode} />;
}

function Back() {
  return (
    <a class="btn" href="#/count" aria-label="Back to counting">
      <Icon name="chevLeft" />
    </a>
  );
}

function Field(props: { id: string; label: string; required?: boolean; error?: string; children: ComponentChildren }) {
  return (
    <div>
      <label class="lbl" for={props.id}>
        {props.label}
        {props.required && <span class="req">*</span>}
      </label>
      {props.children}
      {props.error && (
        <div class="small err" role="alert">
          {props.error}
        </div>
      )}
    </div>
  );
}

function Form(props: { snap: InventorySnapshot; barcode: string }) {
  const db = useDb() as HelperDb;
  const { snap } = props;
  const [d, setD] = useState<PendingDraft>(() => blankPendingDraft(snap.categories[0]?.name ?? '', props.barcode));
  const [errors, setErrors] = useState<Errors>({});
  const [photo, setPhoto] = useState<PreparedPhoto | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newLoc, setNewLoc] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [vendorOpen, setVendorOpen] = useState(false);
  useEffect(() => {
    const url = photo ? URL.createObjectURL(photo.thumb) : null;
    setPhotoUrl(url);
    return () => void (url && URL.revokeObjectURL(url));
  }, [photo]);

  const set = (patch: Partial<PendingDraft>) => setD((p) => ({ ...p, ...patch }));
  const cat = snap.categories.find((c) => nameKey(c.name) === nameKey(d.category));
  const suppliers = useMemo(() => sortSupplierNames(snap.suppliers.map((s) => s.name)), [snap.suppliers]);
  const locNames = snap.locations.map((l) => l.name);
  const n = /^\d+$/.test(d.onHand.trim()) ? Number(d.onHand) : null;
  const locCheck = newLoc === null || newLoc.trim() === '' ? null : checkName(newLoc, takenLocationNames(locNames), 'Location');

  const addLoc = async () => {
    if (!locCheck?.ok) return;
    try {
      const l = await addLocation(db, locCheck.name);
      set({ location: l.name });
      setNewLoc(null);
      showToast(`Added location “${l.name}”.`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e));
    }
  };

  const save = async (e: Event) => {
    e.preventDefault();
    if (busy) return;
    const ctx = { id: 'check', countedAt: '', categories: snap.categories, locations: snap.locations, supplierNames: suppliers, items: snap.items };
    const first = checkPendingItem(d, ctx);
    if (!first.ok) {
      setErrors(first.errors);
      showToast('Check the fields marked in red.');
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const saved = await addPendingItem(db, (id, countedAt) => ({ ...first.item, id, countedAt }), photo ? { full: photo.full, thumb: photo.thumb } : null);
      showToast(`Saved “${saved.name}” as pending. It goes with your counts.`);
      location.hash = '#/count';
    } catch (err) {
      setBusy(false);
      showToast(`Couldn’t save: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <>
      <TopBar title="Add item not on the list" back={<Back />} />
      <form class="cbody hadd" onSubmit={(e) => void save(e)} noValidate>
        <div class="hinfo">
          <Icon name="info" />
          <span>
            Saved as <span class="chip pend">PENDING</span> on this device and sent with your counts. A mentor or student checks it on the shop tablet before it joins the
            inventory.
          </span>
        </div>
        <Field id="pn" label="Name" required error={errors.name}>
          <input id="pn" class={errors.name ? 'field bad' : 'field'} autoComplete="off" placeholder="e.g. Talon SRX motor controller" value={d.name} onInput={(e) => set({ name: (e.currentTarget as HTMLInputElement).value })} />
        </Field>
        <div class="row2">
          <Field id="pc" label="Category" required error={errors.category}>
            <select id="pc" class="field" value={d.category} onChange={(e) => set({ category: (e.currentTarget as HTMLSelectElement).value, subcategory: '', newSubcategory: null })}>
              {snap.categories.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field id="pu" label="Unit" required error={errors.unit}>
            <select id="pu" class="field" value={d.unit} onChange={(e) => set({ unit: (e.currentTarget as HTMLSelectElement).value })}>
              {UNITS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field id="ps" label="Subcategory" error={errors.subcategory}>
          <select
            id="ps"
            class="field"
            value={d.newSubcategory !== null ? NEW : d.subcategory}
            onChange={(e) => {
              const v = (e.currentTarget as HTMLSelectElement).value;
              set(v === NEW ? { newSubcategory: '', subcategory: '' } : { subcategory: v, newSubcategory: null });
            }}
          >
            <option value="">None</option>
            {(cat?.subcategories ?? []).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
            <option value={NEW}>+ New subcategory…</option>
          </select>
        </Field>
        {d.newSubcategory !== null && (
          <Field id="pns" label={`New subcategory in ${d.category}`} error={errors.newSubcategory}>
            <input id="pns" class={errors.newSubcategory ? 'field bad' : 'field'} autoComplete="off" value={d.newSubcategory} onInput={(e) => set({ newSubcategory: (e.currentTarget as HTMLInputElement).value })} />
          </Field>
        )}
        <div>
          <span class="lbl" id="poh-l">
            On hand<span class="req">*</span> · tap − / + or type
          </span>
          <div class="stepper-row" role="group" aria-labelledby="poh-l">
            <button type="button" class="step" aria-label="On hand minus one" disabled={n === null || n <= 0} onClick={() => n !== null && set({ onHand: String(n - 1) })}>
              <Icon name="minus" />
            </button>
            <input
              class={errors.onHand ? 'num bad' : 'num'}
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="off"
              aria-label="On hand"
              placeholder="0"
              value={d.onHand}
              onFocus={(e) => (e.currentTarget as HTMLInputElement).select()}
              onInput={(e) => set({ onHand: (e.currentTarget as HTMLInputElement).value })}
            />
            <button type="button" class="step plus" aria-label="On hand plus one" onClick={() => set({ onHand: String((n ?? 0) + 1) })}>
              <Icon name="plus" />
            </button>
          </div>
          {errors.onHand && (
            <div class="small err" role="alert">
              {errors.onHand}
            </div>
          )}
        </div>
        <div>
          <span class="lbl">Photo (helps the reviewer)</span>
          <div class="photo-row">
            {photoUrl ? (
              <img class="thumbL" src={photoUrl} alt="New photo" />
            ) : (
              <span class="thumbL nophoto">
                <Icon name="photo" class="ic xl" />
              </span>
            )}
            <PhotoButtons small hasPhoto={photo !== null} retakeLabel="Retake photo" onPhoto={(p) => setPhoto(p)} onRemove={() => setPhoto(null)} />
          </div>
        </div>
        <Field id="pl" label="Location" error={errors.location}>
          <div class="inline-add">
            <select id="pl" class="field" value={d.location} onChange={(e) => set({ location: (e.currentTarget as HTMLSelectElement).value })}>
              <option value="">No location</option>
              {locNames.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
            {newLoc === null && (
              <button type="button" class="btn" onClick={() => setNewLoc('')}>
                <Icon name="plus" />
                New location…
              </button>
            )}
          </div>
          {newLoc !== null && (
            <div class="inline-add">
              <input class={locCheck && !locCheck.ok ? 'field bad' : 'field'} aria-label="New location name" autoFocus autoComplete="off" placeholder="e.g. Bin F17" value={newLoc} onInput={(e) => setNewLoc((e.currentTarget as HTMLInputElement).value)} />
              <button type="button" class="btn" disabled={!locCheck?.ok} onClick={() => void addLoc()}>
                Add
              </button>
              <button type="button" class="btn" onClick={() => setNewLoc(null)}>
                Cancel
              </button>
            </div>
          )}
          {locCheck && !locCheck.ok && <div class="small err">{locCheck.error}</div>}
        </Field>
        <Field id="pb" label="Barcode" error={errors.barcode}>
          <div class="inline-add">
            <input id="pb" class={errors.barcode ? 'field mono bad' : 'field mono'} autoComplete="off" placeholder="Manufacturer barcode, if there is one" value={d.barcode} onInput={(e) => set({ barcode: (e.currentTarget as HTMLInputElement).value })} />
            <button type="button" class="btn" onClick={() => setScanning(true)}>
              <Icon name="scan" />
              Scan
            </button>
          </div>
        </Field>
        {scanning && (
          <ScanDialog
            onClose={() => setScanning(false)}
            onCode={(code) => {
              set({ barcode: code });
              setScanning(false);
            }}
          />
        )}
        <Field id="pd" label="Desired (how many the team needs; 0 if unsure)" error={errors.desired}>
          <input id="pd" class={errors.desired ? 'field bad' : 'field'} type="text" inputMode="numeric" autoComplete="off" value={d.desired} onInput={(e) => set({ desired: (e.currentTarget as HTMLInputElement).value })} />
        </Field>
        <Field id="pno" label="Notes">
          <textarea id="pno" class="field ta" rows={3} placeholder="Where you found it, what it’s for…" value={d.notes} onInput={(e) => set({ notes: (e.currentTarget as HTMLTextAreaElement).value })} />
        </Field>
        {vendorOpen ? (
          <div class="card sec hvendor">
            <h2 class="h2">Vendor (optional)</h2>
            <Field id="pvs" label="Supplier" error={errors.supplier}>
              <select id="pvs" class={errors.supplier ? 'field bad' : 'field'} value={d.supplier} onChange={(e) => set({ supplier: (e.currentTarget as HTMLSelectElement).value })}>
                <option value="">Choose…</option>
                {suppliers.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </Field>
            <Field id="pvp" label="Part #">
              <input id="pvp" class="field" autoComplete="off" value={d.partNo} onInput={(e) => set({ partNo: (e.currentTarget as HTMLInputElement).value })} />
            </Field>
            <Field id="pvu" label="Product page link" error={errors.url}>
              <input id="pvu" class={errors.url ? 'field bad' : 'field'} type="url" autoComplete="off" value={d.url} onInput={(e) => set({ url: (e.currentTarget as HTMLInputElement).value })} />
            </Field>
            <div class="row2">
              <Field id="pvk" label="Pack size" error={errors.packSize}>
                <input id="pvk" class={errors.packSize ? 'field bad' : 'field'} inputMode="numeric" autoComplete="off" value={d.packSize} onInput={(e) => set({ packSize: (e.currentTarget as HTMLInputElement).value })} />
              </Field>
              <Field id="pvr" label="Pack price ($)" error={errors.price}>
                <input id="pvr" class={errors.price ? 'field bad' : 'field'} inputMode="decimal" autoComplete="off" value={d.price} onInput={(e) => set({ price: (e.currentTarget as HTMLInputElement).value })} />
              </Field>
            </div>
          </div>
        ) : (
          <div>
            <button type="button" class="btn" onClick={() => setVendorOpen(true)}>
              <Icon name="plus" />
              Add supplier and part # (optional)
            </button>
          </div>
        )}
        <div class="wacts hadd-acts">
          <a class="btn lg" href="#/count">
            Cancel
          </a>
          <button type="submit" class="btn pri lg wsave" disabled={busy}>
            Save as pending
          </button>
        </div>
      </form>
    </>
  );
}
