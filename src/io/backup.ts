// Backup export (F15, SPEC §7): a full-backup ZIP or a data-only CSV, built in memory.
// The PIN and settings are never included.
import JSZip from 'jszip';
import type { InventorySnapshot } from '../data/inventory';
import { withoutMissingItems, type NamedOrderList } from '../domain/order-lists';
import { MANIFEST_FILE, type Manifest } from './bundle';
import { ORDER_LISTS_FILE, serializeOrderListsCsv } from './order-lists-csv';
import { INVENTORY_FILE, photoPathFor, serializeInventoryCsv } from './inventory-csv';
import {
  CATEGORIES_FILE,
  LOCATIONS_FILE,
  SUPPLIERS_FILE,
  serializeCategoriesCsv,
  serializeLocationsCsv,
  serializeSuppliersCsv,
} from './lists-csv';

export const APP_NAME = 'FRC 2408 Inventory Management';
export const APP_VERSION = '0.2.0';

export type BackupKind = 'full' | 'data';

const p2 = (n: number) => String(n).padStart(2, '0');

/** inventory-backup-2026-10-17-1035.zip / .csv (local time, §7). */
export function backupFileName(kind: BackupKind, now: Date): string {
  const stamp = `${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())}-${p2(now.getHours())}${p2(now.getMinutes())}`;
  return `inventory-backup-${stamp}.${kind === 'full' ? 'zip' : 'csv'}`;
}

/**
 * The date and time a file name carries (`…-2026-10-10-1535.zip`, or a date only, like the
 * starter catalog's `…-2026-10-21.zip`), as a local time; null when there is none (Q8).
 */
export function dateFromFileName(name: string): Date | null {
  const m = /(\d{4})-(\d{2})-(\d{2})(?:-(\d{2})(\d{2}))?(?!.*\d{4}-\d{2}-\d{2})/.exec(name);
  if (!m) return null;
  const [y, mo, d, h, mi] = [m[1], m[2], m[3], m[4] ?? '0', m[5] ?? '0'].map(Number) as [number, number, number, number, number];
  const date = new Date(y, mo - 1, d, h, mi);
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d || h > 23 || mi > 59) return null;
  return date;
}

export function buildDataCsv(snapshot: InventorySnapshot): string {
  return serializeInventoryCsv(snapshot.items);
}

/**
 * Full backup: inventory.csv + suppliers.csv + locations.csv + categories.csv (Q3) +
 * order-lists.csv (F27) + manifest.json (Q8) + photos/<id>.jpg. Photos are stored as they
 * are (already compressed).
 */
export async function buildFullBackup(
  snapshot: InventorySnapshot,
  photos: ReadonlyMap<string, Blob>,
  now: Date,
  orderLists: readonly NamedOrderList[] = [],
): Promise<Blob> {
  const zip = new JSZip();
  const date = now;
  const ids = new Set(snapshot.items.map((i) => i.id));
  const paths = new Map<string, string>();
  for (const [id, blob] of photos) if (ids.has(id)) paths.set(id, photoPathFor(id, blob.type));
  // photo_file follows the photos actually written, so the CSV never names a missing file.
  const items = snapshot.items.map((i) => ({ ...i, hasPhoto: paths.has(i.id) }));

  zip.file(INVENTORY_FILE, serializeInventoryCsv(items, (id) => paths.get(id) ?? ''), { date });
  zip.file(SUPPLIERS_FILE, serializeSuppliersCsv(snapshot.suppliers), { date });
  zip.file(LOCATIONS_FILE, serializeLocationsCsv(snapshot.locations), { date });
  zip.file(CATEGORIES_FILE, serializeCategoriesCsv(snapshot.categories), { date });
  zip.file(ORDER_LISTS_FILE, serializeOrderListsCsv(orderLists.map((l) => withoutMissingItems(l, ids))), { date });
  const manifest: Manifest = {
    app: APP_NAME,
    appVersion: APP_VERSION,
    savedAt: now.toISOString(),
    itemCount: items.length,
    photoCount: paths.size,
  };
  zip.file(MANIFEST_FILE, JSON.stringify(manifest, null, 2) + '\n', { date });
  // Bytes rather than Blobs: JSZip reads a Blob through FileReader, which Node (tests) lacks.
  for (const [id, path] of paths) zip.file(path, new Uint8Array(await photos.get(id)!.arrayBuffer()), { date, compression: 'STORE' });
  const bytes = await zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  return new Blob([bytes], { type: 'application/zip' });
}
