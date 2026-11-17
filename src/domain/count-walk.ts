// Moving through a count-in (F24; mockups 10a–10e) as pure steps (review R9, M33): which screen is up,
// which item is next, and what to remember so a paused count can be picked up. The Count screen
// keeps the state and calls these; the rules here are unit-tested.
import type { CountGroup } from './count';

/** A walk through one group, frozen when it starts so a location picked mid-walk doesn't reshuffle it. */
export interface Walk {
  mode: 'category' | 'location';
  group: string;
  ids: string[];
  index: number;
  /** Order-list total when the walk started (summary: before → after). */
  beforeCents: number;
  saved: ReadonlySet<string>;
  skipped: ReadonlySet<string>;
}

/** Scan as you go: the item on screen, the ones scanned before it, and those saved. */
export interface ScanState {
  kind: 'scan';
  current: string | null;
  history: string[];
  saved: ReadonlySet<string>;
}

export type CountView = { kind: 'start' } | { kind: 'walk'; walk: Walk } | { kind: 'done'; walk: Walk } | ScanState;

/** Where a walk was paused (kept on the device, data/prefs.ts CountPause). */
export interface Pause {
  mode: 'category' | 'location';
  group: string;
  itemId: string;
}

/** A step's result: the next screen, and the pause to remember (null: none, the walk is over). */
export interface Step {
  view: CountView;
  pause: Pause | null;
}

/** Opens a walk through `g` at `index`. */
export function openWalk(mode: 'category' | 'location', g: CountGroup, index: number, beforeCents: number): Step {
  const walk: Walk = { mode, group: g.name, ids: g.items.map((i) => i.id), index, beforeCents, saved: new Set(), skipped: new Set() };
  return { view: { kind: 'walk', walk }, pause: { mode, group: g.name, itemId: walk.ids[index]! } };
}

/** Moves to item `index` (with `patch` applied); past the last item, the summary. */
export function moveTo(walk: Walk, index: number, patch: Partial<Walk> = {}): Step {
  const next = { ...walk, ...patch };
  if (index >= walk.ids.length) return { view: { kind: 'done', walk: next }, pause: null };
  return { view: { kind: 'walk', walk: { ...next, index } }, pause: { mode: walk.mode, group: walk.group, itemId: walk.ids[index]! } };
}

/** The item was saved: on to the next one. */
export const savedStep = (walk: Walk, itemId: string): Step => moveTo(walk, walk.index + 1, { saved: new Set(walk.saved).add(itemId) });

/** The item was skipped: on to the next one. */
export const skippedStep = (walk: Walk, itemId: string): Step => moveTo(walk, walk.index + 1, { skipped: new Set(walk.skipped).add(itemId) });

/** A fresh scan-as-you-go. */
export const startScan = (): ScanState => ({ kind: 'scan', current: null, history: [], saved: new Set() });

/** A scanned item opens; the one on screen (if any) goes into the history. */
export function scanOpen(s: ScanState, id: string): ScanState {
  return { ...s, current: id, history: s.current ? [...s.history, s.current] : s.history };
}

/** Back: the previous item comes up again. */
export function scanBack(s: ScanState): ScanState {
  if (s.history.length === 0) return s;
  return { ...s, current: s.history.at(-1)!, history: s.history.slice(0, -1) };
}

/** Skip: the screen goes back to scanning. */
export function scanSkip(s: ScanState): ScanState {
  return { ...s, current: null, history: s.current ? [...s.history, s.current] : s.history };
}

/** Saved: back to scanning, the item counted. */
export function scanSaved(s: ScanState, id: string): ScanState {
  return { ...s, current: null, history: [...s.history, id], saved: new Set(s.saved).add(id) };
}

/** Where a remembered pause picks up, or null when its group or item is gone. */
export function pausedAt(pause: Pause | null, groupsFor: (mode: 'category' | 'location') => readonly CountGroup[]): { mode: 'category' | 'location'; group: CountGroup; at: number } | null {
  if (!pause) return null;
  const g = groupsFor(pause.mode).find((x) => x.name === pause.group);
  const at = g ? g.items.findIndex((i) => i.id === pause.itemId) : -1;
  return g && at >= 0 ? { mode: pause.mode, group: g, at } : null;
}
