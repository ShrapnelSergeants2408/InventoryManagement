import { describe, expect, it } from 'vitest';
import { RECENT_MAX, loadBrowseBy, loadExpanded, loadFilters, loadPart, loadRecent, noteViewed, saveBrowseBy, saveExpanded, saveFilters, savePart, type KeyValueStore } from '../src/data/prefs';
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

describe('remembered Browse state, per part (F2)', () => {
  it('expanded groups round-trip', () => {
    const s = memoryStore();
    saveExpanded('holiday', new Set(['["Motors"]', '["Motors","Brushless"]']), s);
    expect(loadExpanded('holiday', s)).toEqual(new Set(['["Motors"]', '["Motors","Brushless"]']));
    expect(loadExpanded('household', s)).toEqual(new Set());
  });

  it('filters round-trip, including "No home yet" and no season', () => {
    const s = memoryStore();
    const f = { ...NO_FILTERS, category: 'Lights', area: '', season: '', status: 'lent' as const, attention: true, tag: 'Fragile' };
    saveFilters('holiday', f, s);
    expect(loadFilters('holiday', s)).toEqual(f);
    // Household has no seasons, so a season filter is never read back there.
    saveFilters('household', f, s);
    expect(loadFilters('household', s)).toEqual({ ...f, season: null });
  });

  it('nothing saved → defaults', () => {
    const s = memoryStore();
    expect(loadExpanded('household', s)).toEqual(new Set());
    expect(loadFilters('household', s)).toEqual(NO_FILTERS);
  });

  it('corrupt or wrong-shaped values → defaults', () => {
    const s = memoryStore();
    s.data.set('hhi.browse.holiday.expanded', '{not json');
    s.data.set('hhi.browse.holiday.filters', '{"short":"yes","category":5,"location":null}');
    expect(loadExpanded('holiday', s)).toEqual(new Set());
    expect(loadFilters('holiday', s)).toEqual(NO_FILTERS);
    s.data.set('hhi.browse.holiday.expanded', '["a",3,null]');
    expect(loadExpanded('holiday', s)).toEqual(new Set(['a']));
  });

  it('blocked storage never throws', () => {
    expect(loadExpanded('holiday', throwing)).toEqual(new Set());
    expect(loadFilters('holiday', throwing)).toEqual(NO_FILTERS);
    expect(() => saveExpanded('holiday', new Set(['x']), throwing)).not.toThrow();
    expect(() => saveFilters('holiday', NO_FILTERS, throwing)).not.toThrow();
    expect(loadFilters('holiday', null)).toEqual(NO_FILTERS);
    expect(loadPart(throwing)).toBe('holiday');
    expect(() => savePart('household', throwing)).not.toThrow();
  });

  it('the view: By place by default; By season only in Holiday', () => {
    const s = memoryStore();
    expect(loadBrowseBy('household', s)).toBe('place');
    saveBrowseBy('holiday', 'season', s);
    expect(loadBrowseBy('holiday', s)).toBe('season');
    saveBrowseBy('household', 'season', s);
    expect(loadBrowseBy('household', s)).toBe('place');
    saveBrowseBy('household', 'category', s);
    expect(loadBrowseBy('household', s)).toBe('category');
  });
});

describe('the part the app opens in (F21)', () => {
  it('the last part used, else Holiday (§12.5)', () => {
    const s = memoryStore();
    expect(loadPart(s)).toBe('holiday');
    savePart('household', s);
    expect(loadPart(s)).toBe('household');
    s.data.set('hhi.part', '"garage"');
    expect(loadPart(s)).toBe('holiday');
  });
});

describe('recently viewed records (F1)', () => {
  it('newest first, each once; enough kept for both parts to show RECENT_MAX', () => {
    const store = memoryStore();
    expect(loadRecent(store)).toEqual([]);
    for (const id of ['a', 'b', 'c', 'a']) noteViewed(id, store);
    expect(loadRecent(store)).toEqual(['a', 'c', 'b']);
    for (let i = 0; i < 20; i++) noteViewed(`x${i}`, store);
    expect(loadRecent(store).length).toBeGreaterThanOrEqual(2 * RECENT_MAX);
    expect(loadRecent(store)[0]).toBe('x19');
    for (let i = 0; i < 100; i++) noteViewed(`y${i}`, store);
    expect(loadRecent(store).length).toBeLessThanOrEqual(40);
  });
  it('bad or blocked storage gives an empty list and never throws', () => {
    const store = memoryStore();
    store.setItem('hhi.inventory.recent', '{"not":"a list"}');
    expect(loadRecent(store)).toEqual([]);
    const blocked: KeyValueStore = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(loadRecent(blocked)).toEqual([]);
    expect(() => noteViewed('a', blocked)).not.toThrow();
  });
});
