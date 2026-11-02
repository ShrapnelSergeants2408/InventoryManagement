// Restore (F18, SPEC v2.0 §7): read a backup file, then plan what replaces what. Nothing here
// touches the database; data/backup.ts applies a plan in one transaction.
import type { InventorySnapshot } from '../data/inventory';
import { checkData, unlistedTags, type HouseholdData } from '../domain/integrity';
import { dateFromFileName } from './backup';
import { readBackupZip, type Bundle } from './bundle';
import type { FileProblem } from './csv';
import { completeCategories, spellLikeLists } from './lists-csv';

export interface RestorePlan {
  /** h1: a 0.1.1 backup, converted (locations became spots in "Unsorted"). */
  format: 'h2' | 'h1';
  fileName: string;
  fileSize: number;
  data: HouseholdData;
  images: Map<string, Blob>;
  /** Photo ids the backup names but doesn't have; the phone keeps its own image when it has one. */
  missingImages: string[];
  /** Categories (and subcategories) and tags the items use that weren't in the lists, added at the end. */
  addedCategories: string[];
  addedTags: string[];
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
 * The backup's lists replace the phone's. A list file the backup doesn't have keeps the phone's
 * list. Either way, categories and tags the records use that aren't listed are added at the end
 * (§7), and items take the list's spelling. A backup whose records don't fit together is refused.
 */
export function planRestore(bundle: Bundle, current: Pick<InventorySnapshot, 'categories' | 'tags'>, file: { name: string; size: number }, warnings: string[] = []): RestoreRead {
  const d = bundle.data;
  if (d.items.length === 0 && d.areas.length === 0 && !bundle.hasCategories) {
    return { ok: false, problems: [{ file: file.name, row: null, message: 'the backup has no items or lists, so restoring it would empty this phone' }], warnings };
  }
  const categories = completeCategories(bundle.hasCategories ? d.categories : current.categories, d.items);
  const tagBase = bundle.hasTags ? d.tags : current.tags;
  const addedTags = unlistedTags({ ...d, tags: tagBase });
  const data: HouseholdData = {
    ...d,
    categories: categories.list,
    tags: [...tagBase, ...addedTags.map((name, k) => ({ name, order: tagBase.length + k }))],
    items: spellLikeLists(d.items, categories.list),
  };
  const problems = checkData(data);
  if (problems.length > 0) return { ok: false, problems: problems.map((message) => ({ file: file.name, row: null, message })), warnings };
  return {
    ok: true,
    plan: {
      format: bundle.format,
      fileName: file.name,
      fileSize: file.size,
      data,
      images: bundle.images,
      missingImages: bundle.missingImages,
      addedCategories: categories.added,
      addedTags,
      ...savedDate(bundle, file.name),
      warnings,
    },
  };
}

/** Reads a chosen file (told apart by content) and plans the restore. Only full-backup ZIPs restore. */
export async function readRestoreFile(file: { name: string; bytes: Uint8Array }, current: Pick<InventorySnapshot, 'categories' | 'tags'>): Promise<RestoreRead> {
  const meta = { name: file.name, size: file.bytes.length };
  if (!looksLikeZip(file.bytes)) {
    return { ok: false, problems: [{ file: file.name, row: null, message: 'only a full-backup ZIP can be restored; a data-only CSV is for spreadsheets' }], warnings: [] };
  }
  const read = await readBackupZip(file.bytes);
  if (!read.bundle) return { ok: false, problems: read.problems, warnings: read.warnings };
  return planRestore(read.bundle, current, meta, read.warnings);
}
