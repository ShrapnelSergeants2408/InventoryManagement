// Add item (F6) and edit item (F7): one form. Counts, location, notes, category and barcode
// need no PIN; vendor fields are PIN-locked when editing, and open for vendor option 1 while
// adding (§6). Nothing is stored until Save.
import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { addItem, getRecentLocations, updateItem } from '../../../data/items';
import { addLocation } from '../../../data/lists';
import { localIsoDate } from '../../../domain/dates';
import { newTeamId } from '../../../domain/ids';
import {
  MAX_VENDORS,
  UNITS,
  blankVendor,
  buildItem,
  draftFromItem,
  editVendor,
  newDraft,
  removeVendor,
  vendorChangesNeedPin,
  type FormError,
  type ItemDraft,
  type VendorDraft,
} from '../../../domain/item-form';
import { checkName, sortSupplierNames, takenLocationNames } from '../../../domain/lists';
import type { Item } from '../../../domain/types';
import type { InventorySnapshot } from '../../../data/inventory';
import { gate } from '../../../security/gate';
import { isUnlocked } from '../../../security/lock';
import { PinMark, TopBar } from '../../components/common';
import { Dialog, DialogActions } from '../../components/Dialog';
import { useDb, useSnapshot, useThumbnail } from '../../data-hooks';
import { Icon } from '../../icons';
import { goBack, href, openedFrom, replaceRoute } from '../../shell/router';
import { showToast } from '../../shell/toast';
import { StorageError } from '../StorageError';
import { DeleteItemButton } from './DeleteItem';
import { ItemMissing } from './Detail';

const NEW = '__new';

export function EditorScreen(props: { mode: 'add'; name: string } | { mode: 'edit'; id: string }) {
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
  return <Form snap={live.value} base={null} startName={props.name} fallback={fallback} />;
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

function Form(props: { snap: InventorySnapshot; base: Item | null; startName: string; fallback: string }) {
  const db = useDb();
  const { snap } = props;
  const adding = props.base === null;
  // The editor works on the item as it was when opened; later list changes don't reset the form.
  const [base] = useState(props.base);
  const [initial] = useState<ItemDraft>(() => (base ? draftFromItem(base) : newDraft(snap.categories[0]?.name ?? '', props.startName)));
  const [d, setD] = useState<ItemDraft>(initial);
  const [errors, setErrors] = useState<FormError[]>([]);
  // Already unlocked (§6): vendor fields open straight away.
  const [vendorsOpen, setVendorsOpen] = useState(isUnlocked);
  const [busy, setBusy] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  const [newLoc, setNewLoc] = useState<string | null>(null);
  const today = localIsoDate();
  const thumb = useThumbnail(base?.id ?? '', base?.hasPhoto ?? false);

  useEffect(() => {
    void getRecentLocations(db).then(setRecent);
  }, [db]);

  const set = (patch: Partial<ItemDraft>) => setD((prev) => ({ ...prev, ...patch }));
  const setVendor = (i: number, field: keyof VendorDraft, value: string) =>
    setD((prev) => ({ ...prev, vendors: prev.vendors.map((v, j) => (j === i ? editVendor(v, field, value, today) : v)) }));

  const cat = snap.categories.find((c) => c.name === d.category);
  const subs = cat?.subcategories ?? [];
  // An item's own subcategory or unit is kept even if the lists don't have it (e.g. imported).
  const subOptions = d.subcategory && !subs.includes(d.subcategory) ? [...subs, d.subcategory] : subs;
  const units = UNITS.includes(d.unit) || d.unit === '' ? UNITS : [...UNITS, d.unit];
  const suppliers = useMemo(() => sortSupplierNames(snap.suppliers.map((s) => s.name)), [snap.suppliers]);
  const locNames = snap.locations.map((l) => l.name);
  const locOptions = d.location && !locNames.some((n) => n === d.location) ? [...locNames, d.location] : locNames;
  const quickLocs = recent.filter((r) => locNames.includes(r)).slice(0, 5);

  // Vendor fields: open while adding (option 1, F6) or after the PIN; locked otherwise.
  const vLocked = !adding && !vendorsOpen;
  const dirty = JSON.stringify(d) !== JSON.stringify(initial);

  const unlockVendors = async () => {
    if (await gate('Changing suppliers, part numbers, links, pack sizes, prices or the preferred vendor needs the mentor PIN.')) setVendorsOpen(true);
  };
  const addVendorOption = async () => {
    // While adding, only vendor option 1 is free of the PIN (F6); when editing the button
    // only shows once vendors are unlocked.
    if (!vendorsOpen) {
      if (!(await gate('A second or third vendor option needs the mentor PIN.'))) return;
      setVendorsOpen(true);
    }
    setD((prev) => (prev.vendors.length >= MAX_VENDORS ? prev : { ...prev, vendors: [...prev.vendors, blankVendor()] }));
  };

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
    const id = base ? base.id : newTeamId((x) => taken.has(x));
    const r = buildItem(d, { id, base, today, supplierNames: snap.suppliers.map((s) => s.name), categories: snap.categories, vendorsLocked: vLocked });
    if (!r.ok) {
      setErrors(r.errors);
      document.querySelector('.fbody')?.scrollTo({ top: 0 });
      return;
    }
    setErrors([]);
    if (vendorChangesNeedPin(base, r.item) && !vendorsOpen) {
      if (!(await gate('Saving changes to vendors or prices needs the mentor PIN.'))) return;
      setVendorsOpen(true);
    }
    setBusy(true);
    try {
      const saved = base ? await updateItem(db, base, r.item) : await addItem(db, r.item);
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
        kicker={adding ? 'New team item — anyone can add' : `${base!.id} · ${base!.source === 'starter' ? 'starter item' : 'team item'}`}
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
            {base?.hasPhoto && (
              <div class="photo-row">
                {thumb ? <img class="thumbL" src={thumb} alt="Current photo" /> : <span class="thumbL nophoto" />}
                <span class="small muted">Taking, replacing or removing photos comes in a later build (M7).</span>
              </div>
            )}
            <Field id="nm" label="Name" required>
              <input
                id="nm"
                class={errors.some((e) => e.field === 'name') ? 'field bad' : 'field'}
                value={d.name}
                onInput={(e) => set({ name: (e.currentTarget as HTMLInputElement).value })}
                placeholder="e.g. 10-32 x 3/8 in. button head cap screw"
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
                <div class="small muted hint">Anyone can add a subcategory. Renaming or removing one later needs the PIN.</div>
              </Field>
            )}
            <Field id="loc" label="Location" optional>
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
              {newLoc !== null && (
                <>
                  <div class="inline-add">
                    <input
                      class={locCheck && !locCheck.ok ? 'field bad' : 'field'}
                      aria-label="New location name"
                      value={newLoc}
                      onInput={(e) => setNewLoc((e.currentTarget as HTMLInputElement).value)}
                      onKeyDown={(e) => e.key === 'Enter' && void saveNewLocation()}
                      placeholder="New location name — e.g. Bin F17"
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
                  <div class="small muted hint">Anyone can add a location. Renaming, removing and walk order are in More › Locations.</div>
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
            <div>
              <span class="lbl" id="unit-l">
                Unit <span class="req">*</span>
              </span>
              <div class="chips-row" role="radiogroup" aria-labelledby="unit-l">
                {units.map((u) => (
                  <button key={u} type="button" role="radio" aria-checked={d.unit === u} class={d.unit === u ? 'fchip on' : 'fchip'} onClick={() => set({ unit: u })}>
                    {u}
                  </button>
                ))}
              </div>
              <FieldError errors={errors} field="unit" />
            </div>
            <Field id="bc" label="Manufacturer barcode" optional>
              <input
                id="bc"
                class="field"
                inputMode="numeric"
                value={d.barcode}
                onInput={(e) => set({ barcode: (e.currentTarget as HTMLInputElement).value })}
                placeholder="Type the UPC (scanning comes in M8)"
                autoComplete="off"
              />
            </Field>
          </div>

          <div class="ecol">
            <div class="card sec">
              <h2 class="h2">
                Counts <span class="h2-note">— no PIN needed</span>
              </h2>
              <div class="counts">
                <DraftCount label="On hand" value={d.onHand} onChange={(v) => set({ onHand: v })} errors={errors} field="onHand" />
                <DraftCount label="Desired" value={d.desired} onChange={(v) => set({ desired: v })} errors={errors} field="desired" />
                <DraftCount label="Spares" value={d.spares} onChange={(v) => set({ spares: v })} errors={errors} field="spares" />
              </div>
              {adding && <div class="small muted">The on-hand number you enter counts as this item’s first count.</div>}
              <Field id="nt" label="Notes">
                <textarea
                  id="nt"
                  class="field"
                  value={d.notes}
                  onInput={(e) => set({ notes: (e.currentTarget as HTMLTextAreaElement).value })}
                  placeholder="e.g. use with Thrifty swerve · ask a mentor before cutting"
                />
              </Field>
            </div>

            <div class="card sec">
              <div class="vtitle">
                <h2 class="h2">Vendors &amp; prices</h2>
                {vLocked ? (
                  <span class="chip lock">
                    <Icon name="lock" />
                    PIN-locked
                  </span>
                ) : adding && !vendorsOpen ? (
                  <span class="chip open">
                    <Icon name="pencil" />
                    Open for a new item
                  </span>
                ) : (
                  <span class="chip open">
                    <Icon name="unlock" />
                    Unlocked
                  </span>
                )}
              </div>
              {vLocked && (
                <div class="lockbar">
                  <Icon name="lock" />
                  <span class="grow">Mentor PIN needed to change suppliers, part numbers, links, pack sizes, prices or the preferred vendor.</span>
                  <button type="button" class="btn navy sm" onClick={() => void unlockVendors()}>
                    Unlock
                  </button>
                </div>
              )}
              {adding && !vendorsOpen && (
                <div class="lockbar warm">
                  <Icon name="info" />
                  <span class="grow">New item: fill in where to buy it now. Price is optional. After saving, these fields lock behind the PIN.</span>
                </div>
              )}
              {d.vendors.map((v, i) => (
                <VendorCard
                  key={i}
                  n={i + 1}
                  v={v}
                  preferred={i === d.preferred}
                  locked={vLocked}
                  // While adding without the PIN, only option 1 exists and it is the preferred one.
                  canMakePreferred={!vLocked && (vendorsOpen || !adding)}
                  canRemove={!vLocked && d.vendors.length > 1}
                  suppliers={suppliers}
                  errors={errors}
                  onField={(f, value) => setVendor(i, f, value)}
                  onPreferred={() => set({ preferred: i })}
                  onRemove={() => setD((prev) => removeVendor(prev, i))}
                  today={today}
                />
              ))}
              {!vLocked && d.vendors.length < MAX_VENDORS && (
                <button type="button" class="btn" onClick={() => void addVendorOption()}>
                  <Icon name="plus" />
                  Add vendor option ({d.vendors.length} of 3)
                  {!vendorsOpen && <PinMark />}
                </button>
              )}
              <div class="small muted">Supplier list: alphabetical, “other” last. Manage it in More › Suppliers.</div>
            </div>

            {base && <DeleteItemButton item={base} label="Delete this item…" />}
          </div>
        </div>
      </div>

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

function VendorCard(props: {
  n: number;
  v: VendorDraft;
  preferred: boolean;
  locked: boolean;
  canMakePreferred: boolean;
  canRemove: boolean;
  suppliers: string[];
  errors: FormError[];
  onField: (f: keyof VendorDraft, value: string) => void;
  onPreferred: () => void;
  onRemove: () => void;
  today: string;
}) {
  const { v, n, locked } = props;
  const f = (x: string) => `v${n}.${x}`;
  const bad = (x: string) => props.errors.some((e) => e.field === f(x));
  const cls = (x: string) => (bad(x) ? 'field bad' : 'field');
  const id = (x: string) => `v${n}-${x}`;
  const supplierOptions = v.supplier && !props.suppliers.includes(v.supplier) ? [...props.suppliers, v.supplier] : props.suppliers;
  const lock = locked && <Icon name="lock" class="ic" label="PIN-locked" />;
  return (
    <div class={props.preferred ? 'vopt pref' : 'vopt'} role="group" aria-label={`Vendor option ${n}`}>
      <div class="vhead">
        <button type="button" class="radio" role="radio" aria-checked={props.preferred} disabled={!props.canMakePreferred && !props.preferred} onClick={props.onPreferred}>
          <span class="dot">{props.preferred && <span />}</span>
          {props.preferred ? 'Preferred vendor' : 'Make preferred'}
        </button>
        <span class="small muted grow">Option {n} of 3</span>
        {props.canRemove && (
          <button type="button" class="btn sm danger" onClick={props.onRemove}>
            Remove option
          </button>
        )}
      </div>
      <div class="row2">
        <div>
          <label class="lbl" for={id('sup')}>
            Supplier <span class="req">*</span>
            {lock}
          </label>
          <select id={id('sup')} class={cls('supplier')} disabled={locked} value={v.supplier} onChange={(e) => props.onField('supplier', (e.currentTarget as HTMLSelectElement).value)}>
            <option value="">Choose…</option>
            {supplierOptions.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <FieldError errors={props.errors} field={f('supplier')} />
        </div>
        <div>
          <label class="lbl" for={id('part')}>
            Part #{lock}
          </label>
          <input id={id('part')} class="field" disabled={locked} value={v.partNo} onInput={(e) => props.onField('partNo', (e.currentTarget as HTMLInputElement).value)} placeholder="Supplier part number" autoComplete="off" />
        </div>
      </div>
      <div>
        <label class="lbl" for={id('url')}>
          Product page link{lock}
        </label>
        <input id={id('url')} class={cls('url')} disabled={locked} inputMode="url" value={v.url} onInput={(e) => props.onField('url', (e.currentTarget as HTMLInputElement).value)} placeholder="https://…" autoComplete="off" />
        <FieldError errors={props.errors} field={f('url')} />
      </div>
      <div class="row3">
        <div>
          <label class="lbl" for={id('ps')}>
            Pack size{lock}
          </label>
          <input id={id('ps')} class={cls('packSize')} disabled={locked} inputMode="numeric" value={v.packSize} onInput={(e) => props.onField('packSize', (e.currentTarget as HTMLInputElement).value)} autoComplete="off" />
          <FieldError errors={props.errors} field={f('packSize')} />
        </div>
        <div>
          <label class="lbl" for={id('price')}>
            Pack price ${lock}
          </label>
          <input id={id('price')} class={cls('price')} disabled={locked} inputMode="decimal" value={v.price} onInput={(e) => props.onField('price', (e.currentTarget as HTMLInputElement).value)} placeholder="No price" autoComplete="off" />
          <FieldError errors={props.errors} field={f('price')} />
        </div>
        <div>
          <label class="lbl" for={id('chk')}>
            Checked{lock}
          </label>
          <input id={id('chk')} class={cls('priceChecked')} disabled={locked} type="date" max={props.today} value={v.priceChecked} onInput={(e) => props.onField('priceChecked', (e.currentTarget as HTMLInputElement).value)} />
          <FieldError errors={props.errors} field={f('priceChecked')} />
        </div>
      </div>
    </div>
  );
}
