// Item editor (F6 add, F7 edit): the form's text fields ⇄ an Item, the messages the editor
// shows (mockup 3d), and the PIN rule for vendor fields (§6).
import { centsToPlain, parsePrice } from './money';
import { nameKey, preferredVendorOf, type Category, type Item, type ItemSource, type Vendor, type VendorSlot } from './types';
import { normalizeUrl } from './url';
import { isIsoDate, parseWholeNumber } from './validate';

/** Unit choices in the editor (mockup 3a); an item's own unit is kept even if it isn't listed. */
export const UNITS: readonly string[] = ['each', 'ft', 'm', 'kit', 'stick', 'sheet', 'set', 'roll', 'can', 'box'];

export interface VendorDraft {
  supplier: string;
  partNo: string;
  url: string;
  packSize: string;
  /** Dollars as typed; blank = no price. */
  price: string;
  priceChecked: string;
}

export interface ItemDraft {
  name: string;
  category: string;
  subcategory: string;
  /** Name typed for a new subcategory, or null when an existing one (or none) is picked. */
  newSubcategory: string | null;
  location: string;
  unit: string;
  onHand: string;
  desired: string;
  spares: string;
  barcode: string;
  notes: string;
  /** 1–3 vendor options in slot order. */
  vendors: VendorDraft[];
  /** Index into `vendors`. */
  preferred: number;
}

export const MAX_VENDORS = 3;

export function blankVendor(): VendorDraft {
  return { supplier: '', partNo: '', url: '', packSize: '1', price: '', priceChecked: '' };
}

/**
 * The form for an existing item. With the category list, the category and subcategory take
 * the list's spelling (names match ignoring capitals, §3), so an item stored with other
 * capitals still shows its category in the picker and saves (Stage 5 finding 2).
 */
export function draftFromItem(item: Item, categories: readonly Category[] = []): ItemDraft {
  const cat = categories.find((c) => nameKey(c.name) === nameKey(item.category));
  const sub = (item.subcategory !== '' && cat?.subcategories.find((s) => nameKey(s) === nameKey(item.subcategory))) || item.subcategory;
  const vendors: VendorDraft[] = [];
  let preferred = 0;
  item.vendors.forEach((v, i) => {
    if (!v) return;
    if (i + 1 === item.preferredVendor) preferred = vendors.length;
    vendors.push({
      supplier: v.supplier,
      partNo: v.partNo,
      url: v.url,
      packSize: String(v.packSize),
      price: v.packPriceCents === null ? '' : centsToPlain(v.packPriceCents),
      priceChecked: v.priceChecked,
    });
  });
  if (vendors.length === 0) vendors.push(blankVendor());
  return {
    name: item.name,
    category: cat?.name ?? item.category,
    subcategory: sub,
    newSubcategory: null,
    location: item.location,
    unit: item.unit,
    onHand: String(item.onHand),
    desired: String(item.desired),
    spares: String(item.spares),
    barcode: item.barcode,
    notes: item.notes,
    vendors,
    preferred,
  };
}

/** A new team item (F6): counts 0, unit "each", one empty vendor option. */
export function newDraft(category: string, name = ''): ItemDraft {
  return {
    name,
    category,
    subcategory: '',
    newSubcategory: null,
    location: '',
    unit: 'each',
    onHand: '0',
    desired: '0',
    spares: '0',
    barcode: '',
    notes: '',
    vendors: [blankVendor()],
    preferred: 0,
  };
}

/**
 * Edits one vendor field. Changing the price or pack size fills "price checked" with today
 * (spec-questions Q9b); the mentor can still change the date before saving.
 */
export function editVendor(v: VendorDraft, field: keyof VendorDraft, value: string, today: string): VendorDraft {
  const next = { ...v, [field]: value };
  if ((field === 'price' || field === 'packSize') && value.trim() !== v[field].trim()) next.priceChecked = today;
  return next;
}

/** Removes a vendor option; the preferred one moves with the list (or to option 1 if it was removed). */
export function removeVendor(d: ItemDraft, index: number): ItemDraft {
  if (d.vendors.length <= 1) return d;
  const vendors = d.vendors.filter((_, i) => i !== index);
  const preferred = index === d.preferred ? 0 : d.preferred > index ? d.preferred - 1 : d.preferred;
  return { ...d, vendors, preferred };
}

export interface FormError {
  /** 'name', 'category', 'newSubcategory', 'unit', 'onHand', 'desired', 'spares', 'v1.supplier', 'v2.packSize', … */
  field: string;
  message: string;
}

export interface BuildContext {
  id: string;
  /** The item as loaded into the editor, or null when adding. */
  base: Item | null;
  /** YYYY-MM-DD; a new item's on-hand counts as a count (§3 last_counted). */
  today: string;
  supplierNames: readonly string[];
  categories: readonly Category[];
  /**
   * True while the vendor fields are PIN-locked (editing without the PIN): they are kept
   * exactly as stored, unchecked, so an imported odd value (a link without https://, a
   * supplier in other capitals) can never block a student's save or ask for the PIN.
   */
  vendorsLocked?: boolean;
}

export type BuildResult =
  | { ok: true; item: Item; /** A subcategory to add to the category list (F6), or null. */ newSubcategory: string | null }
  | { ok: false; errors: FormError[] };

const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1) + (/[.!?]$/.test(s) ? '' : '.');

/** Checks every field and builds the item, or lists everything to fix (mockup 3d). */
export function buildItem(d: ItemDraft, ctx: BuildContext): BuildResult {
  const errors: FormError[] = [];
  const err = (field: string, message: string) => errors.push({ field, message: sentence(message) });

  const name = d.name.trim();
  if (name === '') err('name', 'Name is required');

  // Names match ignoring capitals (§3); the item takes the list's spelling.
  const cat = ctx.categories.find((c) => nameKey(c.name) === nameKey(d.category));
  if (!cat) err('category', 'Choose a category');

  let subcategory = (d.subcategory !== '' && cat?.subcategories.find((s) => nameKey(s) === nameKey(d.subcategory))) || d.subcategory;
  let newSubcategory: string | null = null;
  if (d.newSubcategory !== null) {
    const typed = d.newSubcategory.trim();
    if (typed === '') err('newSubcategory', 'Type a name for the new subcategory, or pick one from the list');
    else {
      // Typing a name that already exists (any capitals) just picks it (D3: names are unique).
      const existing = cat?.subcategories.find((s) => nameKey(s) === nameKey(typed));
      subcategory = existing ?? typed;
      newSubcategory = existing ? null : typed;
    }
  }

  const unit = d.unit.trim();
  if (unit === '') err('unit', 'Choose a unit');

  const counts = { onHand: 0, desired: 0, spares: 0 };
  for (const [k, label] of [['onHand', 'On hand'], ['desired', 'Desired'], ['spares', 'Spares']] as const) {
    const p = parseWholeNumber(d[k], label);
    if (p.ok) counts[k] = p.value;
    else err(k, p.error);
  }

  const keep = ctx.vendorsLocked === true && ctx.base !== null;
  if (!keep && (d.vendors.length < 1 || d.vendors.length > MAX_VENDORS)) err('vendors', 'An item needs 1 to 3 vendor options');
  if (!keep && (d.preferred < 0 || d.preferred >= d.vendors.length)) err('preferred', 'Choose the preferred vendor');

  const known = new Map(ctx.supplierNames.map((s) => [nameKey(s), s]));
  const vendors: Vendor[] = [];
  (keep ? [] : d.vendors.slice(0, MAX_VENDORS)).forEach((v, i) => {
    const n = i + 1;
    const f = (x: string) => `v${n}.${x}`;
    const pre = `Vendor option ${n}: `;
    let supplier = v.supplier.trim();
    if (supplier === '') err(f('supplier'), `${pre}choose a supplier${i === d.preferred ? ' (it is the preferred vendor)' : ''}`);
    else if (!known.has(nameKey(supplier))) err(f('supplier'), `${pre}supplier “${supplier}” isn't in the Supplier list`);
    else supplier = known.get(nameKey(supplier))!;

    const ps = v.packSize.trim();
    const packSize = /^\d+$/.test(ps) ? Number(ps) : NaN;
    if (ps === '') err(f('packSize'), `${pre}pack size is required (1 if it's sold one at a time)`);
    else if (!(Number.isSafeInteger(packSize) && packSize >= 1)) err(f('packSize'), `${pre}pack size “${ps}” must be a whole number of 1 or more`);

    const price = parsePrice(v.price);
    if (!price.ok) err(f('price'), pre + price.error);

    const url = normalizeUrl(v.url, 'product page link');
    if (!url.ok) err(f('url'), pre + url.error);

    const checked = v.priceChecked.trim();
    if (checked !== '' && !isIsoDate(checked)) err(f('priceChecked'), `${pre}“price checked” must be a date like 2026-10-17`);

    vendors.push({
      supplier,
      partNo: v.partNo.trim(),
      url: url.ok ? url.url : '',
      packSize,
      packPriceCents: price.ok ? price.cents : null,
      priceChecked: checked,
    });
  });

  if (errors.length > 0) return { ok: false, errors };

  const base = ctx.base;
  const source: ItemSource = base?.source ?? 'team';
  const item: Item = {
    id: ctx.id,
    name,
    category: cat?.name ?? d.category,
    subcategory,
    location: d.location.trim(),
    unit,
    ...counts,
    barcode: d.barcode.trim(),
    notes: d.notes.trim(),
    source,
    lastCounted: base ? base.lastCounted : ctx.today,
    preferredVendor: keep && base ? base.preferredVendor : ((d.preferred + 1) as VendorSlot),
    vendors: keep && base ? base.vendors : [vendors[0] ?? null, vendors[1] ?? null, vendors[2] ?? null],
    hasPhoto: base?.hasPhoto ?? false,
  };
  return { ok: true, item, newSubcategory };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * §6: vendor fields and the preferred vendor need the mentor PIN — except vendor option 1
 * while adding a new item (F6). Compares the options themselves, not slot numbers, so an
 * empty slot closing up isn't a change.
 */
export function vendorChangesNeedPin(base: Item | null, next: Item): boolean {
  if (base === null) return next.vendors[1] !== null || next.vendors[2] !== null || next.preferredVendor !== 1;
  const options = (i: Item) => i.vendors.filter((v) => v !== null);
  return !same(options(base), options(next)) || !same(preferredVendorOf(base), preferredVendorOf(next));
}

/**
 * Applies only the fields the editor changed onto the item as stored now, so a count changed
 * elsewhere while the editor was open isn't overwritten. Vendors and the preferred vendor
 * travel together, since a slot number only means something with its list.
 */
export function mergeEdit(base: Item, edited: Item, current: Item): Item {
  const out: Item = { ...current };
  for (const k of Object.keys(edited) as (keyof Item)[]) {
    if (k === 'id' || k === 'hasPhoto' || k === 'vendors' || k === 'preferredVendor') continue;
    if (!same(edited[k], base[k])) Object.assign(out, { [k]: edited[k] });
  }
  if (!same(edited.vendors, base.vendors) || edited.preferredVendor !== base.preferredVendor) {
    out.vendors = edited.vendors;
    out.preferredVendor = edited.preferredVendor;
  }
  return out;
}
