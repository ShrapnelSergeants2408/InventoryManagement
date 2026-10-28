// Count kit (SPEC §18.2): what the main tablet sends a helper device. kit.json, the §7
// inventory.csv with prices left out, the three managed lists, and (optionally) photos.
// It's not a backup: it has no order lists or manifest, and Restore refuses it (§7).
import JSZip from 'jszip';
import type { InventorySnapshot } from '../data/inventory';
import type { GroupKind, Helper } from '../domain/helpers';
import type { Item } from '../domain/types';
import { APP_VERSION } from './backup';
import { INVENTORY_FILE, photoPathFor, serializeInventoryCsv } from './inventory-csv';
import {
  CATEGORIES_FILE,
  LOCATIONS_FILE,
  SUPPLIERS_FILE,
  serializeCategoriesCsv,
  serializeLocationsCsv,
  serializeSuppliersCsv,
} from './lists-csv';
import { slug } from './order-csv';
import {
  COUNTS_COLUMNS,
  COUNTS_FORMAT,
  COUNTS_FORMAT_VERSION,
  KIT_FORMAT,
  KIT_FORMAT_VERSION,
  NEW_ITEMS_COLUMNS,
  checkKitJson,
  countsRows,
  type HelperChange,
  type HelperKit,
  type PendingItem,
} from '../domain/helper-mode';
import { centsToPlain } from '../domain/money';
import type { ReplaceAllInput } from '../data/inventory';
import { readBackupZip } from './bundle';
import { writeCsv } from './csv';
import { completeCategories, completeLocations, completeSuppliers, spellLikeLists } from './lists-csv';

export const KIT_FILE = 'kit.json';
export { KIT_FORMAT, KIT_FORMAT_VERSION };

export interface KitJson {
  format: typeof KIT_FORMAT;
  format_version: number;
  kit_id: string;
  helper_id: string;
  helper_name: string;
  /** Local date-time with offset (§3). */
  created_at: string;
  /** The main tablet's app version. */
  app_version: string;
  groups: { kind: GroupKind; names: string[] };
  allow_new_items: boolean;
}

export interface KitInput {
  snapshot: InventorySnapshot;
  /** Item id → full photo; ignored without `includePhotos`. */
  photos: ReadonlyMap<string, Blob>;
  helper: Helper;
  kitId: string;
  /** Local date-time with offset, written as created_at. */
  createdAt: string;
  /** "Include photos" (§18.1, on by default). */
  includePhotos: boolean;
  /** For the ZIP entries' dates. */
  now: Date;
}

/** Helpers don't need prices (§18.2): pack price and price checked are left blank. */
export function withoutPrices(item: Item): Item {
  return { ...item, vendors: item.vendors.map((v) => (v ? { ...v, packPriceCents: null, priceChecked: '' } : null)) as Item['vendors'] };
}

export function kitJson(input: Pick<KitInput, 'helper' | 'kitId' | 'createdAt'>): KitJson {
  const h = input.helper;
  return {
    format: KIT_FORMAT,
    format_version: KIT_FORMAT_VERSION,
    kit_id: input.kitId,
    helper_id: h.id,
    helper_name: h.name,
    created_at: input.createdAt,
    app_version: APP_VERSION,
    groups: { kind: h.kind, names: [...h.groups] },
    allow_new_items: h.allowNewItems,
  };
}

const p2 = (n: number) => String(n).padStart(2, '0');

/** count-kit-<helper name>-2026-10-24-1842.zip (local time; the name reduced to letters, digits and dashes). */
export function kitFileName(helperName: string, now: Date): string {
  const stamp = `${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())}-${p2(now.getHours())}${p2(now.getMinutes())}`;
  const name = slug(helperName);
  return `count-kit-${name ? `${name}-` : ''}${stamp}.zip`;
}

export async function buildCountKit(input: KitInput): Promise<Blob> {
  const zip = new JSZip();
  const date = input.now;
  const paths = new Map<string, string>();
  if (input.includePhotos) {
    const ids = new Set(input.snapshot.items.map((i) => i.id));
    for (const [id, blob] of input.photos) if (ids.has(id)) paths.set(id, photoPathFor(id, blob.type));
  }
  // photo_file names only photos actually in the kit, as in a full backup.
  const items = input.snapshot.items.map((i) => ({ ...withoutPrices(i), hasPhoto: paths.has(i.id) }));

  zip.file(KIT_FILE, JSON.stringify(kitJson(input), null, 2) + '\n', { date });
  zip.file(INVENTORY_FILE, serializeInventoryCsv(items, (id) => paths.get(id) ?? ''), { date });
  zip.file(SUPPLIERS_FILE, serializeSuppliersCsv(input.snapshot.suppliers), { date });
  zip.file(LOCATIONS_FILE, serializeLocationsCsv(input.snapshot.locations), { date });
  zip.file(CATEGORIES_FILE, serializeCategoriesCsv(input.snapshot.categories), { date });
  // Bytes rather than Blobs: JSZip reads a Blob through FileReader, which Node (tests) lacks.
  for (const [id, path] of paths) zip.file(path, new Uint8Array(await input.photos.get(id)!.arrayBuffer()), { date, compression: 'STORE' });
  const bytes = await zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  return new Blob([bytes], { type: 'application/zip' });
}

export interface ReadKit {
  kit: HelperKit;
  /** The kit's inventory and lists, ready for the helper's own database. */
  data: ReplaceAllInput;
  warnings: string[];
}

export type KitRead = { ok: true; read: ReadKit } | { ok: false; newer: boolean; problems: string[] };

/**
 * Reads a count kit on a helper (§18.2 Joining). A newer kit format is refused with "reload"
 * (§18.7). Backups and counts files are refused with a pointer to the screen that uses them.
 */
export async function readCountKit(bytes: Uint8Array | ArrayBuffer): Promise<KitRead> {
  const refuse = (message: string, newer = false): KitRead => ({ ok: false, newer, problems: [message] });
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    return refuse('This file isn’t a count kit. Choose the count-kit-….zip the shop tablet sent.');
  }
  const named = (re: RegExp) => Object.values(zip.files).find((f) => !f.dir && re.test(f.name) && !f.name.startsWith('__MACOSX/')) ?? null;
  const kitEntry = named(/(^|\/)kit\.json$/i);
  if (!kitEntry) {
    if (named(/(^|\/)counts\.json$/i)) return refuse('This is a counts file from a helper. Open it on the shop tablet with Import counts.');
    if (named(/(^|\/)inventory\.csv$/i)) return refuse('This is an inventory backup, not a count kit. Ask for a count kit from the shop tablet (Count › Helper devices › Send count kit).');
    return refuse('This file isn’t a count kit. Choose the count-kit-….zip the shop tablet sent.');
  }
  let json: unknown;
  try {
    json = JSON.parse(await kitEntry.async('string'));
  } catch {
    json = null;
  }
  const checked = checkKitJson(json);
  if (!checked.ok) return refuse(checked.message, checked.newer);
  const read = await readBackupZip(bytes, undefined, { kit: true });
  if (!read.bundle) return { ok: false, newer: false, problems: read.problems.map((p) => (p.row === null ? `${p.file}: ${p.message}` : `${p.file} row ${p.row}: ${p.message}`)) };
  const b = read.bundle;
  const suppliers = completeSuppliers(b.suppliers ?? [], b.items).list;
  const locations = completeLocations(b.locations ?? [], b.items).list;
  const categories = completeCategories(b.categories ?? [], b.items).list;
  // The helper's progress is its own (§18.3): every item starts "not counted yet" on the helper.
  const items = spellLikeLists(b.items, categories, locations).map((i) => ({ ...i, lastCounted: '', countedBy: '' }));
  return { ok: true, read: { kit: checked.kit, data: { items, photos: b.photos, suppliers, locations, categories }, warnings: read.warnings } };
}

// ── Counts file (§18.4): what a helper sends back ──

export const COUNTS_JSON_FILE = 'counts.json';
export const COUNTS_CSV_FILE = 'counts.csv';
export const NEW_ITEMS_FILE = 'new-items.csv';
export const NEW_LOCATIONS_FILE = 'locations-new.csv';

export interface CountsJson {
  format: typeof COUNTS_FORMAT;
  format_version: number;
  kit_id: string;
  helper_id: string;
  helper_name: string;
  /** Local date-time with offset. */
  created_at: string;
  /** 1 for the first file sent from this kit, then 2, 3, … */
  sequence: number;
  app_version: string;
}

export interface CountsInput {
  kit: HelperKit;
  sequence: number;
  createdAt: string;
  changes: readonly HelperChange[];
  items: ReadonlyMap<string, Item>;
  pending: readonly PendingItem[];
  /** Pending id → photo. */
  pendingPhotos: ReadonlyMap<string, Blob>;
  now: Date;
}

export function countsJson(input: Pick<CountsInput, 'kit' | 'sequence' | 'createdAt'>): CountsJson {
  return {
    format: COUNTS_FORMAT,
    format_version: COUNTS_FORMAT_VERSION,
    kit_id: input.kit.kitId,
    helper_id: input.kit.helperId,
    helper_name: input.kit.helperName,
    created_at: input.createdAt,
    sequence: input.sequence,
    app_version: APP_VERSION,
  };
}

/** counts-<helper name>-2026-10-26-1912.zip (local time). */
export function countsFileName(helperName: string, now: Date): string {
  return kitFileName(helperName, now).replace(/^count-kit-/, 'counts-');
}

export function newItemRow(p: PendingItem, photoFile: string): string[] {
  const v = p.vendor;
  return [
    p.id,
    p.name,
    p.category,
    p.subcategory,
    p.unit,
    String(p.onHand),
    String(p.desired),
    p.location,
    p.barcode,
    p.notes,
    photoFile,
    p.countedAt,
    v?.supplier ?? '',
    v?.partNo ?? '',
    v?.url ?? '',
    v ? String(v.packSize) : '',
    v && v.packPriceCents !== null ? centsToPlain(v.packPriceCents) : '',
  ];
}

/** Builds the cumulative counts file: everything since the kit was opened, every time (§18.4). */
export async function buildCountsFile(input: CountsInput): Promise<Blob> {
  const zip = new JSZip();
  const date = input.now;
  zip.file(COUNTS_JSON_FILE, JSON.stringify(countsJson(input), null, 2) + '\n', { date });
  const rows = countsRows(input.changes, input.items);
  zip.file(COUNTS_CSV_FILE, writeCsv(COUNTS_COLUMNS, rows.map((r) => COUNTS_COLUMNS.map((c) => r[c]))), { date });
  const pending = [...input.pending].sort((a, b) => a.id.localeCompare(b.id, 'en-US', { numeric: true }));
  const photoPath = (p: PendingItem) => {
    const blob = input.pendingPhotos.get(p.id);
    return p.hasPhoto && blob ? photoPathFor(p.id, blob.type) : '';
  };
  zip.file(NEW_ITEMS_FILE, writeCsv(NEW_ITEMS_COLUMNS, pending.map((p) => newItemRow(p, photoPath(p)))), { date });
  const created = input.changes.filter((c): c is Extract<HelperChange, { kind: 'location' }> => c.kind === 'location').map((c) => [c.name]);
  zip.file(NEW_LOCATIONS_FILE, writeCsv(['name'], created), { date });
  for (const p of pending) {
    const path = photoPath(p);
    if (path) zip.file(path, new Uint8Array(await input.pendingPhotos.get(p.id)!.arrayBuffer()), { date, compression: 'STORE' });
  }
  const bytes = await zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  return new Blob([bytes], { type: 'application/zip' });
}
