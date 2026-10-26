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

export const KIT_FILE = 'kit.json';
export const KIT_FORMAT = 'frc2408-count-kit';
/** Raised when the kit layout changes; a helper refuses a newer kit and asks to reload (§18.7). */
export const KIT_FORMAT_VERSION = 1;

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
