// Item editor (add and edit): the form's text fields ⇄ an Item, and the messages the editor shows.
import { nameKey, type Category, type Item } from './types';
import { parseWholeNumber } from './validate';

export interface ItemDraft {
  name: string;
  category: string;
  subcategory: string;
  /** Name typed for a new subcategory, or null when an existing one (or none) is picked. */
  newSubcategory: string | null;
  location: string;
  quantity: string;
  barcode: string;
  notes: string;
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
    location: item.location,
    quantity: String(item.quantity),
    barcode: item.barcode,
    notes: item.notes,
  };
}

/** A new item: quantity 1. */
export function newDraft(category: string, name = ''): ItemDraft {
  return { name, category, subcategory: '', newSubcategory: null, location: '', quantity: '1', barcode: '', notes: '' };
}

export interface FormError {
  /** 'name', 'category', 'newSubcategory', 'quantity' */
  field: string;
  message: string;
}

export interface BuildContext {
  id: string;
  /** The item as loaded into the editor, or null when adding. */
  base: Item | null;
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

  if (errors.length > 0) return { ok: false, errors };

  const item: Item = {
    id: ctx.id,
    name,
    category: cat?.name ?? d.category,
    subcategory,
    location: d.location.trim(),
    quantity,
    barcode: d.barcode.trim(),
    notes: d.notes.trim(),
    hasPhoto: ctx.base?.hasPhoto ?? false,
  };
  return { ok: true, item, newSubcategory };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Applies only the fields the editor changed onto the item as stored now, so a quantity
 * changed elsewhere while the editor was open isn't overwritten.
 */
export function mergeEdit(base: Item, edited: Item, current: Item): Item {
  const out: Item = { ...current };
  for (const k of Object.keys(edited) as (keyof Item)[]) {
    if (k === 'id' || k === 'hasPhoto') continue;
    if (!same(edited[k], base[k])) Object.assign(out, { [k]: edited[k] });
  }
  return out;
}
