// Count-in (F24): walk order, progress, the keypad and the group summary. Pure, so it is
// unit-tested; the screen and the save live in ui/screens/count and data/count.ts.
import { countedDate } from './dates';
import { listOrder } from './inventory-view';
import { NO_LOCATION } from './lists';
import { buildOrderList } from './order';
import { stockStatus, type StockStatus } from './status';
import { nameKey, type Category, type Item, type Location } from './types';

export type CountMode = 'category' | 'location' | 'scan';

/**
 * Counted in this round (F24 count rounds): the local date of last_counted is on or after
 * `since` (YYYY-MM-DD dates compare as text). A blank `since` (the first count) means counted
 * at any time.
 */
export const isCounted = (i: Item, since = '') => {
  const day = countedDate(i.lastCounted);
  return day !== '' && day >= since;
};

/** A "counting since" date as stored: YYYY-MM-DD, or '' for none. Anything else counts as none. */
export const cleanSince = (v: unknown): string => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '');

/** "Skip items with desired 0" takes them out of the walk, not out of overall progress (D8). */
export const inWalk = (i: Item, skipZero: boolean) => !(skipZero && i.desired === 0);

/** Overall progress counts every item (D8). */
export function overallProgress(items: readonly Item[], since = ''): { counted: number; total: number } {
  return { counted: items.filter((i) => isCounted(i, since)).length, total: items.length };
}

export type GroupAction = 'start' | 'continue' | 'recount';

export interface CountGroup {
  name: string;
  /** In walk order, already filtered by "skip items with desired 0". */
  items: Item[];
  counted: number;
  action: GroupAction;
}

export const groupAction = (counted: number, total: number): GroupAction => (counted === 0 ? 'start' : counted < total ? 'continue' : 'recount');

/**
 * The groups for the start screen, in walk order. By category: the category list, items in
 * Inventory list order. By location: the Location list's walk order (F25), then "No location"
 * (no location, or one that isn't in the list), items in list order inside each. Scan mode
 * tracks progress by category. Groups left empty by the desired-0 option are dropped.
 */
export function countGroups(items: readonly Item[], categories: readonly Category[], locations: readonly Location[], mode: CountMode, skipZero: boolean, since = ''): CountGroup[] {
  const ordered = listOrder(items, categories).filter((i) => inWalk(i, skipZero));
  const groups: Array<{ name: string; items: Item[] }> = [];
  if (mode === 'location') {
    const walk = [...locations].sort((a, b) => a.order - b.order);
    const known = new Set(walk.map((l) => nameKey(l.name)));
    for (const l of walk)
      groups.push({
        name: l.name,
        items: ordered.filter((i) => i.location !== '' && nameKey(i.location) === nameKey(l.name)),
      });
    groups.push({
      name: NO_LOCATION,
      items: ordered.filter((i) => i.location === '' || !known.has(nameKey(i.location))),
    });
  } else {
    for (const i of ordered) {
      const g = groups.find((x) => x.name === i.category);
      if (g) g.items.push(i);
      else groups.push({ name: i.category, items: [i] });
    }
  }
  return groups
    .filter((g) => g.items.length > 0)
    .map((g) => {
      const counted = g.items.filter((i) => isCounted(i, since)).length;
      return { ...g, counted, action: groupAction(counted, g.items.length) };
    });
}

/** Where Start/Continue opens a walk: the first item not counted yet, or the first item for a recount. */
export function firstToCount(items: readonly Item[], since = ''): number {
  const i = items.findIndex((x) => !isCounted(x, since));
  return i < 0 ? 0 : i;
}

// ── Keypad ──

export const MAX_DIGITS = 5;

export type PadKey = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | 'back' | 'none' | 'desired' | 'minus' | 'plus';

/**
 * The typed count after one key. '' means nothing typed yet. Leading zeros are dropped, at
 * most MAX_DIGITS digits; None is 0; "= desired" sets the desired amount; ±1 start from 0
 * when nothing is typed and never go below 0.
 */
export function pressKey(entry: string, key: PadKey, desired: number): string {
  const n = entry === '' ? 0 : Number(entry);
  switch (key) {
    case 'back':
      return entry.slice(0, -1);
    case 'none':
      return '0';
    case 'desired':
      return String(desired);
    case 'minus':
      return String(Math.max(0, n - 1));
    case 'plus':
      return n + 1 >= 10 ** MAX_DIGITS ? entry : String(n + 1);
    default: {
      const next = (entry === '0' ? '' : entry) + key;
      return next.length > MAX_DIGITS ? entry : next;
    }
  }
}

/** The typed count, or null when nothing is typed (Save & next stays off). */
export const entryValue = (entry: string): number | null => (/^\d+$/.test(entry) ? Number(entry) : null);

/** "After saving: …" preview for a typed count. */
export const previewStatus = (item: Item, entry: string): StockStatus | null => {
  const v = entryValue(entry);
  return v === null ? null : stockStatus(v, item.desired, item.spares);
};

// ── Group summary ──

export const orderTotalCents = (items: readonly Item[]) => buildOrderList(items).grandTotalCents;

export interface CountSummary {
  /** Items in the group counted (in this round), of the group size. */
  counted: number;
  total: number;
  /** Items counted in this walk that are now short. */
  short: number;
  /** Items skipped in this walk and not counted afterwards. */
  skipped: number;
  /** Items counted in this walk, in walk order, as stored now. */
  justCounted: Item[];
}

/**
 * The summary after a group (10d). `ids` is the walk as it started; `items` is the inventory
 * now, so an item moved to another location mid-walk still belongs to the walk it was in.
 */
export function summarize(ids: readonly string[], items: readonly Item[], savedIds: ReadonlySet<string>, skippedIds: ReadonlySet<string>, since = ''): CountSummary {
  const byId = new Map(items.map((i) => [i.id, i]));
  const walk = ids.flatMap((id) => byId.get(id) ?? []);
  const justCounted = walk.filter((i) => savedIds.has(i.id));
  return {
    counted: walk.filter((i) => isCounted(i, since)).length,
    total: walk.length,
    short: justCounted.filter((i) => stockStatus(i.onHand, i.desired, i.spares).kind === 'short').length,
    skipped: walk.filter((i) => skippedIds.has(i.id) && !savedIds.has(i.id)).length,
    justCounted,
  };
}

/** The group to offer after this one: the next one in walk order that isn't fully counted, else the next one. */
export function nextGroup(groups: readonly CountGroup[], current: string): CountGroup | null {
  const at = groups.findIndex((g) => g.name === current);
  const after = groups.slice(at + 1);
  return after.find((g) => g.action !== 'recount') ?? after[0] ?? null;
}
