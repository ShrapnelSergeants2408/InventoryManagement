import { describe, expect, it } from 'vitest';
import { ITEM_ID_PATTERN, newId, newItemId } from '../src/domain/ids';
import { isIsoDate, parseWholeNumber, validateItem } from '../src/domain/validate';
import { item } from './helpers';

describe('whole numbers and dates', () => {
  it('accepts whole numbers ≥ min only', () => {
    expect(parseWholeNumber('7', 'quantity')).toEqual({ ok: true, value: 7 });
    expect(parseWholeNumber('0', 'quantity')).toEqual({ ok: true, value: 0 });
    expect(parseWholeNumber('-1', 'quantity').ok).toBe(false);
    expect(parseWholeNumber('2.5', 'quantity').ok).toBe(false);
    expect(parseWholeNumber('0', 'x', 1).ok).toBe(false);
    expect(parseWholeNumber('', 'x').ok).toBe(false);
    expect(parseWholeNumber('99999999999999999999', 'x').ok).toBe(false);
  });
  it('checks real calendar dates', () => {
    expect(isIsoDate('2026-10-17')).toBe(true);
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('10/17/2026')).toBe(false);
  });
});

describe('item validation (§3)', () => {
  it('a complete item passes', () => {
    expect(validateItem(item())).toEqual([]);
  });
  it('id, name and category are required', () => {
    expect(validateItem(item({ id: '', name: ' ', category: '' })).map((e) => e.field)).toEqual(['id', 'name', 'category']);
  });
  it('quantity must be a whole number ≥ 0', () => {
    expect(validateItem(item({ quantity: -1 })).map((e) => e.field)).toEqual(['quantity']);
    expect(validateItem(item({ quantity: 1.5 })).map((e) => e.field)).toEqual(['quantity']);
  });
});

describe('record ids (§3)', () => {
  it('item ids are it- plus 8 characters without look-alikes', () => {
    const id = newItemId(() => false);
    expect(id).toMatch(ITEM_ID_PATTERN);
    expect(id).not.toMatch(/[01ILO]/);
  });
  it('skips ids already taken', () => {
    const taken = new Set(['bn-22222222']);
    let n = 0;
    // The first attempt draws all 2s (taken); the second all 3s.
    const random = () => (n++ < 8 ? 0 : 1 / 31 + 1e-9);
    expect(newId('bn-', (x) => taken.has(x), random)).toBe('bn-33333333');
  });
});
