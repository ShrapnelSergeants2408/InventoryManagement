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
  ])('%s', (hash, route) => {
    expect(parseHash(hash)).toEqual(route);
  });

  it('round-trips item ids and add names with special characters', () => {
    expect(parseHash(href.item('tm-7K/3 x'))).toEqual({ tab: 'inventory', screen: 'item', id: 'tm-7K/3 x' });
    expect(parseHash(href.add('falcon 500 & “more”?'))).toEqual({ tab: 'inventory', screen: 'add', name: 'falcon 500 & “more”?' });
  });

  it('a malformed escape does not throw', () => {
    expect(parseHash('#/item/%E0%A4%A')).toEqual({ tab: 'inventory', screen: 'item', id: '%E0%A4%A' });
  });
});
