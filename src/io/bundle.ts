// Reads a full backup ZIP or a data-only CSV into one in-memory bundle (SPEC §7, §12).
// Nothing here touches the database; restore and the starter-catalog load apply a bundle later.
import JSZip from 'jszip';
import type { Category, Item, Location, Supplier } from '../domain/types';
import { decodeCsvBytes, type FileProblem } from './csv';
import { INVENTORY_FILE, parseInventoryCsv } from './inventory-csv';
import {
  CATEGORIES_FILE,
  LOCATIONS_FILE,
  SUPPLIERS_FILE,
  parseCategoriesCsv,
  parseLocationsCsv,
  parseSuppliersCsv,
} from './lists-csv';
import { ORDER_LISTS_FILE, parseOrderListsCsv } from './order-lists-csv';
import type { NamedOrderList } from '../domain/order-lists';
import type { PendingRecord } from '../domain/helper-mode';
import { PENDING_ITEMS_FILE, parsePendingCsv } from './pending-csv';
import { ORDERS_FILE, ORDER_LINES_FILE, parseOrdersCsv } from './orders-csv';
import type { PlacedOrder } from '../domain/placed-orders';

export const MANIFEST_FILE = 'manifest.json';

/** Written into full backups (spec-questions Q8); optional when reading. */
export interface Manifest {
  app: string;
  appVersion: string;
  savedAt: string;
  itemCount: number;
  photoCount: number;
}

export interface Bundle {
  kind: 'zip' | 'csv';
  items: Item[];
  /** Item id → photo bytes, for items whose photo_file was found in the ZIP. */
  photos: Map<string, Blob>;
  /** Item ids whose photo_file names a photo the ZIP doesn't have (Stage 5 finding 5). */
  missingPhotos: string[];
  /** null when the file wasn't in the backup (lists are then rebuilt by the caller). */
  suppliers: Supplier[] | null;
  locations: Location[] | null;
  categories: Category[] | null;
  /** Named order lists (F27): null for a CSV; a ZIP without order-lists.csv has none ([]). */
  orderLists: NamedOrderList[] | null;
  /** Pending items from helpers (§7, §18.5): null for a CSV; a ZIP without pending-items.csv has none ([]). */
  pending: PendingRecord[] | null;
  /** Pending id → photo. */
  pendingPhotos: Map<string, Blob>;
  /** Placed orders (§21.6): null when orders.csv isn't in the file (a CSV, older ZIPs). */
  orders: PlacedOrder[] | null;
  /** Receipt id → file, for receipts found in the ZIP. */
  receipts: Map<string, Blob>;
  manifest: Manifest | null;
  /** Latest modification date among the ZIP entries, as a fallback "saved" date. */
  zipDate: Date | null;
  /** inventory.csv has price columns (whether or not any price is filled in). */
  priceColumns: boolean;
}

export interface BundleRead {
  bundle: Bundle | null;
  /** Any problem means the file can't be used; nothing should be changed. */
  problems: FileProblem[];
  /** Informational: ignored columns, photos referenced but missing, unused files. */
  warnings: string[];
}

const PHOTO_TYPES: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

function photoType(path: string): string | null {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return PHOTO_TYPES[ext] ?? null;
}

/** Links left blank on reading because they weren't web addresses (M23, F11). */
function clearedText(links: readonly string[]): string {
  const shown = links.slice(0, 5).join(', ');
  return `Links that aren't web addresses were left blank: ${shown}${links.length > 5 ? ` and ${links.length - 5} more` : ''}`;
}

export function readInventoryCsvBundle(text: string): BundleRead & { photoFiles: Map<string, string> } {
  const parsed = parseInventoryCsv(text);
  const photoFiles = parsed.photoFiles;
  const warnings: string[] = [];
  if (parsed.ignoredColumns.length > 0) warnings.push(`Ignored columns: ${parsed.ignoredColumns.join(', ')}`);
  if (parsed.clearedLinks.length > 0) warnings.push(clearedText(parsed.clearedLinks));
  if (parsed.problems.length > 0) return { bundle: null, problems: parsed.problems, warnings, photoFiles };
  return {
    bundle: {
      kind: 'csv',
      items: parsed.items,
      photos: new Map(),
      missingPhotos: [],
      suppliers: null,
      locations: null,
      categories: null,
      orderLists: null,
      pending: null,
      pendingPhotos: new Map(),
      orders: null,
      receipts: new Map(),
      manifest: null,
      zipDate: null,
      priceColumns: parsed.priceColumns,
    },
    problems: [],
    warnings,
    photoFiles,
  };
}

/** Reports photos read so far, of the photos the CSV names, once the items are read (first-launch progress, 9i). */
export type PhotoProgress = (done: number, total: number, items: number) => void;

/**
 * Reads a full backup. With `kit`, reads a count kit's files instead (§18.2: the same §7 layout
 * plus kit.json), which the helper's Join uses; otherwise a kit is refused.
 */
export async function readBackupZip(data: ArrayBuffer | Uint8Array | Blob, onPhoto?: PhotoProgress, opts: { kit?: boolean } = {}): Promise<BundleRead> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(data);
  } catch {
    return { bundle: null, problems: [{ file: opts.kit ? 'kit' : 'backup', row: null, message: opts.kit ? "this file isn't a readable count kit" : "this file isn't a readable ZIP backup" }], warnings: [] };
  }

  // A count kit (§18.2) has an inventory.csv too, but with prices left out: it is never a backup (§7).
  if (!opts.kit && Object.values(zip.files).some((f) => !f.dir && /(^|\/)kit\.json$/i.test(f.name))) {
    return {
      bundle: null,
      problems: [{ file: 'backup', row: null, message: 'this is a count kit for a helper device, not a backup. Open it on the helper with “Join as a helper”' }],
      warnings: [],
    };
  }

  // A helper's counts file (§18.4) is never a backup either (§7, F17).
  if (!opts.kit && Object.values(zip.files).some((f) => !f.dir && /(^|\/)counts\.json$/i.test(f.name))) {
    return {
      bundle: null,
      problems: [{ file: 'backup', row: null, message: 'this is a counts file from a helper device, not a backup. Import it with Count › Import counts' }],
      warnings: [],
    };
  }

  // Accept files at the root or inside one top-level folder (a re-zipped backup folder).
  const csvEntry = Object.values(zip.files)
    .filter((f) => !f.dir && /(^|\/)inventory\.csv$/i.test(f.name) && !f.name.startsWith('__MACOSX/'))
    .sort((a, b) => a.name.length - b.name.length)[0];
  if (!csvEntry) {
    return { bundle: null, problems: [{ file: 'backup', row: null, message: `the ZIP has no ${INVENTORY_FILE}` }], warnings: [] };
  }
  const prefix = csvEntry.name.slice(0, csvEntry.name.length - INVENTORY_FILE.length);
  const entry = (name: string) => {
    const want = (prefix + name).toLowerCase();
    return Object.values(zip.files).find((f) => !f.dir && f.name.toLowerCase() === want) ?? null;
  };
  // A CSV edited in Excel and zipped again may be Windows-1252, as a loose CSV may (M23).
  const decodeWarnings: string[] = [];
  const decode = (bytes: Uint8Array, name: string) => {
    const d = decodeCsvBytes(bytes, name);
    decodeWarnings.push(...d.warnings);
    return d.text;
  };
  const text = async (name: string) => {
    const f = entry(name);
    return f ? decode(await f.async('uint8array'), name) : null;
  };

  const read = readInventoryCsvBundle(decode(await csvEntry.async('uint8array'), INVENTORY_FILE));
  const problems = [...read.problems];
  const warnings = [...read.warnings];

  const suppliersText = await text(SUPPLIERS_FILE);
  const locationsText = await text(LOCATIONS_FILE);
  const categoriesText = await text(CATEGORIES_FILE);
  const orderListsText = await text(ORDER_LISTS_FILE);
  const suppliers = suppliersText === null ? null : parseSuppliersCsv(suppliersText);
  const locations = locationsText === null ? null : parseLocationsCsv(locationsText);
  const categories = categoriesText === null ? null : parseCategoriesCsv(categoriesText);
  const orderLists = orderListsText === null ? null : parseOrderListsCsv(orderListsText);
  const pendingText = await text(PENDING_ITEMS_FILE);
  const pending = pendingText === null ? null : parsePendingCsv(pendingText, PENDING_ITEMS_FILE, null);
  const ordersText = await text(ORDERS_FILE);
  const orders = ordersText === null ? null : parseOrdersCsv(ordersText, (await text(ORDER_LINES_FILE)) ?? '');
  for (const p of [suppliers, locations, categories, orderLists, pending, orders]) if (p) problems.push(...p.problems);
  warnings.unshift(...decodeWarnings);
  if (suppliers?.clearedLinks?.length) warnings.push(clearedText(suppliers.clearedLinks));

  let manifest: Manifest | null = null;
  const manifestText = await text(MANIFEST_FILE);
  if (manifestText !== null) {
    try {
      manifest = JSON.parse(manifestText) as Manifest;
    } catch {
      warnings.push(`${MANIFEST_FILE} couldn't be read and was ignored`);
    }
  }

  if (problems.length > 0 || !read.bundle) return { bundle: null, problems, warnings };

  // Photos: follow each item's photo_file path (§7).
  const photos = new Map<string, Blob>();
  const used = new Set<string>();
  const missing: string[] = [];
  const total = read.bundle.items.filter((i) => read.photoFiles.has(i.id)).length;
  let done = 0;
  for (const item of read.bundle.items) {
    const path = read.photoFiles.get(item.id);
    if (!path) continue;
    onPhoto?.(done++, total, read.bundle.items.length);
    const f = entry(path);
    const type = photoType(path);
    if (!f || !type) {
      missing.push(item.id);
      continue;
    }
    used.add(f.name);
    photos.set(item.id, new Blob([await f.async('arraybuffer')], { type }));
    item.hasPhoto = true;
  }
  onPhoto?.(total, total, read.bundle.items.length);
  const missingPhotos = [...missing];
  const pendingPhotos = new Map<string, Blob>();
  for (const p of pending?.items ?? []) {
    const path = pending!.photoFiles.get(p.id);
    if (!path) continue;
    const f = entry(path);
    const type = photoType(path);
    if (!f || !type) {
      missing.push(p.id);
      continue;
    }
    used.add(f.name);
    pendingPhotos.set(p.id, new Blob([await f.async('arraybuffer')], { type }));
    p.hasPhoto = true;
  }
  if (missing.length > 0) warnings.push(`Photos named in ${INVENTORY_FILE} but not in the ZIP: ${missing.join(', ')}`);
  const receipts = new Map<string, Blob>();
  const missingReceipts: string[] = [];
  for (const [id, path] of orders?.receiptFiles ?? []) {
    const f = entry(path);
    if (!f) {
      missingReceipts.push(path);
      continue;
    }
    used.add(f.name);
    receipts.set(id, new Blob([await f.async('arraybuffer')], { type: /\.pdf$/i.test(path) ? 'application/pdf' : 'image/jpeg' }));
  }
  if (missingReceipts.length > 0) warnings.push(`Receipts named in ${ORDERS_FILE} but not in the ZIP (left off their orders): ${missingReceipts.join(', ')}`);
  const unused = Object.values(zip.files).filter((f) => !f.dir && f.name.startsWith(`${prefix}photos/`) && !used.has(f.name));
  if (unused.length > 0) warnings.push(`${unused.length} photo file(s) in the ZIP aren't used by any item`);

  const dates = Object.values(zip.files)
    .filter((f) => !f.dir)
    .map((f) => f.date.getTime());
  return {
    bundle: {
      ...read.bundle,
      kind: 'zip',
      photos,
      missingPhotos,
      suppliers: suppliers?.list ?? null,
      locations: locations?.list ?? null,
      categories: categories?.list ?? null,
      orderLists: orderLists?.lists ?? [],
      pending: pending?.items ?? [],
      pendingPhotos,
      orders: orders?.orders ?? null,
      receipts,
      manifest,
      zipDate: dates.length ? new Date(Math.max(...dates)) : null,
    },
    problems: [],
    warnings,
  };
}

