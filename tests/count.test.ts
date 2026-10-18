import { describe, expect, it } from 'vitest';
import {
  MAX_DIGITS,
  cleanSince,
  isCounted,
  countGroups,
  entryValue,
  firstToCount,
  groupAction,
  nextGroup,
  orderTotalCents,
  overallProgress,
  pressKey,
  previewStatus,
  summarize,
  type PadKey,
} from '../src/domain/count';
import type { Category, Location } from '../src/domain/types';
import { item, vendor } from './helpers';

const categories: Category[] = [
  { name: 'Motors', order: 0, subcategories: ['Brushless', 'Brushed'] },
  { name: 'Structure', order: 1, subcategories: [] },
];
const locations: Location[] = [
  { name: 'Shelf B', notes: '', order: 1 },
  { name: 'Bin A', notes: '', order: 0 },
];

// Stored order deliberately differs from list order.
const items = [
  item({ id: 'm-brushed', category: 'Motors', subcategory: 'Brushed', desired: 2, location: 'Shelf B' }),
  item({ id: 's-1', category: 'Structure', desired: 4, location: 'bin a' }),
  item({ id: 'm-none', category: 'Motors', subcategory: '', desired: 0 }),
  item({ id: 'm-brushless', category: 'Motors', subcategory: 'Brushless', desired: 1, location: 'Bin A', lastCounted: '2026-10-18' }),
  item({ id: 'x-1', category: 'Unlisted', desired: 1, location: 'Gone shelf' }),
];

const ids = (g: { items: { id: string }[] }) => g.items.map((i) => i.id);

describe('countGroups — walk order (F24)', () => {
  it('by category follows the Inventory list: category list, subcategory list, then no subcategory', () => {
    const g = countGroups(items, categories, locations, 'category', false);
    expect(g.map((x) => x.name)).toEqual(['Motors', 'Structure', 'Unlisted']);
    expect(ids(g[0]!)).toEqual(['m-brushless', 'm-brushed', 'm-none']);
  });

  it('by location follows the Location walk order, then "No location" (blank or not in the list)', () => {
    const g = countGroups(items, categories, locations, 'location', false);
    expect(g.map((x) => x.name)).toEqual(['Bin A', 'Shelf B', 'No location']);
    // Location names match ignoring capitals; list order inside a location.
    expect(ids(g[0]!)).toEqual(['m-brushless', 's-1']);
    expect(ids(g[2]!)).toEqual(['m-none', 'x-1']);
  });

  it('scan mode tracks progress by category', () => {
    expect(countGroups(items, categories, locations, 'scan', false).map((x) => x.name)).toEqual(['Motors', 'Structure', 'Unlisted']);
  });

  it('"skip items with desired 0" takes them out of the walk, and empty groups disappear', () => {
    const g = countGroups(items, categories, locations, 'category', true);
    expect(ids(g[0]!)).toEqual(['m-brushless', 'm-brushed']);
    const only0 = [item({ id: 'z', category: 'Structure', desired: 0 })];
    expect(countGroups(only0, categories, [], 'category', true)).toEqual([]);
  });

  it('overall progress still counts every item, including desired 0 (D8)', () => {
    expect(overallProgress(items)).toEqual({ counted: 1, total: 5 });
  });

  it('counts per group and Start / Continue / Recount', () => {
    const g = countGroups(items, categories, locations, 'category', false);
    expect(g.map((x) => [x.counted, x.items.length, x.action])).toEqual([
      [1, 3, 'continue'],
      [0, 1, 'start'],
      [0, 1, 'start'],
    ]);
    expect(groupAction(0, 3)).toBe('start');
    expect(groupAction(2, 3)).toBe('continue');
    expect(groupAction(3, 3)).toBe('recount');
  });

  it('an unused location gets no group', () => {
    const g = countGroups(items, categories, [...locations, { name: 'Empty', notes: '', order: 2 }], 'location', false);
    expect(g.map((x) => x.name)).not.toContain('Empty');
  });
});

describe('firstToCount — resume where the count stopped', () => {
  it('opens at the first item not counted yet', () => {
    expect(firstToCount([item({ lastCounted: '2026-10-01' }), item({ lastCounted: '2026-10-01' }), item(), item()])).toBe(2);
  });
  it('starts a recount at the top', () => {
    expect(firstToCount([item({ lastCounted: '2026-10-01' }), item({ lastCounted: '2026-10-02' })])).toBe(0);
  });
  it('first item when nothing is counted', () => {
    expect(firstToCount([item(), item({ lastCounted: '2026-10-01' })])).toBe(0);
  });
});

describe('keypad', () => {
  const press = (keys: PadKey[], desired = 7, start = '') => keys.reduce((e, k) => pressKey(e, k, desired), start);

  it('digits build the number; a leading zero is replaced', () => {
    expect(press(['1', '2'])).toBe('12');
    expect(press(['0', '5'])).toBe('5');
    expect(press(['0', '0'])).toBe('0');
  });
  it(`stops at ${MAX_DIGITS} digits`, () => {
    expect(press(['1', '2', '3', '4', '5', '6'])).toBe('12345');
  });
  it('delete removes the last digit, and does nothing when empty', () => {
    expect(press(['4', '2', 'back'])).toBe('4');
    expect(press(['back'])).toBe('');
  });
  it('None is 0 and "= desired" sets the desired amount', () => {
    expect(press(['5', 'none'])).toBe('0');
    expect(press(['desired'], 12)).toBe('12');
    expect(press(['desired', '3'], 0)).toBe('3');
  });
  it('±1 start from 0 when empty and never go below 0', () => {
    expect(press(['plus'])).toBe('1');
    expect(press(['minus'])).toBe('0');
    expect(press(['3', 'minus', 'minus', 'minus', 'minus'])).toBe('0');
    expect(press(['9', 'plus'])).toBe('10');
  });
  it('+1 stops at the largest number the keypad can show', () => {
    expect(press(['plus'], 0, '99999')).toBe('99999');
    expect(press(['plus'], 0, '99998')).toBe('99999');
  });
  it('entryValue: null until something is typed', () => {
    expect(entryValue('')).toBeNull();
    expect(entryValue('0')).toBe(0);
    expect(entryValue('42')).toBe(42);
  });
});

describe('status preview ("After saving")', () => {
  const it3 = item({ desired: 3, spares: 2 });
  it.each([
    ['2', { kind: 'short', short: 1 }],
    ['3', { kind: 'low' }],
    ['4', { kind: 'low' }],
    ['5', { kind: 'ok' }],
    ['0', { kind: 'short', short: 3 }],
  ])('%s → %o', (entry, status) => {
    expect(previewStatus(it3, entry)).toEqual(status);
  });
  it('no preview while nothing is typed', () => {
    expect(previewStatus(it3, '')).toBeNull();
  });
});

describe('group summary (10d)', () => {
  const walk = ['a', 'b', 'c', 'd'];
  const now = [
    item({ id: 'a', desired: 5, onHand: 2, lastCounted: '2026-10-18' }),
    // Low spares, not short: the summary's Short tile leaves it out.
    item({ id: 'b', desired: 1, spares: 2, onHand: 1, lastCounted: '2026-10-18', location: 'Moved shelf' }),
    item({ id: 'c', desired: 1, onHand: 0 }),
    item({ id: 'd', desired: 1, onHand: 0, lastCounted: '2026-09-01' }),
  ];

  it('counted, short, skipped and the just-counted rows', () => {
    const s = summarize(walk, now, new Set(['a', 'b']), new Set(['c']));
    expect(s).toMatchObject({ counted: 3, total: 4, short: 1, skipped: 1 });
    // b moved to another location during the walk and still belongs to it.
    expect(s.justCounted.map((i) => i.id)).toEqual(['a', 'b']);
  });

  it('an item skipped and then counted (Back) is not skipped', () => {
    expect(summarize(walk, now, new Set(['a', 'c']), new Set(['c'])).skipped).toBe(0);
  });

  it('an item deleted during the walk drops out', () => {
    expect(summarize(walk, now.slice(1), new Set(['b']), new Set()).total).toBe(3);
  });

  it('order total before → after drops as on-hand rises', () => {
    const v = vendor({ packSize: 1, packPriceCents: 1000 });
    const before = [item({ id: 'a', desired: 4, vendors: [v, null, null] })];
    expect(orderTotalCents(before)).toBe(4000);
    expect(orderTotalCents([{ ...before[0]!, onHand: 3 }])).toBe(1000);
  });
});

describe('count rounds — "counted since <date>" (SPEC v0.6 F24)', () => {
  const old = item({ id: 'old', lastCounted: '2026-09-30' });
  const onDay = item({ id: 'day', lastCounted: '2026-10-01' });
  const never = item({ id: 'never' });
  const all = [old, onDay, never];

  it('blank since: counted at any time', () => {
    expect([old, onDay, never].map((i) => isCounted(i))).toEqual([true, true, false]);
  });
  it('a date: counted on or after it', () => {
    expect([old, onDay, never].map((i) => isCounted(i, '2026-10-01'))).toEqual([false, true, false]);
  });
  it('progress, groups, Continue and the summary all follow the round', () => {
    const cats = [{ name: 'Motors', order: 0, subcategories: [] }];
    expect(overallProgress(all, '2026-10-01')).toEqual({ counted: 1, total: 3 });
    const [g] = countGroups(all, cats, [], 'category', false, '2026-10-01');
    expect([g!.counted, g!.action]).toEqual([1, 'continue']);
    expect(firstToCount(all, '2026-10-01')).toBe(0);
    expect(firstToCount(all)).toBe(2);
    expect(summarize(['old', 'day', 'never'], all, new Set(), new Set(), '2026-10-01').counted).toBe(1);
  });
  it('a new round with nothing counted yet starts every group again', () => {
    const cats = [{ name: 'Motors', order: 0, subcategories: [] }];
    const [g] = countGroups([old, onDay], cats, [], 'category', false, '2026-10-18');
    expect([g!.counted, g!.action]).toEqual([0, 'start']);
  });
  it('cleanSince keeps a YYYY-MM-DD date and turns anything else into none', () => {
    expect(['2026-10-18', '', '2026-1-8', 'yesterday', 42, null].map(cleanSince)).toEqual(['2026-10-18', '', '', '', '', '']);
  });
});

describe('nextGroup', () => {
  const g = (name: string, counted: number, total: number) => ({ name, items: Array.from({ length: total }, () => item()), counted, action: groupAction(counted, total) });
  const groups = [g('A', 1, 1), g('B', 2, 2), g('C', 0, 3), g('D', 1, 1)];
  it('offers the next group that still needs counting', () => {
    expect(nextGroup(groups, 'A')?.name).toBe('C');
  });
  it('falls back to the next group when all later ones are counted', () => {
    expect(nextGroup(groups, 'C')?.name).toBe('D');
  });
  it('nothing after the last group', () => {
    expect(nextGroup(groups, 'D')).toBeNull();
  });
});
