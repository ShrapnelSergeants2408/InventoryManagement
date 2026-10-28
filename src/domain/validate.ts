// Field rules shared by the item editor and every importer (SPEC §3, §4; spec-questions Q6).
import { isCountStamp } from './dates';
import { VENDOR_SLOTS, nameKey, vendorAt, type Item } from './types';

export type NumberParse = { ok: true; value: number } | { ok: false; error: string };

/** Whole number ≥ min (counts: min 0; pack size: min 1). */
export function parseWholeNumber(raw: string, field: string, min = 0): NumberParse {
  const s = raw.trim();
  if (!/^\d+$/.test(s)) {
    if (/^-\d+$/.test(s)) return { ok: false, error: `${field} can't be negative` };
    return { ok: false, error: `${field} "${s}" must be a whole number${min > 0 ? ` ≥ ${min}` : ''}` };
  }
  const value = Number(s);
  if (!Number.isSafeInteger(value)) return { ok: false, error: `${field} "${s}" is too large` };
  if (value < min) return { ok: false, error: `${field} must be a whole number ≥ ${min}` };
  return { ok: true, value };
}

/** Strict ISO calendar date YYYY-MM-DD that exists. */
export function isIsoDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

export interface FieldError {
  field: string;
  message: string;
}

const isWhole = (n: number, min: number) => Number.isSafeInteger(n) && n >= min;

/**
 * Validates a complete item before it is saved. `supplierNames` is the managed
 * Supplier list; pass null to skip that check (importers add missing names, F17/F18).
 */
export function validateItem(item: Item, supplierNames: readonly string[] | null): FieldError[] {
  const errors: FieldError[] = [];
  const req = (field: string, value: string, label: string) => {
    if (value.trim() === '') errors.push({ field, message: `${label} is required` });
  };
  req('id', item.id, 'id');
  req('name', item.name, 'name');
  req('category', item.category, 'category');
  req('unit', item.unit, 'unit');
  for (const [field, label] of [['onHand', 'on hand'], ['desired', 'desired'], ['spares', 'spares']] as const) {
    if (!isWhole(item[field], 0)) errors.push({ field, message: `${label} must be a whole number ≥ 0` });
  }
  if (item.lastCounted !== '' && !isCountStamp(item.lastCounted)) {
    errors.push({ field: 'lastCounted', message: `last counted "${item.lastCounted}" must be a date and time like 2026-10-24T18:42-05:00` });
  }
  const known = supplierNames ? new Set(supplierNames.map(nameKey)) : null;
  for (const slot of VENDOR_SLOTS) {
    const v = vendorAt(item, slot);
    if (!v) continue;
    const f = (name: string) => `v${slot}.${name}`;
    if (v.supplier.trim() === '') errors.push({ field: f('supplier'), message: `vendor option ${slot}: choose a supplier` });
    else if (known && !known.has(nameKey(v.supplier))) {
      errors.push({ field: f('supplier'), message: `vendor option ${slot}: supplier "${v.supplier}" isn't in the Supplier list` });
    }
    if (!isWhole(v.packSize, 1)) errors.push({ field: f('packSize'), message: `vendor option ${slot}: pack size must be a whole number ≥ 1` });
    if (v.packPriceCents !== null && !isWhole(v.packPriceCents, 0)) {
      errors.push({ field: f('packPrice'), message: `vendor option ${slot}: price must be a dollar amount ≥ 0` });
    }
    if (v.priceChecked !== '' && !isIsoDate(v.priceChecked)) {
      errors.push({ field: f('priceChecked'), message: `vendor option ${slot}: price checked "${v.priceChecked}" must be a date like 2026-10-17` });
    }
  }
  if (!vendorAt(item, item.preferredVendor)) {
    errors.push({ field: 'preferredVendor', message: `preferred vendor ${item.preferredVendor} has no supplier — choose a supplier (preferred vendor)` });
  }
  return errors;
}
