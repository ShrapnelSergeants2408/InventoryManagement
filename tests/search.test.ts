import { describe, expect, it } from 'vitest';
import { matchesQuery, normalize, queryTerms } from '../src/domain/search';
import { item, vendor } from './helpers';

const neo = item({
  name: 'NEO 2.0 Brushless Motor',
  location: 'Bin C4',
  notes: 'Spare for the arm, see Dan',
  vendors: [vendor({ supplier: 'REV', partNo: 'REV-21-1653' }), vendor({ supplier: 'AndyMark', partNo: 'am-4927' }), null],
});

describe('SPEC F4 search', () => {
  it.each([
    ['name', 'brushless'],
    ['preferred part #', 'REV-21-1653'],
    ['second vendor part # (D2)', 'AM-4927'],
    ['preferred supplier', 'rev'],
    ['second vendor supplier (D2)', 'andymark'],
    ['location', 'bin c4'],
    ['notes', 'the arm'],
  ])('matches on %s', (_field, q) => {
    expect(matchesQuery(neo, q)).toBe(true);
  });

  it('is case- and accent-insensitive (D2)', () => {
    const it2 = item({ name: 'Câble d’alimentation Ø6' });
    expect(matchesQuery(it2, 'CABLE')).toBe(true);
    expect(matchesQuery(neo, 'nÉo')).toBe(true);
  });

  it('every word must match, in any order', () => {
    expect(matchesQuery(neo, 'motor neo')).toBe(true);
    expect(matchesQuery(neo, 'neo falcon')).toBe(false);
  });

  it('a blank query matches everything', () => {
    expect(queryTerms('   ')).toEqual([]);
    expect(matchesQuery(neo, '')).toBe(true);
  });

  it('does not match on fields F4 leaves out (unit, id); category and barcode are searched since v0.17', () => {
    const it2 = item({ id: 'st-0042', name: 'x', category: 'Motors', unit: 'each', barcode: '0123456789', vendors: [vendor({ supplier: 'REV', partNo: 'P' }), null, null] });
    expect(matchesQuery(it2, 'each')).toBe(false);
    expect(matchesQuery(it2, 'st-0042')).toBe(false);
    expect(matchesQuery(it2, 'motors')).toBe(true);
    expect(matchesQuery(it2, '0123456789')).toBe(true);
  });

  it('does not match across field boundaries', () => {
    expect(matchesQuery(neo, 'motor bin')).toBe(true); // two words, two fields: fine
    expect(matchesQuery(neo, 'motorbin')).toBe(false);
  });

  it('normalize collapses whitespace', () => {
    expect(normalize('  a \t B\n c ')).toBe('a b c');
  });
});

describe('search by category, subcategory and barcode (v0.17)', () => {
  const bearing = item({ name: 'Flanged 1/2 in. hex, 1.125 OD', category: 'Mechanical', subcategory: 'Bearings', barcode: '0123456789012' });
  it('finds an item by its category or subcategory even when the name does not say it', () => {
    expect(matchesQuery(bearing, 'bearings')).toBe(true);
    expect(matchesQuery(bearing, 'mechanical hex')).toBe(true);
  });
  it('finds an item by its barcode, whole or in part', () => {
    expect(matchesQuery(bearing, '0123456789012')).toBe(true);
    expect(matchesQuery(bearing, '56789')).toBe(true);
    expect(matchesQuery(bearing, '99999')).toBe(false);
  });
});
