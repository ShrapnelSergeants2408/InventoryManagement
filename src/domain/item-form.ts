// Item editor (add and edit, F16): the form's fields ⇄ an Item, and the messages the editor
// shows. Status (out, lent) and keepAtLeast aren't edited here (H5–H7); they keep their values.
import { kindOfId } from './ids';
import { centsToPlain, parsePrice } from './money';
import { tagProblem, isIsoDate, parseWholeNumber } from './validate';
import { blankItem, nameKey, type Category, type Condition, type Item, type Part } from './types';

export interface ItemDraft {
  name: string;
  category: string;
  subcategory: string;
  /** Name typed for a new subcategory, or null when an existing one (or none) is picked. */
  newSubcategory: string | null;
  /** A bin or spot id, or '' for no home yet. */
  home: string;
  quantity: string;
  approx: boolean;
  seasonId: string;
  /** Holiday only: the display it usually goes on (F22), or ''. */
  displayId: string;
  tags: string[];
  condition: Condition;
  conditionNote: string;
  barcode: string;
  notes: string;
  /** Dollars as typed. */
  value: string;
  purchaseDate: string;
  model: string;
  serial: string;
  warrantyUntil: string;
}

/**
 * The form for an existing item. With the category list, the category and subcategory take
 * the list's spelling (names match ignoring capitals, §3), so an item stored with other
 * capitals still shows its category in the picker and saves.
 */
export function draftFromItem(item: Item, categories: readonly Category[] = []): ItemDraft {
  const cat = categories.find((c) => nameKey(c.name) === nameKey(item.category));
  const sub = (item.subcategory !== '' && cat?.subcategories.find((s) => nameKey(s) === nameKey(item.subcategory))) || item.subcategory;
  return {
    name: item.name,
    category: cat?.name ?? item.category,
    subcategory: sub,
    newSubcategory: null,
    home: item.binId || item.spotId,
    quantity: String(item.quantity),
    approx: item.approx,
    seasonId: item.seasonId,
    displayId: item.displayId,
    tags: [...item.tags],
    condition: item.condition,
    conditionNote: item.conditionNote,
    barcode: item.barcode,
    notes: item.notes,
    value: item.value === null ? '' : centsToPlain(item.value),
    purchaseDate: item.purchaseDate,
    model: item.model,
    serial: item.serial,
    warrantyUntil: item.warrantyUntil,
  };
}

/** A new item: quantity 1, optionally already in a home (Add item here). */
export function newDraft(category: string, name = '', home = ''): ItemDraft {
  return draftFromItem({ ...blankItem('', name, category), binId: kindOfId(home) === 'bin' ? home : '', spotId: kindOfId(home) === 'spot' ? home : '' });
}

export interface FormError {
  /** 'name', 'category', 'newSubcategory', 'quantity', 'value', 'tags', a date field… */
  field: string;
  message: string;
}

export interface BuildContext {
  id: string;
  /** The item as loaded into the editor, or null when adding. */
  base: Item | null;
  /** A new item's part (an edit keeps the item's). */
  part?: Part;
  categories: readonly Category[];
}

export type BuildResult =
  | { ok: true; item: Item; /** A subcategory to add to the category list, or null. */ newSubcategory: string | null }
  | { ok: false; errors: FormError[] };

const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1) + (/[.!?]$/.test(s) ? '' : '.');

/** Checks every field and builds the item, or lists everything to fix. */
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
      // Typing a name that already exists (any capitals) just picks it: names are unique.
      const existing = cat?.subcategories.find((s) => nameKey(s) === nameKey(typed));
      subcategory = existing ?? typed;
      newSubcategory = existing ? null : typed;
    }
  }

  let quantity = 0;
  const q = parseWholeNumber(d.quantity, 'Quantity');
  if (q.ok) quantity = q.value;
  else err('quantity', q.error);

  let value: number | null = null;
  const v = parsePrice(d.value);
  if (v.ok) value = v.cents;
  else err('value', v.error.replace(/^price/, 'value'));

  const dates: Array<[keyof ItemDraft, string]> = [
    ['purchaseDate', 'Purchase date'],
    ['warrantyUntil', 'Warranty until'],
  ];
  for (const [field, label] of dates) {
    const s = (d[field] as string).trim();
    if (s !== '' && !isIsoDate(s)) err(field, `${label} must be a date`);
  }

  const tags: string[] = [];
  for (const raw of d.tags) {
    const t = raw.trim();
    const p = tagProblem(t);
    if (p) err('tags', p);
    else if (!tags.some((x) => nameKey(x) === nameKey(t))) tags.push(t);
  }

  const kind = kindOfId(d.home);
  if (d.home !== '' && kind !== 'bin' && kind !== 'spot') err('home', 'Choose a bin or a spot, or no home yet');

  if (errors.length > 0) return { ok: false, errors };

  const base = ctx.base ?? blankItem(ctx.id, name, cat!.name, ctx.part);
  const item: Item = {
    ...base,
    id: ctx.id,
    name,
    category: cat?.name ?? d.category,
    subcategory,
    binId: kind === 'bin' ? d.home : '',
    spotId: kind === 'spot' ? d.home : '',
    quantity,
    approx: d.approx,
    // Seasons are Holiday only (§3).
    seasonId: base.part === 'holiday' ? d.seasonId : '',
    displayId: base.part === 'holiday' ? d.displayId : '',
    tags,
    condition: d.condition,
    conditionNote: d.condition === 'ok' ? '' : d.conditionNote.trim(),
    barcode: d.barcode.trim(),
    notes: d.notes.trim(),
    value,
    purchaseDate: d.purchaseDate.trim(),
    model: d.model.trim(),
    serial: d.serial.trim(),
    warrantyUntil: d.warrantyUntil.trim(),
  };
  return { ok: true, item, newSubcategory };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Applies only the fields the editor changed onto the item as stored now, so a quantity
 * changed elsewhere while the editor was open isn't overwritten. Home moves together: a new
 * bin or spot replaces both fields, so the item never ends up in two places.
 */
export function mergeEdit(base: Item, edited: Item, current: Item): Item {
  const out: Item = { ...current };
  for (const k of Object.keys(edited) as (keyof Item)[]) {
    if (k === 'id' || k === 'hasPhoto' || k === 'binId' || k === 'spotId') continue;
    if (!same(edited[k], base[k])) Object.assign(out, { [k]: edited[k] });
  }
  if (edited.binId !== base.binId || edited.spotId !== base.spotId) Object.assign(out, { binId: edited.binId, spotId: edited.spotId });
  return out;
}
