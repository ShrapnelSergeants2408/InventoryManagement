import { describe, expect, it } from 'vitest';
import { href, parseHash } from '../src/ui/shell/router';

describe('hash routes', () => {
  it.each([
    ['', { tab: 'inventory', screen: 'tab' }],
    ['#/', { tab: 'inventory', screen: 'tab' }],
    ['#/order', { tab: 'order', screen: 'tab' }],
    ['#/more', { tab: 'more', screen: 'tab' }],
    ['#/nonsense', { tab: 'inventory', screen: 'tab' }],
    ['#/item/st-0001', { tab: 'inventory', screen: 'item', id: 'st-0001' }],
    ['#/add', { tab: 'inventory', screen: 'add', name: '' }],
    ['#/item/st-0063/edit', { tab: 'inventory', screen: 'edit', id: 'st-0063' }],
    ['#/more/suppliers', { tab: 'more', screen: 'suppliers' }],
    ['#/more/categories', { tab: 'more', screen: 'categories' }],
    ['#/more/locations', { tab: 'more', screen: 'locations' }],
    ['#/more/nonsense', { tab: 'more', screen: 'tab' }],
  ])('%s', (hash, route) => {
    expect(parseHash(hash)).toEqual(route);
  });

  it('round-trips item ids and add names with special characters', () => {
    expect(parseHash(href.item('tm-7K/3 x'))).toEqual({ tab: 'inventory', screen: 'item', id: 'tm-7K/3 x' });
    expect(parseHash(href.add('falcon 500 & “more”?'))).toEqual({ tab: 'inventory', screen: 'add', name: 'falcon 500 & “more”?' });
    expect(parseHash(href.edit('tm-7K/3 x'))).toEqual({ tab: 'inventory', screen: 'edit', id: 'tm-7K/3 x' });
    expect(parseHash(href.list('locations'))).toEqual({ tab: 'more', screen: 'locations' });
  });

  it('a malformed escape does not throw', () => {
    expect(parseHash('#/item/%E0%A4%A')).toEqual({ tab: 'inventory', screen: 'item', id: '%E0%A4%A' });
  });
});
