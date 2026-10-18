// IndexedDB schema (SPEC §2, §3; stage4-plan §3).
import Dexie, { type Table } from 'dexie';
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

export class InventoryDb extends Dexie {
  items!: Table<ItemRow, string>;
  photos!: Table<PhotoRow, string>;
  suppliers!: Table<SupplierRow, string>;
  locations!: Table<LocationRow, string>;
  categories!: Table<CategoryRow, string>;
  settings!: Table<SettingRow, string>;

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
  }
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
