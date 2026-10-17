import { describe, expect, it } from 'vitest';
import { loadExpanded, loadFilters, saveExpanded, saveFilters, type KeyValueStore } from '../src/data/prefs';
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
