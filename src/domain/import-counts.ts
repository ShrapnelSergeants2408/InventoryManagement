// Import counts on the shop tablet (SPEC §18.5): sort every incoming row into the preview
// groups, work out what Apply would save with the choices made so far, and what Undo needs to
// put back. Pure, so every row of the §18.5 table is unit-tested; data/import-counts.ts saves.
//
// The rows of every file are taken in order of counted_at (then helper, item: never the order
// the files were picked), against the tablet's items as they'd be after each earlier row. So
// conflicts between files come out the same way as conflicts with this tablet, and the same
// files give the same result in any order.
import { orderTotalCents } from './count';
import type { OnOrder } from './placed-orders';
import type { Helper } from './helpers';
import type { PendingRecord } from './helper-mode';
import { barcodeKey } from './scan';
import { nameKey, type Item, type Location } from './types';

/** counts.json (§18.4), as read. */
export interface CountsMeta {
  kitId: string;
  helperId: string;
  helperName: string;
  createdAt: string;
  sequence: number;
  appVersion: string;
}

/** One counts.csv row. `onHand` null: not counted, only the location or barcode changed (SPEC v0.11). */
export interface IncomingCount {
  itemId: string;
  onHand: number | null;
  /** Local date-time with offset; '' when not counted. */
  countedAt: string;
  /** '' = unchanged. */
  location: string;
  /** '' = unchanged. */
  barcode: string;
  outside: boolean;
}

export interface CountsFile {
  fileName: string;
  meta: CountsMeta;
  counts: IncomingCount[];
  newItems: PendingRecord[];
  /** locations-new.csv. */
  newLocations: string[];
  /** Pending id → photo. */
  photos: Map<string, Blob>;
}

export type ConflictChoice = 'keep' | 'helper' | 'add';
export type KeepOrUse = 'keep' | 'helper';
export type NewLocationChoice = { kind: 'add' } | { kind: 'same'; as: string };

/** What the person chose so far. Keys: PlanRow.key (conflicts, locations, barcodes), nameKey (new names). */
export interface ImportChoices {
  conflicts: Record<string, ConflictChoice>;
  locations: Record<string, KeepOrUse>;
  barcodes: Record<string, KeepOrUse>;
  newLocations: Record<string, NewLocationChoice>;
}

export const noChoices = (): ImportChoices => ({ conflicts: {}, locations: {}, barcodes: {}, newLocations: {} });

/**
 * How one incoming count is handled (the §18.5 table):
 * apply: a new count · same: matches on hand, applied quietly · conflict: needs a choice ·
 * applied: already applied (same helper, same or later time here) · unknown: no such item here ·
 * none: not a count (only a location or barcode).
 */
export type RowKind = 'apply' | 'same' | 'conflict' | 'applied' | 'unknown' | 'none';

/** The fields an import can change, and Undo puts back (§18.5). */
export interface CountFields {
  onHand: number;
  lastCounted: string;
  countedBy: string;
  location: string;
  barcode: string;
}

export interface PlanRow {
  /** helper|item|counted_at: the key for this row's choices. */
  key: string;
  fileName: string;
  helperName: string;
  itemId: string;
  /** The item as it is on this tablet now, or null (deleted since the kit). */
  item: Item | null;
  kind: RowKind;
  incoming: number | null;
  countedAt: string;
  outside: boolean;
  /** The item's count when this row is reached (after earlier rows). */
  before: Pick<CountFields, 'onHand' | 'lastCounted' | 'countedBy'> | null;
  conflict: { choice: ConflictChoice | null; keep: number; helper: number; add: number } | null;
  /** apply: the item has none here · same · choice: a different one here. */
  location: { name: string; state: 'apply' | 'same' | 'choice'; current: string; choice: KeepOrUse } | null;
  /** taken: another item has this barcode, so it isn't used. */
  barcode: { code: string; state: 'apply' | 'same' | 'choice' | 'taken'; current: string; takenBy: string; choice: KeepOrUse } | null;
}

export interface ImportPlan {
  rows: PlanRow[];
  /** Per file: unknown kit or helper (§18.5 Check: a warning, then allowed). */
  warnings: string[];
  /** Names not in the Location list (matching ones, ignoring capitals, are merged). */
  newLocations: Array<{ key: string; name: string; choice: NewLocationChoice }>;
  /** Pending items this import adds; ones already here (or already decided) are left out. */
  pending: PendingRecord[];
  pendingSkipped: number;
  counts: { apply: number; same: number; conflicts: number; conflictsLeft: number; applied: number; unknown: number; outside: number };
  /** Every conflict has a choice (Apply is enabled). */
  ready: boolean;
  /** Item id → the fields as they'll be saved, for items that change. */
  changes: Map<string, CountFields>;
  /** Item id → the fields as they are now, for the same items (Undo). */
  previous: Map<string, CountFields>;
  /** Location names to add, at the end of the walk order, in this order. */
  createdLocations: string[];
  totalBefore: number;
  totalAfter: number;
}

export interface PlanInput {
  files: readonly CountsFile[];
  items: readonly Item[];
  locations: readonly Location[];
  helpers: readonly Helper[];
  /** Pending ids already on this tablet, or accepted, matched, combined or discarded before. */
  knownPending: ReadonlySet<string>;
  /** Units on open placed orders, for the order-list totals before and after (§4). */
  onOrder?: OnOrder;
}

/** ms since epoch of a stored count time; NaN for blank. */
export const stampMs = (s: string): number => (s === '' ? NaN : Date.parse(s.length === 10 ? `${s}T00:00:00` : s));

const fields = (i: Item): CountFields => ({ onHand: i.onHand, lastCounted: i.lastCounted, countedBy: i.countedBy, location: i.location, barcode: i.barcode });
const sameFields = (a: CountFields, b: CountFields) => a.onHand === b.onHand && a.lastCounted === b.lastCounted && a.countedBy === b.countedBy && a.location === b.location && a.barcode === b.barcode;
const newer = (a: string, b: string) => (a === '' ? b : b === '' ? a : stampMs(b) > stampMs(a) ? b : a);

/** "Use newest for all" (§18.5): the helper's number when its count is the later one, else this tablet's. */
export function newestChoices(plan: ImportPlan, choices: ImportChoices): ImportChoices {
  const conflicts = { ...choices.conflicts };
  for (const r of plan.rows) {
    if (r.kind !== 'conflict' || !r.before) continue;
    conflicts[r.key] = stampMs(r.countedAt) > stampMs(r.before.lastCounted) ? 'helper' : 'keep';
  }
  return { ...choices, conflicts };
}

export function planImport(input: PlanInput, choices: ImportChoices = noChoices()): ImportPlan {
  const warnings: string[] = [];
  const known = new Map(input.locations.map((l) => [nameKey(l.name), l.name]));

  // ── New location names: listed once, default Add (§18.5) ──
  const newNames = new Map<string, string>();
  const noteName = (raw: string) => {
    const name = raw.trim().replace(/\s+/g, ' ');
    if (name === '' || known.has(nameKey(name)) || newNames.has(nameKey(name))) return;
    newNames.set(nameKey(name), name);
  };
  const sortedFiles = [...input.files].sort((a, b) => (a.meta.helperId + a.meta.sequence).localeCompare(b.meta.helperId + b.meta.sequence, 'en-US', { numeric: true }) || a.fileName.localeCompare(b.fileName));
  for (const f of sortedFiles) {
    for (const n of f.newLocations) noteName(n);
    for (const c of f.counts) noteName(c.location);
    for (const p of f.newItems) noteName(p.location);
  }
  const newLocations = [...newNames].map(([key, name]) => {
    const c = choices.newLocations[key];
    const valid = c?.kind === 'same' && known.has(nameKey(c.as)) ? c : null;
    return { key, name, choice: valid ?? ({ kind: 'add' } as NewLocationChoice) };
  });
  const resolveName = (raw: string): string => {
    const name = raw.trim().replace(/\s+/g, ' ');
    if (name === '') return '';
    const listed = known.get(nameKey(name));
    if (listed) return listed;
    const n = newLocations.find((x) => x.key === nameKey(name))!;
    return n.choice.kind === 'same' ? known.get(nameKey(n.choice.as))! : n.name;
  };

  // ── Kits: an unknown kit or helper is a warning; its counts compare as if counted after anything here ──
  const kitMs = new Map<CountsFile, number | null>();
  for (const f of input.files) {
    const h = input.helpers.find((x) => x.id === f.meta.helperId);
    const kit = h?.kits.find((k) => k.id === f.meta.kitId);
    if (!h) warnings.push(`${f.fileName}: from “${f.meta.helperName}”, a helper this tablet doesn’t have (removed, or set up on another tablet). Its counts can still be imported.`);
    else if (!kit) warnings.push(`${f.fileName}: from a count kit this tablet didn’t send to “${h.name}”. Its counts can still be imported.`);
    kitMs.set(f, kit ? stampMs(kit.createdAt) : null);
  }

  // ── Every count row, in counted_at order ──
  const all = input.files.flatMap((f) => f.counts.map((c) => ({ f, c })));
  const at = (x: { f: CountsFile; c: IncomingCount }) => (x.c.countedAt !== '' ? stampMs(x.c.countedAt) : stampMs(x.f.meta.createdAt));
  all.sort((a, b) => at(a) - at(b) || a.f.meta.helperId.localeCompare(b.f.meta.helperId) || a.c.itemId.localeCompare(b.c.itemId) || a.f.meta.sequence - b.f.meta.sequence);

  const original = new Map(input.items.map((i) => [i.id, i]));
  const state = new Map(input.items.map((i) => [i.id, fields(i)]));
  const rows: PlanRow[] = [];
  // Files are cumulative (§18.4): a row already met in an earlier file of this import is skipped as applied.
  const met = new Set<string>();
  for (const { f, c } of all) {
    const helperName = f.meta.helperName;
    const key = `${nameKey(helperName)}|${c.itemId}|${c.countedAt}`;
    const same = `${key}|${c.onHand}|${nameKey(c.location)}|${c.barcode}`;
    const repeat = met.has(same);
    met.add(same);
    const item = original.get(c.itemId) ?? null;
    const s = state.get(c.itemId);
    const row: PlanRow = { key, fileName: f.fileName, helperName, itemId: c.itemId, item, kind: 'none', incoming: c.onHand, countedAt: c.countedAt, outside: c.outside, before: null, conflict: null, location: null, barcode: null };
    rows.push(row);
    if (repeat) {
      row.kind = 'applied';
      continue;
    }
    if (!s || !item) {
      row.kind = 'unknown';
      continue;
    }
    row.before = { onHand: s.onHand, lastCounted: s.lastCounted, countedBy: s.countedBy };

    if (c.onHand !== null) {
      const mine = s.countedBy !== '' && nameKey(s.countedBy) === nameKey(helperName);
      const hereMs = stampMs(s.lastCounted);
      const rowMs = stampMs(c.countedAt);
      const kit = kitMs.get(f) ?? null;
      if (mine && hereMs >= rowMs) row.kind = 'applied';
      else if (s.onHand === c.onHand) row.kind = 'same';
      else if (s.lastCounted === '' || mine || (kit !== null && hereMs < kit)) row.kind = 'apply';
      else row.kind = 'conflict';

      if (row.kind === 'apply') Object.assign(s, { onHand: c.onHand, lastCounted: c.countedAt, countedBy: helperName });
      else if (row.kind === 'same') {
        // Applied quietly: last_counted takes the newer time (§18.5).
        if (s.lastCounted === '' || rowMs > hereMs) Object.assign(s, { lastCounted: c.countedAt, countedBy: helperName });
      } else if (row.kind === 'conflict') {
        const choice = choices.conflicts[key] ?? null;
        row.conflict = { choice, keep: s.onHand, helper: c.onHand, add: s.onHand + c.onHand };
        if (choice === 'helper') Object.assign(s, { onHand: c.onHand, lastCounted: c.countedAt, countedBy: helperName });
        else if (choice === 'add') Object.assign(s, { onHand: s.onHand + c.onHand, lastCounted: newer(s.lastCounted, c.countedAt), countedBy: helperName });
      }
    }
    if (row.kind === 'applied') continue;

    if (c.location !== '') {
      const name = resolveName(c.location);
      const state0 = s.location === '' ? 'apply' : nameKey(s.location) === nameKey(name) ? 'same' : 'choice';
      const choice = choices.locations[key] ?? 'keep';
      row.location = { name, state: state0, current: s.location, choice };
      if (state0 === 'apply' || (state0 === 'choice' && choice === 'helper')) s.location = name;
    }
    if (c.barcode !== '') {
      const code = c.barcode;
      const other = [...state].find(([id, x]) => id !== c.itemId && x.barcode !== '' && barcodeKey(x.barcode) === barcodeKey(code));
      const here = s.barcode === '' ? 'apply' : barcodeKey(s.barcode) === barcodeKey(code) ? 'same' : 'choice';
      const choice = choices.barcodes[key] ?? 'keep';
      const st = other && here !== 'same' ? 'taken' : here;
      row.barcode = { code, state: st, current: s.barcode, takenBy: other ? (original.get(other[0])?.name ?? other[0]) : '', choice };
      if (st === 'apply' || (st === 'choice' && choice === 'helper')) s.barcode = code;
    }
  }

  // ── New items: pending unless already here or decided ──
  const pending: PendingRecord[] = [];
  const seen = new Set(input.knownPending);
  let pendingSkipped = 0;
  for (const f of sortedFiles) {
    for (const p of f.newItems) {
      if (seen.has(p.id)) {
        // Only ones already on this tablet (or decided) are reported; a repeat within this import is just the same item.
        if (input.knownPending.has(p.id)) pendingSkipped++;
        continue;
      }
      seen.add(p.id);
      pending.push({ ...p, location: resolveName(p.location) });
    }
  }

  const changes = new Map<string, CountFields>();
  const previous = new Map<string, CountFields>();
  for (const [id, s] of state) {
    const was = fields(original.get(id)!);
    if (!sameFields(was, s)) {
      changes.set(id, { ...s });
      previous.set(id, was);
    }
  }
  // A new name is added when chosen as Add, whether or not an item ends up there (locations-new.csv lists it).
  const createdLocations = newLocations.filter((n) => n.choice.kind === 'add').map((n) => n.name);

  const kinds = (k: RowKind) => rows.filter((r) => r.kind === k).length;
  const conflicts = kinds('conflict');
  const conflictsLeft = rows.filter((r) => r.kind === 'conflict' && r.conflict?.choice === null).length;
  const after = input.items.map((i) => (changes.has(i.id) ? { ...i, ...changes.get(i.id)! } : i));
  return {
    rows,
    warnings,
    newLocations,
    pending,
    pendingSkipped,
    counts: {
      apply: kinds('apply'),
      same: kinds('same'),
      conflicts,
      conflictsLeft,
      applied: kinds('applied'),
      unknown: kinds('unknown'),
      outside: rows.filter((r) => r.outside && (r.kind === 'apply' || r.kind === 'same' || r.kind === 'conflict')).length,
    },
    ready: conflictsLeft === 0,
    changes,
    previous,
    createdLocations,
    totalBefore: orderTotalCents(input.items, input.onOrder),
    totalAfter: orderTotalCents(after, input.onOrder),
  };
}

/** Likely duplicates among pending items (§18.5): the same barcode as each other or an existing item, or nearly the same name. */
export interface Duplicate {
  pendingId: string;
  /** Another pending item, or an existing item. */
  other: { kind: 'pending' | 'item'; id: string; name: string; helperName: string };
  why: 'barcode' | 'name';
}

/** Letters and digits only, lower case, so "Victor SPX motor controller" and "victor-spx" compare. */
const squash = (s: string) => s.toLocaleLowerCase('en-US').replace(/[^a-z0-9]+/g, '');

/** Nearly the same name: equal once squashed, or one starts with the other (at least 5 characters). */
export function similarNames(a: string, b: string): boolean {
  const x = squash(a);
  const y = squash(b);
  if (x === '' || y === '') return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= 5 && long.startsWith(short);
}

export function findDuplicates(pending: readonly PendingRecord[], items: readonly Item[]): Duplicate[] {
  const out: Duplicate[] = [];
  for (const p of pending) {
    for (const q of pending) {
      if (q.id === p.id) continue;
      if (p.barcode !== '' && q.barcode !== '' && barcodeKey(p.barcode) === barcodeKey(q.barcode)) out.push({ pendingId: p.id, other: { kind: 'pending', id: q.id, name: q.name, helperName: q.helperName }, why: 'barcode' });
      else if (similarNames(p.name, q.name)) out.push({ pendingId: p.id, other: { kind: 'pending', id: q.id, name: q.name, helperName: q.helperName }, why: 'name' });
    }
    for (const i of items) {
      if (p.barcode !== '' && i.barcode !== '' && barcodeKey(p.barcode) === barcodeKey(i.barcode)) out.push({ pendingId: p.id, other: { kind: 'item', id: i.id, name: i.name, helperName: '' }, why: 'barcode' });
      else if (similarNames(p.name, i.name)) out.push({ pendingId: p.id, other: { kind: 'item', id: i.id, name: i.name, helperName: '' }, why: 'name' });
    }
  }
  return out;
}

/**
 * Two pending items combined into one before accepting (§18.5): `keep` stays, with its fields;
 * its count is the sum ("add counts") or its own ("keep one"). The other is removed.
 */
export function combinePending(keep: PendingRecord, other: PendingRecord, how: 'add' | 'keep'): PendingRecord {
  return {
    ...keep,
    onHand: how === 'add' ? keep.onHand + other.onHand : keep.onHand,
    countedAt: how === 'add' ? newer(keep.countedAt, other.countedAt) : keep.countedAt,
    barcode: keep.barcode || other.barcode,
    notes: keep.notes || other.notes,
  };
}

/** "Same as an existing item" (§18.5): use the pending count as the item's count, or add it. */
export function matchCount(item: Pick<Item, 'onHand' | 'lastCounted'>, p: PendingRecord, how: 'use' | 'add'): Pick<Item, 'onHand' | 'lastCounted' | 'countedBy'> {
  return {
    onHand: how === 'use' ? p.onHand : item.onHand + p.onHand,
    lastCounted: how === 'use' ? p.countedAt : newer(item.lastCounted, p.countedAt),
    countedBy: p.helperName,
  };
}
