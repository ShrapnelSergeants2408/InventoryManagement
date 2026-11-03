// IndexedDB schema (SPEC v2.0 §2, §3). Database `home-inventory`: v1 was H1's flat locations,
// v2 (H2a) is Area › Spot › Bin › Item with seasons, tags and several photos per record.
// Never edit a version once a phone has data in it (HANDOFF §5); add the next one.
import Dexie, { type Table, type Transaction } from 'dexie';
import { convertH1, itemFromH1 } from '../domain/h1';
import { ID_PREFIX, newId } from '../domain/ids';
import { nameKey, type Area, type Bin, type Category, type Item, type PhotoInfo, type Season, type Spot, type Tag } from '../domain/types';

export { UNSORTED_AREA } from '../domain/h1';

/** Item as stored: adds when it was last saved. */
export interface ItemRow extends Item {
  /** ms since epoch of the last save. */
  updatedAt: number;
}

export type AreaRow = Area;
export type SpotRow = Spot;
export type BinRow = Bin;
export type SeasonRow = Season;
export type CategoryRow = Category;

export interface TagRow extends Tag {
  key: string;
}

/** A photo: its record (§3) and the image. */
export interface PhotoRow extends PhotoInfo {
  /** JPEG, about 1600 px on the long side (§8). */
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
export const SCHEMA_VERSION = 2;
export const SCHEMA_KEY = 'schemaVersion';

export class InventoryDb extends Dexie {
  items!: Table<ItemRow, string>;
  areas!: Table<AreaRow, string>;
  spots!: Table<SpotRow, string>;
  bins!: Table<BinRow, string>;
  seasons!: Table<SeasonRow, string>;
  tags!: Table<TagRow, string>;
  pictures!: Table<PhotoRow, string>;
  categories!: Table<CategoryRow, string>;
  settings!: Table<SettingRow, string>;

  constructor(name = DB_NAME) {
    super(name);
    // H1 (0.1.1). Kept as it was: phones upgrade from it.
    this.version(1).stores({
      items: 'id, category, location, barcode',
      photos: 'itemId',
      locations: 'key, order',
      categories: 'name, order',
      settings: 'key',
    });
    // H2a (0.1.2). Photos move to `pictures` (a new primary key needs a new table).
    this.version(2)
      .stores({
        items: 'id, category, binId, spotId, seasonId, barcode',
        areas: 'id, order',
        spots: 'id, areaId',
        bins: 'id, code, spotId, seasonId',
        seasons: 'id, order',
        tags: 'key, order',
        pictures: 'id, ownerId',
        photos: null,
        locations: null,
      })
      .upgrade(upgradeFromH1);
  }
}

interface H1Item {
  id: string;
  name: string;
  category: string;
  subcategory: string;
  location: string;
  quantity: number;
  barcode: string;
  notes: string;
  hasPhoto: boolean;
  updatedAt: number;
}
interface H1Location {
  key: string;
  name: string;
  notes: string;
  order: number;
}
interface H1Photo {
  itemId: string;
  full: Blob;
  thumb: Blob | null;
  updatedAt: number;
  taken?: number;
}

async function upgradeFromH1(tx: Transaction): Promise<void> {
  const locations = (await tx.table<H1Location>('locations').toArray()).map(({ name, notes, order }) => ({ name, notes, order }));
  const items = await tx.table<H1Item>('items').toArray();
  // A location only items used (not in the list) still becomes a spot.
  const listed = new Set(locations.map((l) => nameKey(l.name)));
  for (const i of items) {
    if (i.location.trim() !== '' && !listed.has(nameKey(i.location))) {
      listed.add(nameKey(i.location));
      locations.push({ name: i.location.trim(), notes: '', order: Number.MAX_SAFE_INTEGER });
    }
  }
  const c = convertH1(locations);
  if (c.area) await tx.table('areas').add(c.area);
  await tx.table('spots').bulkAdd(c.spots);
  await tx.table('seasons').bulkAdd(c.seasons);
  await tx.table('items').clear();
  await tx.table('items').bulkAdd(items.map((i) => ({ ...itemFromH1(i, c.spotIdFor(i.location)), updatedAt: i.updatedAt })));
  const taken = new Set<string>();
  const photos = await tx.table<H1Photo>('photos').toArray();
  await tx.table('pictures').bulkAdd(
    photos.map((p) => {
      const id = newId(ID_PREFIX.photo, (x) => taken.has(x));
      taken.add(id);
      const row: PhotoRow = { id, ownerType: 'item', ownerId: p.itemId, kind: 'photo', caption: '', order: 0, full: p.full, thumb: p.thumb, updatedAt: p.updatedAt };
      if (p.taken !== undefined) row.taken = p.taken;
      return row;
    }),
  );
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

export function toTagRow(t: Tag): TagRow {
  return { ...t, key: nameKey(t.name) };
}

export function fromTagRow({ key: _k, ...t }: TagRow): Tag {
  return t;
}
