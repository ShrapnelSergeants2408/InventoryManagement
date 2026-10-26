// IndexedDB schema (SPEC §2, §3; stage4-plan §3).
import Dexie, { type Table } from 'dexie';
import { midnightLocalIso } from '../domain/dates';
import type { Helper } from '../domain/helpers';
import type { NamedOrderList } from '../domain/order-lists';
import { nameKey, type Category, type Item, type Location, type Supplier } from '../domain/types';

/** Item as stored: adds derived index fields. */
export interface ItemRow extends Item {
  /** nameKey of every vendor option's supplier, for "how many options use X?" (F23). */
  supplierKeys: string[];
  /** ms since epoch of the last save. */
  updatedAt: number;
}

export interface SupplierRow extends Supplier {
  key: string;
}

export interface LocationRow extends Location {
  key: string;
}

export type CategoryRow = Category;

export interface PhotoRow {
  itemId: string;
  /** JPEG, about 1024 px on the long side (§8). */
  full: Blob;
  /** Small JPEG for list rows; null until generated (needs a browser canvas). */
  thumb: Blob | null;
  updatedAt: number;
  /** Set when the photo was taken or chosen on this tablet; absent for imported photos. */
  taken?: number;
}

export interface SettingRow {
  key: string;
  value: unknown;
}

/** Named order list as stored (F27): adds the name key (unique ignoring capitals) and the item ids it holds. */
export interface OrderListRow extends NamedOrderList {
  key: string;
  /** Multi-entry index, so a deleted item can be found on every list. */
  itemIds: string[];
}

/** Helper as stored (§3, main tablet only): adds the name key (unique ignoring capitals). */
export interface HelperRow extends Helper {
  key: string;
}

/**
 * Stores for the counts import (§18.5), created in v3 and filled from M16c: a pending item a
 * helper added, its photo, and the record that undoes the last import.
 */
export interface PendingItemRow {
  id: string;
  helperId: string;
  barcode: string;
  [field: string]: unknown;
}
export interface PendingPhotoRow {
  pendingId: string;
  full: Blob;
}
export interface ImportUndoRow {
  id: string;
  [field: string]: unknown;
}

/** The schema this code was built for (stage6-plan §3). Stored as a setting so an older copy can tell. */
export const SCHEMA_VERSION = 3;
export const SCHEMA_KEY = 'schemaVersion';

/**
 * The v3 change to one stored item (§18.7): a date-only last_counted becomes local midnight
 * with that date's UTC offset, and counted_by is added blank. Nothing else changes.
 */
export function upgradeItemToV3(row: { lastCounted?: unknown; countedBy?: unknown }): void {
  if (typeof row.lastCounted === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(row.lastCounted)) row.lastCounted = midnightLocalIso(row.lastCounted);
  if (row.countedBy === undefined) row.countedBy = '';
}

export class InventoryDb extends Dexie {
  items!: Table<ItemRow, string>;
  photos!: Table<PhotoRow, string>;
  suppliers!: Table<SupplierRow, string>;
  locations!: Table<LocationRow, string>;
  categories!: Table<CategoryRow, string>;
  settings!: Table<SettingRow, string>;
  orderLists!: Table<OrderListRow, string>;
  helpers!: Table<HelperRow, string>;
  pendingItems!: Table<PendingItemRow, string>;
  pendingPhotos!: Table<PendingPhotoRow, string>;
  importUndo!: Table<ImportUndoRow, string>;

  constructor(name = 'frc2408-inventory') {
    super(name);
    this.version(1).stores({
      items: 'id, category, location, barcode, *supplierKeys, lastCounted',
      photos: 'itemId',
      suppliers: 'key, name',
      locations: 'key, order',
      categories: 'name, order',
      settings: 'key',
    });
    // v2 (M15): named order lists (F27). A new empty table; nothing else changes.
    this.version(2).stores({
      orderLists: 'id, &key, *itemIds',
    });
    // v3 (M16a): helper devices (§18) and count times (§3). Four new empty tables; every item
    // gets a date-time last_counted and a blank counted_by, and nothing else changes.
    this.version(3)
      .stores({
        helpers: 'id, &key',
        pendingItems: 'id, helperId, barcode',
        pendingPhotos: 'pendingId',
        importUndo: 'id',
      })
      .upgrade((tx) => tx.table('items').toCollection().modify(upgradeItemToV3));
  }
}

export function toHelperRow(h: Helper): HelperRow {
  return { ...h, key: nameKey(h.name) };
}

export function fromHelperRow(row: HelperRow): Helper {
  const { key: _k, ...h } = row;
  return h;
}

/**
 * Stage 5 finding 6: a copy of the app older than the database (a stale cached copy, or a
 * rolled-back deploy) must not read or write it. Dexie 4 opens a newer database without an
 * error, so the stored schema version and the browser's own version number are both checked.
 * Returns 'outdated' without writing anything; otherwise records this schema version.
 */
export async function checkSchema(db: InventoryDb): Promise<'ok' | 'outdated'> {
  const stored = (await db.settings.get(SCHEMA_KEY))?.value;
  // Dexie stores version n as IndexedDB version n × 10.
  const native = db.backendDB()?.version ?? 0;
  if ((typeof stored === 'number' && stored > SCHEMA_VERSION) || native / 10 > SCHEMA_VERSION) return 'outdated';
  if (stored !== SCHEMA_VERSION) await db.settings.put({ key: SCHEMA_KEY, value: SCHEMA_VERSION });
  return 'ok';
}

export function toOrderListRow(list: NamedOrderList): OrderListRow {
  return { ...list, key: nameKey(list.name), itemIds: [...new Set(list.lines.map((l) => l.itemId))] };
}

export function fromOrderListRow(row: OrderListRow): NamedOrderList {
  const { key: _k, itemIds: _i, ...list } = row;
  return list;
}

export function toItemRow(item: Item, updatedAt: number): ItemRow {
  const supplierKeys = [...new Set(item.vendors.flatMap((v) => (v ? [nameKey(v.supplier)] : [])))];
  return { ...item, supplierKeys, updatedAt };
}

/** Strips the derived fields so callers work with the plain domain type. */
export function fromItemRow(row: ItemRow): Item {
  const { supplierKeys: _k, updatedAt: _u, ...item } = row;
  return item;
}

export function toSupplierRow(s: Supplier): SupplierRow {
  return { ...s, key: nameKey(s.name) };
}

export function toLocationRow(l: Location): LocationRow {
  return { ...l, key: nameKey(l.name) };
}
