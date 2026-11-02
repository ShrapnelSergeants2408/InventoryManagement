// Reads a full backup ZIP or a data-only CSV into one in-memory bundle (SPEC v2.0 §7).
// Nothing here touches the database; restore applies a bundle later.
import JSZip from 'jszip';
import type { Category, Item, Location } from '../domain/types';
import { decodeCsvBytes, type FileProblem } from './csv';
import { INVENTORY_FILE, parseInventoryCsv } from './inventory-csv';
import { CATEGORIES_FILE, LOCATIONS_FILE, parseCategoriesCsv, parseLocationsCsv } from './lists-csv';

export const MANIFEST_FILE = 'manifest.json';

/** Written into full backups (§7); optional when reading. */
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
  /** Item ids whose photo_file names a photo the ZIP doesn't have. */
  missingPhotos: string[];
  /** null when the file wasn't in the backup (lists are then rebuilt by the caller). */
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
      missingPhotos: [],
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

/** Reports photos read so far, of the photos the CSV names, once the items are read (restore progress). */
export type PhotoProgress = (done: number, total: number, items: number) => void;

/** Reads a full backup. */
export async function readBackupZip(data: ArrayBuffer | Uint8Array | Blob, onPhoto?: PhotoProgress): Promise<BundleRead> {
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
  // A CSV edited in Excel and zipped again may be Windows-1252, as a loose CSV may.
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

  const locationsText = await text(LOCATIONS_FILE);
  const categoriesText = await text(CATEGORIES_FILE);
  const locations = locationsText === null ? null : parseLocationsCsv(locationsText);
  const categories = categoriesText === null ? null : parseCategoriesCsv(categoriesText);
  for (const p of [locations, categories]) if (p) problems.push(...p.problems);
  warnings.unshift(...decodeWarnings);

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
      missingPhotos,
      locations: locations?.list ?? null,
      categories: categories?.list ?? null,
      manifest,
      zipDate: dates.length ? new Date(Math.max(...dates)) : null,
    },
    problems: [],
    warnings,
  };
}

