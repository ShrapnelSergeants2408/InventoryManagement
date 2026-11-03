// UI-only state kept in localStorage: the last part used (F21), Browse's view, expanded groups
// and filters per part (F2), the last label layout (§9) and the recently viewed records (F1).
// Never inventory data. Any read/write failure (private mode, blocked storage) falls back to
// defaults.
import type { BrowseBy } from '../domain/browse';
import { NO_FILTERS, type Filters } from '../domain/filters';
import type { Part } from '../domain/types';

export type KeyValueStore = Pick<Storage, 'getItem' | 'setItem'>;

const EXPANDED = (part: Part) => `hhi.browse.${part}.expanded`;
const FILTERS = (part: Part) => `hhi.browse.${part}.filters`;
const BROWSE_BY = (part: Part) => `hhi.browse.${part}.by`;
const PART = 'hhi.part';

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

/** The part the app opens in: the last one used, else Holiday (§12.5). */
export function loadPart(store = browserStore()): Part {
  const v = read(store, PART);
  return v === 'household' || v === 'holiday' ? v : 'holiday';
}

export function savePart(part: Part, store = browserStore()): void {
  write(store, PART, part);
}

/** Browse's view for a part: By place unless another was chosen (By season is Holiday only). */
export function loadBrowseBy(part: Part, store = browserStore()): BrowseBy {
  const v = read(store, BROWSE_BY(part));
  return v === 'category' || (v === 'season' && part === 'holiday') ? v : 'place';
}

export function saveBrowseBy(part: Part, by: BrowseBy, store = browserStore()): void {
  write(store, BROWSE_BY(part), by);
}

export function loadExpanded(part: Part, store = browserStore()): Set<string> {
  const v = read(store, EXPANDED(part));
  return new Set(Array.isArray(v) ? v.filter((k): k is string => typeof k === 'string') : []);
}

export function saveExpanded(part: Part, expanded: ReadonlySet<string>, store = browserStore()): void {
  write(store, EXPANDED(part), [...expanded]);
}

const strOrNull = (v: unknown) => (typeof v === 'string' ? v : null);

export function loadFilters(part: Part, store = browserStore()): Filters {
  const v = read(store, FILTERS(part));
  if (typeof v !== 'object' || v === null) return { ...NO_FILTERS };
  const o = v as Record<string, unknown>;
  return {
    category: strOrNull(o.category),
    area: strOrNull(o.area),
    season: part === 'holiday' ? strOrNull(o.season) : null,
    status: o.status === 'stored' || o.status === 'out' || o.status === 'lent' ? o.status : null,
    attention: o.attention === true,
    tag: strOrNull(o.tag),
  };
}

export function saveFilters(part: Part, filters: Filters, store = browserStore()): void {
  write(store, FILTERS(part), filters);
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

/** How many recently viewed records Find offers per part (F1); more are kept so both parts have 8. */
export const RECENT_MAX = 8;
const RECENT_KEPT = 40;

/** Record ids (items, bins, spots) whose detail screen was opened, newest first. */
export function loadRecent(store = browserStore()): string[] {
  const v = read(store, RECENT);
  return Array.isArray(v) ? v.filter((k): k is string => typeof k === 'string').slice(0, RECENT_KEPT) : [];
}

/** Puts a record first in the recently viewed list. */
export function noteViewed(id: string, store = browserStore()): void {
  write(store, RECENT, [id, ...loadRecent(store).filter((x) => x !== id)].slice(0, RECENT_KEPT));
}
