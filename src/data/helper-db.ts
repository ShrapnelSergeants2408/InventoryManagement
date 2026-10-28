// The helper device's own database (SPEC §18.7, §15 Q7e): `frc2408-helper`, never the shop
// tablet's `frc2408-inventory`, so a helper can't become a main tablet by accident and Leave
// helper mode can delete it whole. It has the same item and list tables as the inventory, so
// the count-in screens (F24) work on it unchanged, plus a table of what the helper changed,
// from which every counts file is built (§18.4).
import Dexie, { type Table } from 'dexie';
import { nowLocalIso } from '../domain/dates';
import {
  changeKey,
  inAssignment,
  mergeItemChange,
  pendingId,
  unsentChanges,
  type HelperChange,
  type HelperKit,
  type PendingItem,
  type PendingRecord,
} from '../domain/helper-mode';
import type { Item } from '../domain/types';
import type { ReadKit } from '../io/count-kit';
import { InventoryDb, fromItemRow, type ItemRow, type PendingItemRow } from './db';
import { replaceAll } from './inventory';
import type { PhotoChange } from './photos';

export const INVENTORY_DB_NAME = 'frc2408-inventory';
export const HELPER_DB_NAME = 'frc2408-helper';

/** A change as stored: keyed so a later change to the same thing replaces it. */
export type ChangeRow = HelperChange & { key: string };

/** Pending item as stored on the helper (the main tablet's table has the same shape, M16c). */
export type HelperPendingRow = PendingItemRow & PendingRecord;

const KIT_KEY = 'helperKit';
const SENT_KEY = 'helperSent';
const PENDING_SEQ = 'helperPendingSeq';

export interface SentState {
  /** ms since epoch of the last Send my counts, or null before the first. */
  at: number | null;
  /** The last counts file's sequence number (0 before the first). */
  sequence: number;
}

/**
 * The helper's own schema, numbered far above the inventory's so the inventory's own
 * versions (1–3 today) can grow without clashing.
 */
const HELPER_SCHEMA = 100;

export class HelperDb extends InventoryDb {
  changes!: Table<ChangeRow, string>;

  constructor(name = HELPER_DB_NAME) {
    super(name);
    this.version(HELPER_SCHEMA).stores({ changes: 'key, changedAt' });
  }
}

export const isHelperDb = (db: InventoryDb): db is HelperDb => db instanceof HelperDb;

/** Which databases this device has, without opening (or creating) any (F22, §18.7). */
export async function existingDatabases(idb: IDBFactory = indexedDB): Promise<{ inventory: boolean; helper: boolean }> {
  if (typeof idb.databases === 'function') {
    const names = new Set((await idb.databases()).map((d) => d.name));
    return { inventory: names.has(INVENTORY_DB_NAME), helper: names.has(HELPER_DB_NAME) };
  }
  // Older browsers: Dexie.exists opens a database only if it is there, and creates nothing.
  return { inventory: await Dexie.exists(INVENTORY_DB_NAME), helper: await Dexie.exists(HELPER_DB_NAME) };
}

export async function getKit(db: HelperDb): Promise<HelperKit | null> {
  const v = (await db.settings.get(KIT_KEY))?.value;
  return v && typeof v === 'object' ? (v as HelperKit) : null;
}

export async function getSent(db: HelperDb): Promise<SentState> {
  const v = (await db.settings.get(SENT_KEY))?.value as Partial<SentState> | undefined;
  return { at: typeof v?.at === 'number' ? v.at : null, sequence: typeof v?.sequence === 'number' ? v.sequence : 0 };
}

/**
 * Opens a kit (§18.2): replaces everything on the helper with the kit's copy and forgets every
 * earlier change and pending item, in one transaction. The caller has already asked about
 * unsent counts.
 */
export async function joinKit(db: HelperDb, read: ReadKit, now = Date.now()): Promise<void> {
  await db.transaction('rw', [db.items, db.photos, db.suppliers, db.locations, db.categories, db.orderLists, db.settings, db.changes, db.pendingItems, db.pendingPhotos], async () => {
    await replaceAll(db, read.data, now, { orderLists: [] });
    await Promise.all([db.changes.clear(), db.pendingItems.clear(), db.pendingPhotos.clear(), db.settings.clear()]);
    await db.settings.bulkPut([
      { key: KIT_KEY, value: read.kit },
      { key: SENT_KEY, value: { at: null, sequence: 0 } satisfies SentState },
      { key: PENDING_SEQ, value: 0 },
      { key: 'joinedAt', value: now },
    ]);
  });
}

/**
 * Records a change to an item (inside the caller's transaction). `before` is the item as it
 * was: the first change decides whether it was outside the helper's groups (§18.3).
 */
export async function noteItemChange(db: HelperDb, before: Pick<ItemRow, 'id' | 'category' | 'location'>, what: { counted?: boolean; location?: boolean; barcode?: boolean }, now: number): Promise<void> {
  const kit = await getKit(db);
  const key = changeKey({ kind: 'item', itemId: before.id });
  const earlier = (await db.changes.get(key)) ?? null;
  const merged = mergeItemChange(earlier?.kind === 'item' ? earlier : null, { itemId: before.id, ...what, outside: kit ? !inAssignment(before, kit) : false }, now);
  await db.changes.put({ ...merged, key });
}

/** Records a location created on the helper (inside the caller's transaction). */
export async function noteLocationAdded(db: HelperDb, name: string, now: number): Promise<void> {
  const change: HelperChange = { kind: 'location', name, changedAt: now };
  await db.changes.put({ ...change, key: changeKey(change) });
}

/** Everything the Send screen and the counts file need, read together. */
export interface HelperState {
  kit: HelperKit;
  sent: SentState;
  changes: HelperChange[];
  pending: PendingItem[];
  unsent: number;
}

export async function loadHelperState(db: HelperDb): Promise<HelperState | null> {
  return db.transaction('r', [db.settings, db.changes, db.pendingItems], async () => {
    const kit = await getKit(db);
    if (!kit) return null;
    const sent = await getSent(db);
    const changes = (await db.changes.toArray()).map(({ key: _k, ...c }) => c as HelperChange);
    const pending = (await db.pendingItems.toArray()).map(fromPendingRow);
    return { kit, sent, changes, pending, unsent: unsentChanges(changes, sent.at) };
  });
}

function fromPendingRow(row: PendingItemRow): PendingItem {
  const r = row as HelperPendingRow;
  return {
    id: r.id,
    name: r.name,
    category: r.category,
    subcategory: r.subcategory,
    unit: r.unit,
    onHand: r.onHand,
    desired: r.desired,
    location: r.location,
    barcode: r.barcode,
    notes: r.notes,
    countedAt: r.countedAt,
    vendor: r.vendor,
    hasPhoto: r.hasPhoto,
  };
}

/** The next pending id, `pending-<helper id>-<n>` (§18.3). Inside the caller's transaction. */
async function nextPendingId(db: HelperDb, kit: HelperKit): Promise<string> {
  const v = (await db.settings.get(PENDING_SEQ))?.value;
  const n = (typeof v === 'number' ? v : 0) + 1;
  await db.settings.put({ key: PENDING_SEQ, value: n });
  return pendingId(kit.helperId, n);
}

/**
 * Saves a new item as Pending (§18.3), with its photo. `build` gets the new id and returns the
 * checked item (domain/helper-mode checkPendingItem). Refused when the kit doesn't allow new items.
 */
export async function addPendingItem(
  db: HelperDb,
  build: (id: string, countedAt: string) => PendingItem,
  photo: Exclude<PhotoChange, 'remove'> | null,
  now = Date.now(),
  countedAt = nowLocalIso(),
): Promise<PendingItem> {
  return db.transaction('rw', [db.settings, db.pendingItems, db.pendingPhotos, db.changes], async () => {
    const kit = await getKit(db);
    if (!kit) throw new Error('this device has no count kit');
    if (!kit.allowNewItems) throw new Error('this count kit doesn’t allow adding new items');
    const item = { ...build(await nextPendingId(db, kit), countedAt), hasPhoto: photo !== null };
    const row: HelperPendingRow = { ...item, helperId: kit.helperId, helperName: kit.helperName };
    await db.pendingItems.add(row);
    if (photo) await db.pendingPhotos.put({ pendingId: item.id, full: photo.full });
    const change: HelperChange = { kind: 'pending', pendingId: item.id, changedAt: now };
    await db.changes.put({ ...change, key: changeKey(change) });
    return item;
  });
}

export async function pendingPhotos(db: HelperDb): Promise<Map<string, Blob>> {
  return new Map((await db.pendingPhotos.toArray()).map((p) => [p.pendingId, p.full]));
}

export async function helperItems(db: HelperDb): Promise<Map<string, Item>> {
  return new Map((await db.items.toArray()).map((r) => [r.id, fromItemRow(r)]));
}

/** Records a send (§18.4): the time and the file's sequence number. */
export async function markSent(db: HelperDb, sequence: number, at = Date.now()): Promise<void> {
  await db.settings.put({ key: SENT_KEY, value: { at, sequence } satisfies SentState });
}

/**
 * Leave helper mode (§18.2): deletes the helper database, and only that. The shop tablet's
 * inventory database, if this browser has one, is never touched.
 */
export async function leaveHelperMode(db: HelperDb | null, name = HELPER_DB_NAME): Promise<void> {
  db?.close();
  await Dexie.delete(name);
}
