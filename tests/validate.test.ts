import { describe, expect, it } from 'vitest';
import { newTeamId, TEAM_ID_PATTERN } from '../src/domain/ids';
import { isIsoDate, parseWholeNumber, validateItem } from '../src/domain/validate';
import { item, vendor } from './helpers';

describe('whole numbers and dates', () => {
  it('accepts whole numbers ≥ min only', () => {
    expect(parseWholeNumber('7', 'on hand')).toEqual({ ok: true, value: 7 });
    expect(parseWholeNumber('0', 'on hand')).toEqual({ ok: true, value: 0 });
    expect(parseWholeNumber('-1', 'on hand').ok).toBe(false);
    expect(parseWholeNumber('2.5', 'pack size', 1).ok).toBe(false);
    expect(parseWholeNumber('0', 'pack size', 1).ok).toBe(false);
    expect(parseWholeNumber('', 'x').ok).toBe(false);
  });
  it('checks real calendar dates', () => {
    expect(isIsoDate('2026-10-17')).toBe(true);
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('10/17/2026')).toBe(false);
  });
});

describe('item validation (§3, §4)', () => {
  const suppliers = ['REV', 'WCP', 'other'];
  it('a complete item passes', () => {
    expect(validateItem(item(), suppliers)).toEqual([]);
  });
  it('preferred vendor must exist', () => {
    const errs = validateItem(item({ preferredVendor: 2 }), suppliers);
    expect(errs.map((e) => e.field)).toContain('preferredVendor');
  });
  it('pack size must be a whole number ≥ 1', () => {
    for (const packSize of [0, 2.5, -1]) {
      const errs = validateItem(item({ vendors: [vendor({ packSize }), null, null] }), suppliers);
      expect(errs.map((e) => e.field)).toContain('v1.packSize');
    }
  });
  it('quantities cannot be negative or fractional', () => {
    expect(validateItem(item({ onHand: -1 }), suppliers).map((e) => e.field)).toContain('onHand');
    expect(validateItem(item({ desired: 1.5 }), suppliers).map((e) => e.field)).toContain('desired');
    expect(validateItem(item({ spares: -2 }), suppliers).map((e) => e.field)).toContain('spares');
  });
  it('supplier must be in the Supplier list (case-insensitive)', () => {
    expect(validateItem(item({ vendors: [vendor({ supplier: 'rev' }), null, null] }), suppliers)).toEqual([]);
    expect(validateItem(item({ vendors: [vendor({ supplier: 'Nope' }), null, null] }), suppliers).map((e) => e.field)).toContain('v1.supplier');
  });
  it('required text fields', () => {
    const fields = validateItem(item({ name: ' ', category: '', unit: '' }), suppliers).map((e) => e.field);
    expect(fields).toEqual(expect.arrayContaining(['name', 'category', 'unit']));
  });
});

describe('team ids (D1)', () => {
  it('match tm- + 5 unambiguous characters and avoid taken ids', () => {
    const seq = [0, 0, 0, 0, 0, 0.5, 0.5, 0.5, 0.5, 0.5];
    let i = 0;
    const id = newTeamId((x) => x === 'tm-22222', () => seq[i++ % seq.length]!);
    expect(id).toMatch(TEAM_ID_PATTERN);
    expect(id).not.toBe('tm-22222');
    for (let n = 0; n < 200; n++) expect(newTeamId(() => false)).toMatch(TEAM_ID_PATTERN);
  });
});
