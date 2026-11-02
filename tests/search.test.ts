import { describe, expect, it } from 'vitest';
import { matchesQuery, normalize, queryTerms } from '../src/domain/search';
import { item } from './helpers';

const neo = item({
  name: 'Inflatable Snowman Motor',
  category: 'Decorations',
  subcategory: 'Outdoor',
  location: 'Bin C4',
  notes: 'Spare for the arm, see Dan',
});

describe('SPEC v2.0 F1 search', () => {
  it.each([
    ['name', 'snowman'],
    ['category', 'decorations'],
    ['subcategory', 'outdoor'],
    ['location', 'bin c4'],
    ['notes', 'the arm'],
  ])('matches on %s', (_field, q) => {
    expect(matchesQuery(neo, q)).toBe(true);
  });

  it('is case- and accent-insensitive (D2)', () => {
    const it2 = item({ name: 'Câble d’alimentation Ø6' });
    expect(matchesQuery(it2, 'CABLE')).toBe(true);
    expect(matchesQuery(neo, 'SNÖWMAN')).toBe(true);
  });

  it('every word must match, in any order', () => {
    expect(matchesQuery(neo, 'motor snowman')).toBe(true);
    expect(matchesQuery(neo, 'snowman reindeer')).toBe(false);
  });

  it('a blank query matches everything', () => {
    expect(queryTerms('   ')).toEqual([]);
    expect(matchesQuery(neo, '')).toBe(true);
  });

  it('does not match on the id; category and barcode are searched', () => {
    const it2 = item({ id: 'it-0042ABCD', name: 'x', category: 'Motors', barcode: '0123456789' });
    expect(matchesQuery(it2, 'it-0042')).toBe(false);
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
