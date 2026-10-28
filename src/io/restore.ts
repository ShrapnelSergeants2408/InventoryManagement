// Restore (F17, SPEC §7, spec-questions Q5/Q8): read a backup file, then plan what replaces
// what. Nothing here touches the database; data/restore.ts applies a plan in one transaction.
import type { InventorySnapshot } from '../data/inventory';
import { withoutMissingItems, type NamedOrderList } from '../domain/order-lists';
import type { PendingRecord } from '../domain/helper-mode';
import type { Category, Item, Location, Supplier } from '../domain/types';
import { dateFromFileName } from './backup';
import { readBackupZip, readInventoryCsvBundle, type Bundle } from './bundle';
import { decodeCsvBytes, type FileProblem } from './csv';
import { completeCategories, completeLocations, completeSuppliers, spellLikeLists } from './lists-csv';

export interface RestorePlan {
  kind: 'zip' | 'csv';
  fileName: string;
  fileSize: number;
  items: Item[];
  /** ZIP: the backup's photos. CSV: empty; photos on the tablet are kept for matching ids. */
  photos: Map<string, Blob>;
  suppliers: Supplier[];
  locations: Location[];
  categories: Category[];
  /**
   * Named order lists (F27). ZIP: the backup's lists, which replace the tablet's. CSV: null,
   * the tablet keeps its lists and drops lines for items that aren't in the backup (§15 Q7d).
   */
  orderLists: NamedOrderList[] | null;
  /** Pending items from helpers: ZIP replaces the tablet's; CSV: null, the tablet keeps them (§15 Q7d). */
  pending: PendingRecord[] | null;
  pendingPhotos: Map<string, Blob>;
  /** Names that weren't in the lists and were added from the item data. */
  addedSuppliers: string[];
  addedLocations: string[];
  /** When the backup was saved: manifest, else file name, else ZIP entry dates; null = unknown. */
  savedAt: Date | null;
  savedAtSource: 'manifest' | 'file name' | 'zip dates' | null;
  warnings: string[];
}

export type RestoreRead = { ok: true; plan: RestorePlan } | { ok: false; problems: FileProblem[]; warnings: string[] };

/** A ZIP starts with "PK\x03\x04" (or "PK\x05\x06" when empty), whatever the file is called. */
export function looksLikeZip(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 3 || bytes[2] === 5) && (bytes[3] === 4 || bytes[3] === 6);
}

function savedDate(bundle: Bundle, fileName: string): Pick<RestorePlan, 'savedAt' | 'savedAtSource'> {
  const fromManifest = bundle.manifest ? new Date(bundle.manifest.savedAt) : null;
  if (fromManifest && !Number.isNaN(fromManifest.getTime())) return { savedAt: fromManifest, savedAtSource: 'manifest' };
  const fromName = dateFromFileName(fileName);
  if (fromName) return { savedAt: fromName, savedAtSource: 'file name' };
  if (bundle.zipDate) return { savedAt: bundle.zipDate, savedAtSource: 'zip dates' };
  return { savedAt: null, savedAtSource: null };
}

/**
 * Q5: a list file in the backup replaces that list; a list the backup doesn't have (any CSV
 * restore, older ZIPs) keeps the tablet's list. The starter catalog has suppliers.csv and
 * categories.csv but no locations.csv. Either way, names the items use that aren't in a list
 * are added (§7): suppliers and locations at the end, and `other` always exists. Items then
 * take the lists' spelling (Stage 5 finding 2).
 */
export function planRestore(bundle: Bundle, current: InventorySnapshot, file: { name: string; size: number }, warnings: string[] = []): RestoreRead {
  const problems: FileProblem[] = [];
  if (bundle.items.length === 0) {
    problems.push({ file: file.name, row: null, message: 'the backup has no items, so restoring it would empty the tablet' });
    return { ok: false, problems, warnings };
  }
  // A count kit's inventory.csv (§18.2), taken out of the kit, is a valid §7 file whose price
  // columns are all blank: restoring it would wipe the tablet's prices (independent M16a review,
  // finding 1). Hand-made files without price columns still load (§7).
  const priced = (items: readonly Item[]) => items.some((i) => i.vendors.some((v) => v !== null && (v.packPriceCents !== null || v.priceChecked !== '')));
  if (bundle.priceColumns && !priced(bundle.items) && priced(current.items)) {
    problems.push({
      file: file.name,
      row: null,
      message:
        "this file has no prices at all, but this tablet has prices, so restoring it would remove every price. It looks like the inventory from a helper's count kit, which isn't a backup. Choose an inventory-backup file",
    });
    return { ok: false, problems, warnings };
  }
  // Items were checked while the file was read, and every supplier they use is now in the
  // list, so the plan always passes replaceAll's check.
  const suppliers = completeSuppliers(bundle.suppliers ?? current.suppliers, bundle.items);
  const locations = completeLocations(bundle.locations ?? current.locations, bundle.items);
  const categories = completeCategories(bundle.categories ?? current.categories, bundle.items);
  const ids = new Set(bundle.items.map((i) => i.id));
  const orderLists = bundle.orderLists?.map((l) => withoutMissingItems(l, ids)) ?? null;
  const dropped = (bundle.orderLists ?? []).reduce((n, l) => n + l.lines.length, 0) - (orderLists ?? []).reduce((n, l) => n + l.lines.length, 0);
  if (dropped > 0) warnings = [...warnings, `${dropped} order-list line(s) name items that aren't in the backup and were left out`];

  return {
    ok: true,
    plan: {
      kind: bundle.kind,
      fileName: file.name,
      fileSize: file.size,
      items: spellLikeLists(bundle.items, categories.list, locations.list),
      photos: bundle.photos,
      suppliers: suppliers.list,
      locations: locations.list,
      categories: categories.list,
      orderLists,
      pending: bundle.pending,
      pendingPhotos: bundle.pendingPhotos,
      addedSuppliers: suppliers.added,
      addedLocations: locations.added,
      ...savedDate(bundle, file.name),
      warnings,
    },
  };
}

/** Reads a chosen file (ZIP or CSV, told apart by content) and plans the restore. */
export async function readRestoreFile(file: { name: string; bytes: Uint8Array }, current: InventorySnapshot): Promise<RestoreRead> {
  const meta = { name: file.name, size: file.bytes.length };
  if (looksLikeZip(file.bytes)) {
    const read = await readBackupZip(file.bytes);
    if (!read.bundle) return { ok: false, problems: read.problems, warnings: read.warnings };
    return planRestore(read.bundle, current, meta, read.warnings);
  }
  const decoded = decodeCsvBytes(file.bytes);
  const read = readInventoryCsvBundle(decoded.text);
  const warnings = [...decoded.warnings, ...read.warnings];
  if (!read.bundle) return { ok: false, problems: read.problems, warnings };
  return planRestore(read.bundle, current, meta, warnings);
}
