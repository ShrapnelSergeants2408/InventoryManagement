import { describe, expect, it } from 'vitest';
import { NO_FILTERS, activeFilterCount, passesFilters, type Filters } from '../src/domain/filters';
import { indexPlaces } from '../src/domain/places';
import { household, item } from './helpers';

const f = (over: Partial<Filters>): Filters => ({ ...NO_FILTERS, ...over });
const ix = indexPlaces(household());

const lights = item({ id: 'lights', category: 'Lights', binId: 'bn-xmas4', tags: ['Fragile'] });
const drill = item({ id: 'drill', category: 'Tools', spotId: 'sp-peg', status: 'lent', condition: 'needs repair' });
const loose = item({ id: 'loose', category: 'Tools', seasonId: 'se-hall', status: 'out' });
const all = [lights, drill, loose];
const ids = (filters: Filters) => all.filter((i) => passesFilters(i, filters, ix)).map((i) => i.id);

describe('SPEC v2.0 F2 filters', () => {
  it('no filters pass everything', () => {
    expect(ids(NO_FILTERS)).toEqual(['lights', 'drill', 'loose']);
    expect(activeFilterCount(NO_FILTERS)).toBe(0);
  });

  it('by category', () => {
    expect(ids(f({ category: 'Tools' }))).toEqual(['drill', 'loose']);
  });

  it('by area, through a bin or a spot; "" is No home yet', () => {
    expect(ids(f({ area: 'ar-attic' }))).toEqual(['lights']);
    expect(ids(f({ area: 'ar-garage' }))).toEqual(['drill']);
    expect(ids(f({ area: '' }))).toEqual(['loose']);
  });

  it('by season: the item’s own, else its bin’s; "" is none', () => {
    expect(ids(f({ season: 'se-xmas' }))).toEqual(['lights']);
    expect(ids(f({ season: 'se-hall' }))).toEqual(['loose']);
    expect(ids(f({ season: '' }))).toEqual(['drill']);
  });

  it('by status, condition not OK, and tag (ignoring capitals)', () => {
    expect(ids(f({ status: 'lent' }))).toEqual(['drill']);
    expect(ids(f({ status: 'stored' }))).toEqual(['lights']);
    expect(ids(f({ attention: true }))).toEqual(['drill']);
    expect(ids(f({ tag: 'fragile' }))).toEqual(['lights']);
  });

  it('filters combine', () => {
    expect(ids(f({ category: 'Tools', area: 'ar-garage' }))).toEqual(['drill']);
    expect(activeFilterCount(f({ category: 'Tools', area: '', attention: true, tag: 'x' }))).toBe(4);
  });
});
