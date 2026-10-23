// IndexedDB schema (SPEC §2, §3; stage4-plan §3).
import Dexie, { type Table } from 'dexie';
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

/** The schema this code was built for (stage6-plan §3). Stored as a setting so an older copy can tell. */
export const SCHEMA_VERSION = 2;
export const SCHEMA_KEY = 'schemaVersion';

export class InventoryDb extends Dexie {
  items!: Table<ItemRow, string>;
  photos!: Table<PhotoRow, string>;
  suppliers!: Table<SupplierRow, string>;
  locations!: Table<LocationRow, string>;
  categories!: Table<CategoryRow, string>;
  settings!: Table<SettingRow, string>;
  orderLists!: Table<OrderListRow, string>;

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
  }
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
