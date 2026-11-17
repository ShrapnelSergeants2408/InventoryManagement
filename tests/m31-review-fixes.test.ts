// M31 (SPEC v0.26): the row limit for search and filter results (R1) and when the app looks for a new version (R2).
import { describe, expect, it } from 'vitest';
import { NO_FILTERS } from '../src/domain/filters';
import { ROW_PAGE, buildInventoryView, limitLines, type ListLine } from '../src/domain/inventory-view';
import { CHECK_GAP_MS, dueForCheck, updateMessage, type UpdateResult } from '../src/domain/update-check';
import type { Category } from '../src/domain/types';
import { item } from './helpers';

const categories: Category[] = [
  { name: 'Motors', order: 0, subcategories: ['Brushless'] },
  { name: 'Fasteners', order: 1, subcategories: ['Bolts'] },
];

/** n items per category/subcategory, all named "Part …" so the search "part" matches every one. */
function many(n: number) {
  const out = [];
  for (const [category, subcategory] of [['Motors', 'Brushless'], ['Motors', ''], ['Fasteners', 'Bolts']] as const) {
    for (let i = 0; i < n; i++) out.push(item({ id: `${category}-${subcategory}-${i}`, name: `Part ${i}`, category, subcategory }));
  }
  return out;
}

const kinds = (lines: readonly ListLine[]) => lines.map((l) => (l.kind === 'item' ? 'i' : l.kind === 'category' ? `C:${l.name}` : `S:${l.name}`));

describe('limitLines (R1)', () => {
  const view = buildInventoryView({ items: many(3), categories, query: 'part', filters: { ...NO_FILTERS }, expanded: new Set() });

  it('keeps everything when the limit is not reached', () => {
    const r = limitLines(view.lines, 100);
    expect(r.hidden).toBe(0);
    expect(r.lines).toEqual(view.lines);
  });

  it('stops after the max-th item row and counts the rest as hidden', () => {
    const r = limitLines(view.lines, 4);
    expect(kinds(r.lines)).toEqual(['C:Motors', 'S:Brushless', 'i', 'i', 'i', 'i']);
    expect(r.hidden).toBe(5);
  });

  it('never leaves a header without its rows: headers after the cut are dropped', () => {
    const r = limitLines(view.lines, 6);
    expect(kinds(r.lines)).toEqual(['C:Motors', 'S:Brushless', 'i', 'i', 'i', 'i', 'i', 'i']);
    expect(r.lines.some((l) => l.kind === 'category' && l.name === 'Fasteners')).toBe(false);
    expect(r.hidden).toBe(3);
  });

  it('headers that are drawn keep their exact counts', () => {
    const r = limitLines(view.lines, 2);
    const motors = r.lines.find((l) => l.kind === 'category');
    expect(motors && motors.kind === 'category' ? [motors.matching, motors.total] : null).toEqual([6, 6]);
  });

  it('a larger limit shows more (Show more adds a page)', () => {
    expect(limitLines(view.lines, 4).hidden - limitLines(view.lines, 8).hidden).toBe(4);
  });

  it('the view itself is unchanged: shown, shownIds and totals cover every match', () => {
    const big = buildInventoryView({ items: many(200), categories, query: 'part', filters: { ...NO_FILTERS }, expanded: new Set() });
    const r = limitLines(big.lines, ROW_PAGE);
    expect(r.lines.filter((l) => l.kind === 'item')).toHaveLength(ROW_PAGE);
    expect(r.hidden).toBe(600 - ROW_PAGE);
    expect(big.shown).toBe(600);
    expect(big.shownIds).toHaveLength(600);
  });

  it('a page is 100 rows', () => {
    expect(ROW_PAGE).toBe(100);
  });
});

describe('dueForCheck (R2)', () => {
  const t = Date.UTC(2026, 10, 17, 12);
  it('is due when the last check was at least 30 minutes ago', () => {
    expect(dueForCheck(t, t - CHECK_GAP_MS)).toBe(true);
    expect(dueForCheck(t, 0)).toBe(true);
  });
  it('is not due sooner', () => {
    expect(dueForCheck(t, t - CHECK_GAP_MS + 1)).toBe(false);
    expect(dueForCheck(t, t)).toBe(false);
  });
  it('is due when the clock went backwards', () => {
    expect(dueForCheck(t, t + 1000)).toBe(true);
  });
});

describe('updateMessage (R2)', () => {
  it('names the version when this is the newest', () => {
    expect(updateMessage('current', '1.7.0')).toBe('This is the newest version (1.7.0).');
  });
  it('has a message for every result', () => {
    const all: UpdateResult[] = ['ready', 'current', 'offline', 'unsupported', 'failed'];
    for (const r of all) expect(updateMessage(r, '1.7.0').length).toBeGreaterThan(10);
    expect(updateMessage('ready', '1.7.0')).toContain('Reload');
  });
});
