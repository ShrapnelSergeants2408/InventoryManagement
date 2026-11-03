import { describe, expect, it } from 'vitest';
import { indexPlaces } from '../src/domain/places';
import { matchesQuery, normalize, queryTerms } from '../src/domain/search';
import { household, item } from './helpers';

const h = household();
const ctx = { places: indexPlaces(h), seasons: new Map(h.seasons.map((s) => [s.id, s])) };

const neo = item({
  name: 'Inflatable Snowman Motor',
  category: 'Decorations',
  subcategory: 'Outdoor',
  binId: 'bn-xmas4',
  notes: 'Spare for the arm, see Dan',
  tags: ['Outdoor', 'Fragile'],
  model: 'SM-200',
  serial: 'X99',
});

describe('SPEC v2.0 F1 search', () => {
  it.each([
    ['name', 'snowman'],
    ['category', 'decorations'],
    ['subcategory', 'outdoor'],
    ['notes', 'the arm'],
    ['tags', 'fragile'],
    ['model', 'sm-200'],
    ['serial', 'x99'],
    ['area', 'attic'],
    ['spot', 'shelf b'],
    ['bin code', 'a-04'],
    ['bin name', 'christmas 4'],
    ['season (from its bin)', 'christmas'],
  ])('matches on %s', (_field, q) => {
    expect(matchesQuery(neo, q, ctx)).toBe(true);
  });

  it('without places, the path isn’t searched', () => {
    expect(matchesQuery(neo, 'attic')).toBe(false);
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
    expect(matchesQuery(neo, 'motor attic', ctx)).toBe(true); // two words, two fields: fine
    expect(matchesQuery(neo, 'motorattic', ctx)).toBe(false);
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
