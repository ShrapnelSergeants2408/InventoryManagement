// Field rules shared by the item editor and every importer (SPEC v2.0 §3).
import type { Item } from './types';

export type NumberParse = { ok: true; value: number } | { ok: false; error: string };

/** Whole number ≥ min. */
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

/** Validates a complete item before it is saved. */
export function validateItem(item: Item): FieldError[] {
  const errors: FieldError[] = [];
  const req = (field: string, value: string, label: string) => {
    if (value.trim() === '') errors.push({ field, message: `${label} is required` });
  };
  req('id', item.id, 'id');
  req('name', item.name, 'name');
  req('category', item.category, 'category');
  if (!(Number.isSafeInteger(item.quantity) && item.quantity >= 0)) errors.push({ field: 'quantity', message: 'quantity must be a whole number ≥ 0' });
  return errors;
}
