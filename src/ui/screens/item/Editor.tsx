// Add and edit an item (F16): one form. Nothing is stored until Save, including photos taken or
// removed here. Status (out, lent) is changed by its own actions in later milestones (H4–H8). The
// form works in the item's part (a new item: its home's part, else the part in use); moving it to
// the other part is Move on its card (F7).
import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { addItem, getRecentHomes, updateItem } from '../../../data/items';
import type { InventorySnapshot } from '../../../data/inventory';
import type { NewPhoto } from '../../../data/photos';
import { ID_PREFIX, newId } from '../../../domain/ids';
import { buildItem, draftFromItem, newDraft, type FormError, type ItemDraft } from '../../../domain/item-form';
import { partOfRecord, partView } from '../../../domain/parts';
import { indexPlaces, itemPath, NO_HOME, pathText } from '../../../domain/places';
import { CONDITIONS, nameKey, type Condition, type Item, type Part } from '../../../domain/types';
import { TopBar } from '../../components/common';
import { CONDITION_LABEL } from '../../components/chips';
import { Dialog, DialogActions } from '../../components/Dialog';
import { HomePicker } from '../../components/HomePicker';
import { PhotoButtons } from '../../components/PhotoButtons';
import { ScanDialog } from '../../components/ScanDialog';
import { forgetThumbnail, useDb, usePhotos, useSnapshot } from '../../data-hooks';
import { Icon } from '../../icons';
import { goBack, href, openedFrom, replaceRoute } from '../../shell/router';
import { getPart, useRecordPart } from '../../part';
import { showToast } from '../../shell/toast';
import { StorageError } from '../StorageError';
import { DeleteItemButton } from './DeleteItem';
import { ItemMissing } from './Detail';

const NEW = '__new';

export function EditorScreen(props: { mode: 'add'; name: string; barcode?: string; home?: string } | { mode: 'edit'; id: string }) {
  const live = useSnapshot();
  const fallback = props.mode === 'edit' ? href.item(props.id) : href.home(getPart());
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
    return <Form all={live.value} part={item.part} base={item} startName="" fallback={fallback} />;
  }
  // "Add item here" names a bin or spot that may have gone meanwhile.
  const home = props.home && (live.value.bins.some((b) => b.id === props.home) || live.value.spots.some((s) => s.id === props.home)) ? props.home : '';
  const part: Part = (home && partOfRecord(live.value, home)) || getPart();
  return <Form all={live.value} part={part} base={null} startName={props.name} startBarcode={props.barcode ?? ''} startHome={home} fallback={fallback} />;
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

interface PendingPhoto extends NewPhoto {
  key: number;
  url: string;
}

function Form(props: { all: InventorySnapshot; part: Part; base: Item | null; startName: string; startBarcode?: string; startHome?: string; fallback: string }) {
  const db = useDb();
  const { part } = props;
  const snap = partView(props.all, part);
  useRecordPart(part);
  const adding = props.base === null;
  // The editor works on the item as it was when opened; later list changes don't reset the form.
  const [base] = useState(props.base);
  const [initial] = useState<ItemDraft>(() =>
    base ? draftFromItem(base, snap.categories) : { ...newDraft(snap.categories[0]?.name ?? '', props.startName, props.startHome ?? ''), barcode: props.startBarcode ?? '' },
  );
  const [d, setD] = useState<ItemDraft>(initial);
  const [errors, setErrors] = useState<FormError[]>([]);
  const [busy, setBusy] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  const [picking, setPicking] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [tagText, setTagText] = useState('');
  // Photos: stored ones (edit) can be marked for removal; new ones wait for Save.
  const stored = usePhotos(base?.id ?? '');
  const [removed, setRemoved] = useState<string[]>([]);
  const [pending, setPending] = useState<PendingPhoto[]>([]);
  useEffect(() => () => pending.forEach((p) => URL.revokeObjectURL(p.url)), []);

  useEffect(() => {
    void getRecentHomes(db).then(setRecent);
  }, [db]);

  const set = (patch: Partial<ItemDraft>) => setD((prev) => ({ ...prev, ...patch }));

  const cat = snap.categories.find((c) => nameKey(c.name) === nameKey(d.category));
  const subs = cat?.subcategories ?? [];
  // An item's own subcategory is kept even if the list doesn't have it (e.g. restored).
  const subOptions = d.subcategory && !subs.some((s) => nameKey(s) === nameKey(d.subcategory)) ? [...subs, d.subcategory] : subs;
  const ix = indexPlaces(snap);
  const homeFields = { binId: d.home.startsWith(ID_PREFIX.bin) ? d.home : '', spotId: d.home.startsWith(ID_PREFIX.spot) ? d.home : '' };
  const homeText = d.home ? pathText(itemPath(homeFields, ix)) : NO_HOME;
  const binSeason = homeFields.binId ? snap.seasons.find((s) => s.id === ix.bin.get(homeFields.binId)?.seasonId) : undefined;
  const tagSuggestions = snap.tags.filter((t) => !d.tags.some((x) => nameKey(x) === nameKey(t.name)) && (tagText.trim() === '' || nameKey(t.name).includes(nameKey(tagText))));

  const dirty = JSON.stringify(d) !== JSON.stringify(initial) || pending.length > 0 || removed.length > 0;

  const addTag = (raw: string) => {
    const t = raw.trim();
    if (t === '' || d.tags.some((x) => nameKey(x) === nameKey(t))) return setTagText('');
    const listed = snap.tags.find((x) => nameKey(x.name) === nameKey(t));
    set({ tags: [...d.tags, listed?.name ?? t] });
    setTagText('');
  };

  const save = async () => {
    if (busy) return;
    const taken = new Set(props.all.items.map((i) => i.id));
    const id = base ? base.id : newId(ID_PREFIX.item, (x) => taken.has(x));
    const r = buildItem(tagText.trim() ? { ...d, tags: [...d.tags, tagText] } : d, { id, base, categories: snap.categories, part });
    if (!r.ok) {
      setErrors(r.errors);
      document.querySelector('.fbody')?.scrollTo({ top: 0 });
      return;
    }
    setErrors([]);
    setBusy(true);
    try {
      const photos = { add: pending.map(({ full, thumb }) => ({ full, thumb })), remove: removed };
      const saved = base ? await updateItem(db, base, r.item, undefined, photos) : await addItem(db, r.item, undefined, photos);
      if (pending.length || removed.length) forgetThumbnail(saved.id);
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
  const shownStored = stored.filter((p) => !removed.includes(p.id));

  return (
    <>
      <TopBar
        part={part}
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
            <strong>Fix {errors.length === 1 ? '1 thing' : `${errors.length} things`} before saving</strong>
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
            <div class="photo-strip" aria-label="Photos">
              {shownStored.map((p) => (
                <span class="pthumb" key={p.id}>
                  <img src={p.url} alt="" />
                  <button type="button" class="ib" aria-label="Remove this photo when saving" onClick={() => setRemoved([...removed, p.id])}>
                    <Icon name="close" />
                  </button>
                </span>
              ))}
              {pending.map((p) => (
                <span class="pthumb new" key={p.key}>
                  <img src={p.url} alt="" />
                  <button
                    type="button"
                    class="ib"
                    aria-label="Drop this new photo"
                    onClick={() => {
                      URL.revokeObjectURL(p.url);
                      setPending(pending.filter((x) => x !== p));
                    }}
                  >
                    <Icon name="close" />
                  </button>
                </span>
              ))}
              {shownStored.length + pending.length === 0 && (
                <span class="thumbL nophoto">
                  <Icon name="photo" class="ic xl" />
                </span>
              )}
            </div>
            <PhotoButtons
              small
              hasPhoto={false}
              addLabel={shownStored.length + pending.length ? 'Add photo' : 'Take photo'}
              onPhoto={(p) => setPending([...pending, { ...p, key: Date.now(), url: URL.createObjectURL(p.thumb ?? p.full) }])}
              onRemove={() => undefined}
            />
            <span class="small muted">
              {removed.length || pending.length ? 'Photo changes are saved with the item.' : 'Optional. The first photo is the thumbnail; reorder and caption them on the item screen.'}
            </span>
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
            <Field id="home" label="Home" optional>
              <button id="home" type="button" class="btn field-btn" onClick={() => setPicking(true)}>
                <Icon name="pin" />
                <span class="grow">{homeText}</span>
                <Icon name="chevRight" />
              </button>
              <FieldError errors={errors} field="home" />
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
              <h2 class="h2">Quantity and condition</h2>
              <div class="counts">
                <DraftCount label="Quantity" value={d.quantity} onChange={(v) => set({ quantity: v })} errors={errors} field="quantity" />
              </div>
              <label class="tick">
                <input type="checkbox" checked={d.approx} onChange={(e) => set({ approx: (e.currentTarget as HTMLInputElement).checked })} />
                <span>About this many (a bulk line, shown as “~{d.quantity || 0}”)</span>
              </label>
              <Field id="cond" label="Condition">
                <select id="cond" class="field" value={d.condition} onChange={(e) => set({ condition: (e.currentTarget as HTMLSelectElement).value as Condition })}>
                  {CONDITIONS.map((c) => (
                    <option key={c} value={c}>
                      {CONDITION_LABEL[c]}
                    </option>
                  ))}
                </select>
              </Field>
              {d.condition !== 'ok' && (
                <Field id="cn" label="What’s wrong" optional>
                  <input id="cn" class="field" value={d.conditionNote} placeholder="e.g. left strand dead" autoComplete="off" onInput={(e) => set({ conditionNote: (e.currentTarget as HTMLInputElement).value })} />
                </Field>
              )}
            </div>

            <div class="card sec">
              <h2 class="h2">{part === 'holiday' ? 'Season, tags and notes' : 'Tags and notes'}</h2>
              {part === 'holiday' && (
              <Field id="sea" label="Season" optional>
                <select id="sea" class="field" value={d.seasonId} onChange={(e) => set({ seasonId: (e.currentTarget as HTMLSelectElement).value })}>
                  <option value="">{binSeason ? `Same as its bin (${binSeason.name})` : 'None'}</option>
                  {snap.seasons.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </Field>
              )}
              {part === 'holiday' && (
                <Field id="dsp" label="Usual display (where it goes when it’s out)" optional>
                  <select id="dsp" class="field" value={d.displayId} onChange={(e) => set({ displayId: (e.currentTarget as HTMLSelectElement).value })}>
                    <option value="">None</option>
                    {snap.displays.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                  </select>
                  {snap.displays.length === 0 && <span class="small muted">Add displays in More › Displays.</span>}
                </Field>
              )}
              <Field id="tg" label="Tags" optional>
                <div class="chips-row">
                  {d.tags.map((t) => (
                    <button key={t} type="button" class="fchip on" aria-label={`Remove tag ${t}`} onClick={() => set({ tags: d.tags.filter((x) => x !== t) })}>
                      {t}
                      <Icon name="close" />
                    </button>
                  ))}
                </div>
                <div class="inline-add">
                  <input
                    id="tg"
                    class={errors.some((e) => e.field === 'tags') ? 'field bad' : 'field'}
                    value={tagText}
                    placeholder="Add a tag — e.g. Fragile"
                    autoComplete="off"
                    onInput={(e) => setTagText((e.currentTarget as HTMLInputElement).value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addTag(tagText);
                      }
                    }}
                  />
                  <button type="button" class="btn" disabled={tagText.trim() === ''} onClick={() => addTag(tagText)}>
                    Add
                  </button>
                </div>
                {tagSuggestions.length > 0 && (
                  <div class="chips-row">
                    {tagSuggestions.slice(0, 8).map((t) => (
                      <button key={t.name} type="button" class="fchip" onClick={() => addTag(t.name)}>
                        <Icon name="plus" />
                        {t.name}
                      </button>
                    ))}
                  </div>
                )}
                <FieldError errors={errors} field="tags" />
              </Field>
              <Field id="nt" label="Notes">
                <textarea id="nt" class="field" value={d.notes} onInput={(e) => set({ notes: (e.currentTarget as HTMLTextAreaElement).value })} placeholder="e.g. goes on the mantel" />
              </Field>
            </div>

            <div class="card sec">
              <h2 class="h2">Value and records</h2>
              <Field id="val" label="Value ($)" optional>
                <input id="val" class={errors.some((e) => e.field === 'value') ? 'field bad' : 'field'} inputMode="decimal" value={d.value} placeholder="e.g. 129.00" autoComplete="off" onInput={(e) => set({ value: (e.currentTarget as HTMLInputElement).value })} />
                <FieldError errors={errors} field="value" />
              </Field>
              <details class="records" open={[d.purchaseDate, d.model, d.serial, d.warrantyUntil].some((x) => x !== '')}>
                <summary class="lbl">Records</summary>
                <div class="row2">
                  <Field id="pd" label="Purchase date" optional>
                    <input id="pd" type="date" class="field" value={d.purchaseDate} onInput={(e) => set({ purchaseDate: (e.currentTarget as HTMLInputElement).value })} />
                    <FieldError errors={errors} field="purchaseDate" />
                  </Field>
                  <Field id="wu" label="Warranty until" optional>
                    <input id="wu" type="date" class="field" value={d.warrantyUntil} onInput={(e) => set({ warrantyUntil: (e.currentTarget as HTMLInputElement).value })} />
                    <FieldError errors={errors} field="warrantyUntil" />
                  </Field>
                </div>
                <div class="row2">
                  <Field id="md" label="Model" optional>
                    <input id="md" class="field" value={d.model} autoComplete="off" onInput={(e) => set({ model: (e.currentTarget as HTMLInputElement).value })} />
                  </Field>
                  <Field id="sn" label="Serial" optional>
                    <input id="sn" class="field" value={d.serial} autoComplete="off" onInput={(e) => set({ serial: (e.currentTarget as HTMLInputElement).value })} />
                  </Field>
                </div>
              </details>
            </div>

            {base && <DeleteItemButton item={base} label="Delete this item…" />}
          </div>
        </div>
      </div>

      {picking && (
        <HomePicker
          snap={snap}
          mode="item"
          title="Where does it live?"
          current={d.home}
          recent={recent}
          submitLabel="Choose"
          onClose={() => setPicking(false)}
          onPick={(id) => {
            set({ home: id });
            setPicking(false);
          }}
        />
      )}
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
