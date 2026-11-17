// M33 (review R9): moving through a count-in, now pure steps in src/domain/count-walk.ts.
import { describe, expect, it } from 'vitest';
import type { CountGroup } from '../src/domain/count';
import {
  moveTo,
  openWalk,
  pausedAt,
  savedStep,
  scanBack,
  scanOpen,
  scanSaved,
  scanSkip,
  skippedStep,
  startScan,
  type Walk,
} from '../src/domain/count-walk';
import { item } from './helpers';

const group = (name: string, ids: string[]): CountGroup => ({ name, items: ids.map((id) => item({ id })) }) as unknown as CountGroup;
const walkOf = (step: { view: { kind: string } }): Walk => {
  const v = step.view as { kind: 'walk' | 'done'; walk: Walk };
  return v.walk;
};

describe('a walk through a group', () => {
  const g = group('Motors', ['a', 'b', 'c']);

  it('opens at the given item, frozen, and remembers the pause there', () => {
    const s = openWalk('category', g, 1, 4200);
    expect(s.view.kind).toBe('walk');
    expect(walkOf(s)).toMatchObject({ mode: 'category', group: 'Motors', ids: ['a', 'b', 'c'], index: 1, beforeCents: 4200 });
    expect(s.pause).toEqual({ mode: 'category', group: 'Motors', itemId: 'b' });
  });

  it('save and skip move on and record the item; the pause follows', () => {
    const w = walkOf(openWalk('location', g, 0, 0));
    const s1 = savedStep(w, 'a');
    expect([walkOf(s1).index, [...walkOf(s1).saved], s1.pause?.itemId]).toEqual([1, ['a'], 'b']);
    const s2 = skippedStep(walkOf(s1), 'b');
    expect([walkOf(s2).index, [...walkOf(s2).saved], [...walkOf(s2).skipped], s2.pause?.itemId]).toEqual([2, ['a'], ['b'], 'c']);
  });

  it('past the last item: the summary, and no pause to remember', () => {
    const w = walkOf(openWalk('category', g, 2, 0));
    const s = savedStep(w, 'c');
    expect(s.view.kind).toBe('done');
    expect(s.pause).toBeNull();
    expect([...walkOf(s).saved]).toEqual(['c']);
  });

  it('back goes to the previous item without changing what was saved', () => {
    const w = walkOf(savedStep(walkOf(openWalk('category', g, 0, 0)), 'a'));
    const s = moveTo(w, w.index - 1);
    expect([walkOf(s).index, [...walkOf(s).saved], s.pause?.itemId]).toEqual([0, ['a'], 'a']);
  });

  it('a step never changes the walk it came from', () => {
    const w = walkOf(openWalk('category', g, 0, 0));
    savedStep(w, 'a');
    skippedStep(w, 'a');
    expect([w.index, w.saved.size, w.skipped.size]).toEqual([0, 0, 0]);
  });
});

describe('scan as you go', () => {
  it('opening an item puts the one on screen in the history; back brings it up again', () => {
    let s = scanOpen(startScan(), 'a');
    expect([s.current, s.history]).toEqual(['a', []]);
    s = scanOpen(s, 'b');
    expect([s.current, s.history]).toEqual(['b', ['a']]);
    s = scanBack(s);
    expect([s.current, s.history]).toEqual(['a', []]);
  });

  it('back with no history changes nothing', () => {
    const s = startScan();
    expect(scanBack(s)).toBe(s);
  });

  it('skip goes back to scanning, keeping the item in the history', () => {
    const s = scanSkip(scanOpen(startScan(), 'a'));
    expect([s.current, s.history, s.saved.size]).toEqual([null, ['a'], 0]);
  });

  it('save goes back to scanning with the item counted', () => {
    const s = scanSaved(scanOpen(startScan(), 'a'), 'a');
    expect([s.current, s.history, [...s.saved]]).toEqual([null, ['a'], ['a']]);
  });
});

describe('picking up a paused count', () => {
  const groups = { category: [group('Motors', ['a', 'b'])], location: [group('Bin 1', ['b'])] };
  const groupsFor = (m: 'category' | 'location') => groups[m];

  it('finds the group and the item', () => {
    const p = pausedAt({ mode: 'category', group: 'Motors', itemId: 'b' }, groupsFor);
    expect(p && [p.mode, p.group.name, p.at]).toEqual(['category', 'Motors', 1]);
  });

  it('none when nothing is paused, or the group or item is gone', () => {
    expect(pausedAt(null, groupsFor)).toBeNull();
    expect(pausedAt({ mode: 'category', group: 'Gone', itemId: 'a' }, groupsFor)).toBeNull();
    expect(pausedAt({ mode: 'location', group: 'Bin 1', itemId: 'a' }, groupsFor)).toBeNull();
  });
});
