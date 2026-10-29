import { describe, expect, it } from 'vitest';
import { itemStatus, statusLabel, stockStatus } from '../src/domain/status';

describe('SPEC §4 stock highlighting', () => {
  // desired 10, spares 3: red below 10, yellow 10–12, OK from 13
  it.each([
    [0, 'short', 'SHORT 10'],
    [9, 'short', 'SHORT 1'],
    [10, 'low', 'LOW SPARES'],
    [12, 'low', 'LOW SPARES'],
    [13, 'ok', 'OK'],
    [50, 'ok', 'OK'],
  ] as const)('on hand %i (desired 10, spares 3) → %s', (onHand, kind, label) => {
    const s = stockStatus(onHand, 10, 3);
    expect(s.kind).toBe(kind);
    expect(statusLabel(s)).toBe(label);
  });

  it('with spares 0 there is no yellow state: short below desired, OK at desired', () => {
    expect(stockStatus(4, 5, 0).kind).toBe('short');
    expect(stockStatus(5, 5, 0).kind).toBe('ok');
  });

  it('desired 0 and spares 0 is OK even at on hand 0', () => {
    expect(stockStatus(0, 0, 0).kind).toBe('ok');
  });

  it('desired 0 with spares is yellow until spares are met', () => {
    expect(stockStatus(1, 0, 2).kind).toBe('low');
    expect(stockStatus(2, 0, 2).kind).toBe('ok');
  });
});

describe('not counted yet (v0.16)', () => {
  it('a blank last_counted shows NOT COUNTED whatever the numbers; a counted item shows its stock status', () => {
    expect(itemStatus({ onHand: 0, desired: 8, spares: 0, lastCounted: '' })).toEqual({ kind: 'uncounted' });
    expect(statusLabel(itemStatus({ onHand: 9, desired: 8, spares: 0, lastCounted: '' }))).toBe('NOT COUNTED');
    expect(itemStatus({ onHand: 0, desired: 8, spares: 0, lastCounted: '2026-10-29T18:00-05:00' })).toEqual({ kind: 'short', short: 8 });
  });
});
