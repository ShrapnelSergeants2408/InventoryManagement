import { describe, expect, it } from 'vitest';
import { RECENT_MAX, loadExpanded, loadFilters, loadRecent, noteViewed, saveExpanded, saveFilters, type KeyValueStore } from '../src/data/prefs';
import { NO_FILTERS } from '../src/domain/filters';

function memoryStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

const throwing: KeyValueStore = {
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('QuotaExceededError');
  },
};

describe('remembered list state (F1 expanded groups, F5 filters)', () => {
  it('expanded groups round-trip', () => {
    const s = memoryStore();
    saveExpanded(new Set(['["Motors"]', '["Motors","Brushless"]']), s);
    expect(loadExpanded(s)).toEqual(new Set(['["Motors"]', '["Motors","Brushless"]']));
  });

  it('filters round-trip, including "No location"', () => {
    const s = memoryStore();
    const f = { ...NO_FILTERS, short: true, location: '', supplier: 'WCP' };
    saveFilters(f, s);
    expect(loadFilters(s)).toEqual(f);
  });

  it('nothing saved → defaults', () => {
    const s = memoryStore();
    expect(loadExpanded(s)).toEqual(new Set());
    expect(loadFilters(s)).toEqual(NO_FILTERS);
  });

  it('corrupt or wrong-shaped values → defaults', () => {
    const s = memoryStore();
    s.data.set('frc2408.inventory.expanded', '{not json');
    s.data.set('frc2408.inventory.filters', '{"short":"yes","category":5,"location":null}');
    expect(loadExpanded(s)).toEqual(new Set());
    expect(loadFilters(s)).toEqual(NO_FILTERS);
    s.data.set('frc2408.inventory.expanded', '["a",3,null]');
    expect(loadExpanded(s)).toEqual(new Set(['a']));
  });

  it('blocked storage never throws', () => {
    expect(loadExpanded(throwing)).toEqual(new Set());
    expect(loadFilters(throwing)).toEqual(NO_FILTERS);
    expect(() => saveExpanded(new Set(['x']), throwing)).not.toThrow();
    expect(() => saveFilters(NO_FILTERS, throwing)).not.toThrow();
    expect(loadFilters(null)).toEqual(NO_FILTERS);
  });
});

describe('recently viewed items (v0.17)', () => {
  it('newest first, each once, at most ${RECENT_MAX}', () => {
    const store = memoryStore();
    expect(loadRecent(store)).toEqual([]);
    for (const id of ['a', 'b', 'c', 'a']) noteViewed(id, store);
    expect(loadRecent(store)).toEqual(['a', 'c', 'b']);
    for (let i = 0; i < 20; i++) noteViewed(`x${i}`, store);
    expect(loadRecent(store)).toHaveLength(RECENT_MAX);
    expect(loadRecent(store)[0]).toBe('x19');
  });
  it('bad or blocked storage gives an empty list and never throws', () => {
    const store = memoryStore();
    store.setItem('frc2408.inventory.recent', '{"not":"a list"}');
    expect(loadRecent(store)).toEqual([]);
    const blocked: KeyValueStore = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(loadRecent(blocked)).toEqual([]);
    expect(() => noteViewed('a', blocked)).not.toThrow();
  });
});
