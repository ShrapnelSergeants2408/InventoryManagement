import { describe, expect, it } from 'vitest';
import { NO_FILTERS, activeFilterCount, passesFilters, type Filters } from '../src/domain/filters';
import { item } from './helpers';

const f = (over: Partial<Filters>): Filters => ({ ...NO_FILTERS, ...over });

const lights = item({ id: 'lights', category: 'Lights', location: 'Attic shelf B' });
const drill = item({ id: 'drill', category: 'Tools', location: 'Garage pegboard' });
const loose = item({ id: 'loose', category: 'Tools', location: '' });
const all = [lights, drill, loose];
const ids = (filters: Filters) => all.filter((i) => passesFilters(i, filters)).map((i) => i.id);

describe('SPEC v2.0 F2 filters', () => {
  it('no filters pass everything', () => {
    expect(ids(NO_FILTERS)).toEqual(['lights', 'drill', 'loose']);
    expect(activeFilterCount(NO_FILTERS)).toBe(0);
  });

  it('by category', () => {
    expect(ids(f({ category: 'Tools' }))).toEqual(['drill', 'loose']);
  });

  it('by location, ignoring capitals; "" is No location', () => {
    expect(ids(f({ location: 'attic SHELF b' }))).toEqual(['lights']);
    expect(ids(f({ location: '' }))).toEqual(['loose']);
  });

  it('filters combine', () => {
    expect(ids(f({ category: 'Tools', location: 'Garage pegboard' }))).toEqual(['drill']);
    expect(activeFilterCount(f({ category: 'Tools', location: '' }))).toBe(2);
  });
});
