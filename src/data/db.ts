// IndexedDB schema (SPEC v2.0 §2, §3). A new database, `home-inventory`, starting at v1: the
// household app shares no data with the FRC app it was forked from (D1).
import Dexie, { type Table } from 'dexie';
import { nameKey, type Category, type Item, type Location } from '../domain/types';

/** Item as stored: adds when it was last saved. */
export interface ItemRow extends Item {
  /** ms since epoch of the last save. */
  updatedAt: number;
}

export interface LocationRow extends Location {
  key: string;
}

export type CategoryRow = Category;

export interface PhotoRow {
  itemId: string;
  /** JPEG, about 1024 px on the long side (§8; H2 raises it to 1600 and allows several). */
  full: Blob;
  /** Small JPEG for list rows; null until generated (needs a browser canvas). */
  thumb: Blob | null;
  updatedAt: number;
  /** Set when the photo was taken or chosen on this phone; absent for restored photos. */
  taken?: number;
}

export interface SettingRow {
  key: string;
  value: unknown;
}

export const DB_NAME = 'home-inventory';

/** The schema this code was built for. Stored as a setting so an older copy can tell. */
export const SCHEMA_VERSION = 1;
export const SCHEMA_KEY = 'schemaVersion';

export class InventoryDb extends Dexie {
  items!: Table<ItemRow, string>;
  photos!: Table<PhotoRow, string>;
  locations!: Table<LocationRow, string>;
  categories!: Table<CategoryRow, string>;
  settings!: Table<SettingRow, string>;

  constructor(name = DB_NAME) {
    super(name);
    this.version(1).stores({
      items: 'id, category, location, barcode',
      photos: 'itemId',
      locations: 'key, order',
      categories: 'name, order',
      settings: 'key',
    });
  }
}

/**
 * A copy of the app older than the database (a stale cached copy, or a rolled-back deploy)
 * must not read or write it. Dexie 4 opens a newer database without an error, so the stored
 * schema version and the browser's own version number are both checked.
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

export function toItemRow(item: Item, updatedAt: number): ItemRow {
  return { ...item, updatedAt };
}

/** Strips the derived fields so callers work with the plain domain type. */
export function fromItemRow(row: ItemRow): Item {
  const { updatedAt: _u, ...item } = row;
  return item;
}

export function toLocationRow(l: Location): LocationRow {
  return { ...l, key: nameKey(l.name) };
}
