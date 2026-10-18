// Reads a full backup ZIP or a data-only CSV into one in-memory bundle (SPEC §7, §12).
// Nothing here touches the database; restore and the starter-catalog load apply a bundle later.
import JSZip from 'jszip';
import type { Category, Item, Location, Supplier } from '../domain/types';
import type { FileProblem } from './csv';
import { INVENTORY_FILE, parseInventoryCsv } from './inventory-csv';
import {
  CATEGORIES_FILE,
  LOCATIONS_FILE,
  SUPPLIERS_FILE,
  parseCategoriesCsv,
  parseLocationsCsv,
  parseSuppliersCsv,
} from './lists-csv';

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
  /** null when the file wasn't in the backup (lists are then rebuilt by the caller). */
  suppliers: Supplier[] | null;
  locations: Location[] | null;
  categories: Category[] | null;
  manifest: Manifest | null;
  /** Latest modification date among the ZIP entries, as a fallback "saved" date. */
  zipDate: Date | null;
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

export function readInventoryCsvBundle(text: string): BundleRead & { photoFiles: Map<string, string> } {
  const parsed = parseInventoryCsv(text);
  const photoFiles = parsed.photoFiles;
  const warnings: string[] = [];
  if (parsed.ignoredColumns.length > 0) warnings.push(`Ignored columns: ${parsed.ignoredColumns.join(', ')}`);
  if (parsed.problems.length > 0) return { bundle: null, problems: parsed.problems, warnings, photoFiles };
  return {
    bundle: {
      kind: 'csv',
      items: parsed.items,
      photos: new Map(),
      suppliers: null,
      locations: null,
      categories: null,
      manifest: null,
      zipDate: null,
    },
    problems: [],
    warnings,
    photoFiles,
  };
}

export async function readBackupZip(data: ArrayBuffer | Uint8Array | Blob): Promise<BundleRead> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(data);
  } catch {
    return { bundle: null, problems: [{ file: 'backup', row: null, message: "this file isn't a readable ZIP backup" }], warnings: [] };
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
  const text = async (name: string) => {
    const f = entry(name);
    return f ? f.async('string') : null;
  };

  const read = readInventoryCsvBundle((await csvEntry.async('string'))!);
  const problems = [...read.problems];
  const warnings = [...read.warnings];

  const suppliersText = await text(SUPPLIERS_FILE);
  const locationsText = await text(LOCATIONS_FILE);
  const categoriesText = await text(CATEGORIES_FILE);
  const suppliers = suppliersText === null ? null : parseSuppliersCsv(suppliersText);
  const locations = locationsText === null ? null : parseLocationsCsv(locationsText);
  const categories = categoriesText === null ? null : parseCategoriesCsv(categoriesText);
  for (const p of [suppliers, locations, categories]) if (p) problems.push(...p.problems);

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
  for (const item of read.bundle.items) {
    const path = read.photoFiles.get(item.id);
    if (!path) continue;
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
  if (missing.length > 0) warnings.push(`Photos named in ${INVENTORY_FILE} but not in the ZIP: ${missing.join(', ')}`);
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
      suppliers: suppliers?.list ?? null,
      locations: locations?.list ?? null,
      categories: categories?.list ?? null,
      manifest,
      zipDate: dates.length ? new Date(Math.max(...dates)) : null,
    },
    problems: [],
    warnings,
  };
}

