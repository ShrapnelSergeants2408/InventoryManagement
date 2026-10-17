import { describe, expect, it } from 'vitest';
import { NO_FILTERS, activeFilterCount, passesFilters, type Filters } from '../src/domain/filters';
import { item, vendor } from './helpers';

const f = (over: Partial<Filters>): Filters => ({ ...NO_FILTERS, ...over });

// desired 10, spares 3 → short below 10, low spares 10–12, OK from 13.
const short = item({ id: 'short', onHand: 4, desired: 10, spares: 3 });
const low = item({ id: 'low', onHand: 11, desired: 10, spares: 3 });
const ok = item({ id: 'ok', onHand: 13, desired: 10, spares: 3 });
const all = [short, low, ok];
const ids = (filters: Filters) => all.filter((i) => passesFilters(i, filters)).map((i) => i.id);

describe('SPEC F5 filters', () => {
  it('no filters pass everything', () => {
    expect(ids(NO_FILTERS)).toEqual(['short', 'low', 'ok']);
    expect(activeFilterCount(NO_FILTERS)).toBe(0);
  });

  it('Needs order = order_qty > 0 (short and low spares, not OK)', () => {
    expect(ids(f({ needsOrder: true }))).toEqual(['short', 'low']);
  });

  it('Needs order is false for an item whose need is 0 at the boundary', () => {
    expect(passesFilters(item({ onHand: 13, desired: 10, spares: 3 }), f({ needsOrder: true }))).toBe(false);
    expect(passesFilters(item({ onHand: 12, desired: 10, spares: 3 }), f({ needsOrder: true }))).toBe(true);
  });

  it('Short only / Low spares only', () => {
    expect(ids(f({ short: true }))).toEqual(['short']);
    expect(ids(f({ low: true }))).toEqual(['low']);
  });

  it('Short and Low spares together show either', () => {
    expect(ids(f({ short: true, low: true }))).toEqual(['short', 'low']);
  });

  it('by category', () => {
    const a = item({ category: 'Motors' });
    expect(passesFilters(a, f({ category: 'Motors' }))).toBe(true);
    expect(passesFilters(a, f({ category: 'Pneumatics' }))).toBe(false);
  });

  it('by supplier uses the preferred vendor only, case-insensitively', () => {
    const a = item({ preferredVendor: 2, vendors: [vendor({ supplier: 'REV' }), vendor({ supplier: 'WCP' }), null] });
    expect(passesFilters(a, f({ supplier: 'wcp' }))).toBe(true);
    expect(passesFilters(a, f({ supplier: 'REV' }))).toBe(false);
  });

  it('by location, with "" meaning No location', () => {
    const inBin = item({ location: 'Bin A1' });
    const none = item({ location: '' });
    expect(passesFilters(inBin, f({ location: 'bin a1' }))).toBe(true);
    expect(passesFilters(none, f({ location: 'Bin A1' }))).toBe(false);
    expect(passesFilters(none, f({ location: '' }))).toBe(true);
    expect(passesFilters(inBin, f({ location: '' }))).toBe(false);
  });

  it('combinations must all pass', () => {
    const a = item({ category: 'Motors', location: 'Bin A1', onHand: 0, desired: 2 });
    expect(passesFilters(a, f({ category: 'Motors', location: 'Bin A1', short: true, needsOrder: true }))).toBe(true);
    expect(passesFilters(a, f({ category: 'Motors', location: 'Bin B2', short: true }))).toBe(false);
    expect(passesFilters(a, f({ category: 'Motors', low: true }))).toBe(false);
    expect(activeFilterCount(f({ category: 'Motors', location: '', short: true }))).toBe(3);
  });
});
