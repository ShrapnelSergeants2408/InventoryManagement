// UI-only state kept in localStorage (stage4-plan §3): expanded groups (F1), filters (F5),
// the last label layout (§9), the count-in options and pause point (F24) and the order
// history's range (§21.5).
// Never inventory data. Any read/write failure (private mode, blocked storage) falls back to defaults.
import type { CountMode } from '../domain/count';
import { NO_FILTERS, type Filters } from '../domain/filters';
import { DEFAULT_RANGE, RANGE_KINDS, type RangeKind } from '../domain/order-history';

export type KeyValueStore = Pick<Storage, 'getItem' | 'setItem'>;

const EXPANDED = 'frc2408.inventory.expanded';
const FILTERS = 'frc2408.inventory.filters';

function browserStore(): KeyValueStore | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function read(store: KeyValueStore | null, key: string): unknown {
  try {
    const raw = store?.getItem(key);
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
}

function write(store: KeyValueStore | null, key: string, value: unknown): void {
  try {
    store?.setItem(key, JSON.stringify(value));
  } catch {
    // Full or blocked storage: the preference just isn't remembered.
  }
}

export function loadExpanded(store = browserStore()): Set<string> {
  const v = read(store, EXPANDED);
  return new Set(Array.isArray(v) ? v.filter((k): k is string => typeof k === 'string') : []);
}

export function saveExpanded(expanded: ReadonlySet<string>, store = browserStore()): void {
  write(store, EXPANDED, [...expanded]);
}

const strOrNull = (v: unknown) => (typeof v === 'string' ? v : null);

export function loadFilters(store = browserStore()): Filters {
  const v = read(store, FILTERS);
  if (typeof v !== 'object' || v === null) return { ...NO_FILTERS };
  const o = v as Record<string, unknown>;
  return {
    needsOrder: o.needsOrder === true,
    short: o.short === true,
    low: o.low === true,
    category: strOrNull(o.category),
    supplier: strOrNull(o.supplier),
    location: strOrNull(o.location),
  };
}

export function saveFilters(filters: Filters, store = browserStore()): void {
  write(store, FILTERS, filters);
}

const LABEL_LAYOUT = 'frc2408.labels.layout';

/** The label layout and plain-paper QR size used last; checked by the caller. */
export function loadLabelChoice(store = browserStore()): { layoutId: string | null; plainQr: number | null } {
  const v = read(store, LABEL_LAYOUT);
  const o = (typeof v === 'object' && v !== null ? v : {}) as Record<string, unknown>;
  return { layoutId: strOrNull(o.layoutId), plainQr: typeof o.plainQr === 'number' ? o.plainQr : null };
}

export function saveLabelChoice(choice: { layoutId: string; plainQr: number }, store = browserStore()): void {
  write(store, LABEL_LAYOUT, choice);
}

const COUNT_OPTIONS = 'frc2408.count.options';

export interface CountOptions {
  mode: CountMode;
  /** Ask for a location while counting (F24: on by default). */
  askLocation: boolean;
  skipZero: boolean;
}

export const DEFAULT_COUNT_OPTIONS: CountOptions = { mode: 'category', askLocation: true, skipZero: false };

export function loadCountOptions(store = browserStore()): CountOptions {
  const v = read(store, COUNT_OPTIONS);
  const o = (typeof v === 'object' && v !== null ? v : {}) as Record<string, unknown>;
  const d = DEFAULT_COUNT_OPTIONS;
  return {
    mode: o.mode === 'category' || o.mode === 'location' || o.mode === 'scan' ? o.mode : d.mode,
    askLocation: typeof o.askLocation === 'boolean' ? o.askLocation : d.askLocation,
    skipZero: typeof o.skipZero === 'boolean' ? o.skipZero : d.skipZero,
  };
}

export function saveCountOptions(options: CountOptions, store = browserStore()): void {
  write(store, COUNT_OPTIONS, options);
}

const COUNT_PAUSE = 'frc2408.count.paused';

/** Where a walk was paused, so the start screen can offer to pick it up (F24 resume). */
export interface CountPause {
  mode: 'category' | 'location';
  group: string;
  /** The item that was on screen. */
  itemId: string;
}

export function loadCountPause(store = browserStore()): CountPause | null {
  const v = read(store, COUNT_PAUSE);
  const o = (typeof v === 'object' && v !== null ? v : {}) as Record<string, unknown>;
  if ((o.mode !== 'category' && o.mode !== 'location') || typeof o.group !== 'string' || typeof o.itemId !== 'string') return null;
  return { mode: o.mode, group: o.group, itemId: o.itemId };
}

export function saveCountPause(pause: CountPause | null, store = browserStore()): void {
  write(store, COUNT_PAUSE, pause);
}

const HISTORY_RANGE = 'frc2408.order.historyRange';

/** The order history's range (§21.5: remembered on the device), with the custom dates. */
export interface HistoryRangeChoice {
  kind: RangeKind;
  from: string;
  to: string;
}

const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

export function loadHistoryRange(store = browserStore()): HistoryRangeChoice {
  const v = read(store, HISTORY_RANGE);
  const o = (typeof v === 'object' && v !== null ? v : {}) as Record<string, unknown>;
  return {
    kind: RANGE_KINDS.includes(o.kind as RangeKind) ? (o.kind as RangeKind) : DEFAULT_RANGE,
    from: isDate(o.from) ? o.from : '',
    to: isDate(o.to) ? o.to : '',
  };
}

export function saveHistoryRange(choice: HistoryRangeChoice, store = browserStore()): void {
  write(store, HISTORY_RANGE, choice);
}
