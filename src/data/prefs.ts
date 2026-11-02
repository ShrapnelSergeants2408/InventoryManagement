// UI-only state kept in localStorage: expanded groups and filters (F2), the last label layout
// (§9) and the recently viewed items (F1). Never inventory data. Any read/write failure
// (private mode, blocked storage) falls back to defaults.
import { NO_FILTERS, type Filters } from '../domain/filters';

export type KeyValueStore = Pick<Storage, 'getItem' | 'setItem'>;

const EXPANDED = 'hhi.inventory.expanded';
const FILTERS = 'hhi.inventory.filters';

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
    category: strOrNull(o.category),
    area: strOrNull(o.area),
    season: strOrNull(o.season),
    status: o.status === 'stored' || o.status === 'out' || o.status === 'lent' ? o.status : null,
    attention: o.attention === true,
    tag: strOrNull(o.tag),
  };
}

export function saveFilters(filters: Filters, store = browserStore()): void {
  write(store, FILTERS, filters);
}

const LABEL_LAYOUT = 'hhi.labels.layout';

/** The label layout and plain-paper QR size used last; checked by the caller. */
export function loadLabelChoice(store = browserStore()): { layoutId: string | null; plainQr: number | null } {
  const v = read(store, LABEL_LAYOUT);
  const o = (typeof v === 'object' && v !== null ? v : {}) as Record<string, unknown>;
  return { layoutId: strOrNull(o.layoutId), plainQr: typeof o.plainQr === 'number' ? o.plainQr : null };
}

export function saveLabelChoice(choice: { layoutId: string; plainQr: number }, store = browserStore()): void {
  write(store, LABEL_LAYOUT, choice);
}

const RECENT = 'hhi.inventory.recent';

/** How many recently viewed items the search box offers (F1). */
export const RECENT_MAX = 8;

/** Record ids (items, bins, spots) whose detail screen was opened, newest first. */
export function loadRecent(store = browserStore()): string[] {
  const v = read(store, RECENT);
  return Array.isArray(v) ? v.filter((k): k is string => typeof k === 'string').slice(0, RECENT_MAX) : [];
}

/** Puts a record first in the recently viewed list. */
export function noteViewed(id: string, store = browserStore()): void {
  write(store, RECENT, [id, ...loadRecent(store).filter((x) => x !== id)].slice(0, RECENT_MAX));
}
