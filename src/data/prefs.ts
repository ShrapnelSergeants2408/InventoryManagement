// UI-only state kept in localStorage (stage4-plan §3): expanded groups (F1) and filters (F5).
// Never inventory data. Any read/write failure (private mode, blocked storage) falls back to defaults.
import { NO_FILTERS, type Filters } from '../domain/filters';

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
