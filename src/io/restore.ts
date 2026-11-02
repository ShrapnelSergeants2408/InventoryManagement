// Restore (F18, SPEC v2.0 §7): read a backup file, then plan what replaces what. Nothing here
// touches the database; data/backup.ts applies a plan in one transaction.
import type { InventorySnapshot } from '../data/inventory';
import type { Category, Item, Location } from '../domain/types';
import { dateFromFileName } from './backup';
import { readBackupZip, readInventoryCsvBundle, type Bundle } from './bundle';
import { decodeCsvBytes, type FileProblem } from './csv';
import { completeCategories, completeLocations, spellLikeLists } from './lists-csv';

export interface RestorePlan {
  kind: 'zip' | 'csv';
  fileName: string;
  fileSize: number;
  items: Item[];
  /** ZIP: the backup's photos. CSV: empty; photos on the phone are kept for matching ids. */
  photos: Map<string, Blob>;
  /** ZIP: item ids whose photo the ZIP names but doesn't have; the phone keeps its own. CSV: empty. */
  missingPhotos: string[];
  locations: Location[];
  categories: Category[];
  /** Location names that weren't in the list and were added from the item data. */
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
 * A list file in the backup replaces that list; a list the backup doesn't have (any CSV
 * restore) keeps the phone's list. Either way, locations and categories the items use that
 * aren't in a list are added at the end (§7), and items take the lists' spelling.
 */
export function planRestore(bundle: Bundle, current: InventorySnapshot, file: { name: string; size: number }, warnings: string[] = []): RestoreRead {
  // A full backup of a phone with no items still has its lists. A file with neither (any CSV)
  // is refused: it would only empty the phone.
  const hasLists = bundle.locations !== null || bundle.categories !== null;
  if (bundle.items.length === 0 && !hasLists) {
    return { ok: false, problems: [{ file: file.name, row: null, message: 'the backup has no items, so restoring it would empty this phone' }], warnings };
  }
  const locations = completeLocations(bundle.locations ?? current.locations, bundle.items);
  const categories = completeCategories(bundle.categories ?? current.categories, bundle.items);
  return {
    ok: true,
    plan: {
      kind: bundle.kind,
      fileName: file.name,
      fileSize: file.size,
      items: spellLikeLists(bundle.items, categories.list, locations.list),
      photos: bundle.photos,
      missingPhotos: bundle.missingPhotos,
      locations: locations.list,
      categories: categories.list,
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
