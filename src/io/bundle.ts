// Reads a full backup ZIP into one in-memory bundle (SPEC v2.0 §7): the H2 files, or an H1
// (0.1.1) backup converted to the household model. Nothing here touches the database;
// restore applies a bundle later.
import JSZip from 'jszip';
import { emptyData, type HouseholdData } from '../domain/integrity';
import { ID_PREFIX, newId } from '../domain/ids';
import type { PhotoInfo } from '../domain/types';
import { decodeCsvBytes, type FileProblem } from './csv';
import { H1_INVENTORY_FILE, H1_LOCATIONS_FILE, convertH1Backup, parseH1Inventory, parseH1Locations } from './h1-backup';
import {
  AREAS_FILE,
  BINS_FILE,
  FILES_FILE,
  ITEMS_FILE,
  SEASONS_FILE,
  SPOTS_FILE,
  TAGS_FILE,
  parseAreas,
  parseBins,
  parseFiles,
  parseItems,
  parseSeasons,
  parseSpots,
  parseTags,
  type Parsed,
} from './household-csv';
import { CATEGORIES_FILE, parseCategoriesCsv } from './lists-csv';

export const MANIFEST_FILE = 'manifest.json';

/** Written into full backups (§7); optional when reading. H1 backups have only the first five. */
export interface Manifest {
  app: string;
  appVersion: string;
  savedAt: string;
  itemCount: number;
  photoCount: number;
  areaCount?: number;
  spotCount?: number;
  binCount?: number;
  seasonCount?: number;
}

export interface Bundle {
  /** h2: the §7 files; h1: an H1 backup, converted. */
  format: 'h2' | 'h1';
  data: HouseholdData;
  /** Photo id → image, for photos whose file was found in the ZIP. */
  images: Map<string, Blob>;
  /** Photo ids whose file the backup names but doesn't have. */
  missingImages: string[];
  /** False when the backup had no categories.csv (the list is then rebuilt by the caller). */
  hasCategories: boolean;
  /** False when the backup had no tags.csv. */
  hasTags: boolean;
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

/** Reports photos read so far, of the photos the backup names, once the records are read (restore progress). */
export type PhotoProgress = (done: number, total: number, items: number) => void;

const fail = (message: string): BundleRead => ({ bundle: null, problems: [{ file: 'backup', row: null, message }], warnings: [] });

/** Reads a full backup. */
export async function readBackupZip(data: ArrayBuffer | Uint8Array | Blob, onPhoto?: PhotoProgress): Promise<BundleRead> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(data);
  } catch {
    return fail("this file isn't a readable ZIP backup");
  }

  // Accept files at the root or inside one top-level folder (a re-zipped backup folder).
  const find = (file: string) =>
    Object.values(zip.files)
      .filter((f) => !f.dir && new RegExp(`(^|/)${file.replace('.', '\\.')}$`, 'i').test(f.name) && !f.name.startsWith('__MACOSX/'))
      .sort((a, b) => a.name.length - b.name.length)[0];
  const main = find(ITEMS_FILE) ?? find(H1_INVENTORY_FILE);
  if (!main) return fail(`the ZIP has no ${ITEMS_FILE}, so it isn't a backup made by this app`);
  const format: Bundle['format'] = main.name.toLowerCase().endsWith(ITEMS_FILE) ? 'h2' : 'h1';
  const prefix = main.name.slice(0, main.name.length - (format === 'h2' ? ITEMS_FILE : H1_INVENTORY_FILE).length);
  const entry = (name: string) => {
    const want = (prefix + name).toLowerCase();
    return Object.values(zip.files).find((f) => !f.dir && f.name.toLowerCase() === want) ?? null;
  };
  // A CSV edited in Excel and zipped again may be Windows-1252.
  const warnings: string[] = [];
  const problems: FileProblem[] = [];
  const text = async (name: string) => {
    const f = entry(name);
    if (!f) return null;
    const d = decodeCsvBytes(await f.async('uint8array'), name);
    warnings.push(...d.warnings);
    return d.text;
  };
  const take = <T>(p: Parsed<T> | { list: T[]; problems: FileProblem[]; ignoredColumns?: string[] }, file: string): T[] => {
    problems.push(...p.problems);
    if (p.ignoredColumns?.length) warnings.push(`${file}: ignored columns ${p.ignoredColumns.join(', ')}`);
    return p.list;
  };

  let manifest: Manifest | null = null;
  const manifestText = await text(MANIFEST_FILE);
  if (manifestText !== null) {
    try {
      manifest = JSON.parse(manifestText) as Manifest;
    } catch {
      warnings.push(`${MANIFEST_FILE} couldn't be read and was ignored`);
    }
  }

  const categoriesText = await text(CATEGORIES_FILE);
  const out: HouseholdData = emptyData();
  out.categories = categoriesText === null ? [] : take(parseCategoriesCsv(categoriesText), CATEGORIES_FILE);
  // Photo records with where their file is.
  const wanted: Array<PhotoInfo & { path: string }> = [];
  let hasTags = false;

  if (format === 'h2') {
    const read = async <T>(file: string, parse: (t: string) => Parsed<T>) => {
      const t = await text(file);
      return t === null ? [] : take(parse(t), file);
    };
    out.items = await read(ITEMS_FILE, parseItems);
    out.areas = await read(AREAS_FILE, parseAreas);
    out.spots = await read(SPOTS_FILE, parseSpots);
    out.bins = await read(BINS_FILE, parseBins);
    out.seasons = await read(SEASONS_FILE, parseSeasons);
    const tagsText = await text(TAGS_FILE);
    hasTags = tagsText !== null;
    out.tags = tagsText === null ? [] : take(parseTags(tagsText), TAGS_FILE);
    for (const { path, ...p } of await read(FILES_FILE, parseFiles)) wanted.push({ ...p, path });
  } else {
    const inv = parseH1Inventory((await text(H1_INVENTORY_FILE))!);
    problems.push(...inv.problems);
    if (inv.ignoredColumns.length) warnings.push(`${H1_INVENTORY_FILE}: ignored columns ${inv.ignoredColumns.join(', ')}`);
    const locText = await text(H1_LOCATIONS_FILE);
    const locations = locText === null ? [] : take(parseH1Locations(locText), H1_LOCATIONS_FILE);
    const c = convertH1Backup(inv.rows, locations);
    Object.assign(out, { items: c.items, areas: c.areas, spots: c.spots, seasons: c.seasons });
    const taken = new Set<string>();
    for (const r of inv.rows) {
      if (!r.photoFile) continue;
      const id = newId(ID_PREFIX.photo, (x) => taken.has(x));
      taken.add(id);
      wanted.push({ id, ownerType: 'item', ownerId: r.id, kind: 'photo', caption: '', order: 0, path: r.photoFile });
    }
    warnings.push('This is a backup from version 0.1.1: its locations become spots in an “Unsorted” area.');
  }

  if (problems.length > 0) return { bundle: null, problems, warnings };

  const images = new Map<string, Blob>();
  const used = new Set<string>();
  const missingImages: string[] = [];
  let done = 0;
  for (const p of wanted) {
    onPhoto?.(done++, wanted.length, out.items.length);
    const f = entry(p.path);
    const type = photoType(p.path);
    if (!f || !type) {
      missingImages.push(p.id);
      continue;
    }
    used.add(f.name);
    images.set(p.id, new Blob([await f.async('arraybuffer')], { type }));
  }
  onPhoto?.(wanted.length, wanted.length, out.items.length);
  out.photos = wanted.map(({ path: _p, ...p }) => p);
  // An H1 photo that's missing can't be kept from the phone (its id is new), so it's dropped.
  if (format === 'h1') out.photos = out.photos.filter((p) => images.has(p.id));
  if (missingImages.length > 0) warnings.push(`${missingImages.length} photo file(s) named in the backup aren't in the ZIP`);
  const unused = Object.values(zip.files).filter((f) => !f.dir && f.name.startsWith(`${prefix}photos/`) && !used.has(f.name));
  if (unused.length > 0) warnings.push(`${unused.length} photo file(s) in the ZIP aren't used by any record`);
  const withPhoto = new Set(out.photos.filter((p) => p.ownerType === 'item' && (images.has(p.id) || format === 'h2')).map((p) => p.ownerId));
  out.items = out.items.map((i) => ({ ...i, hasPhoto: withPhoto.has(i.id) }));

  const dates = Object.values(zip.files)
    .filter((f) => !f.dir)
    .map((f) => f.date.getTime());
  return {
    bundle: {
      format,
      data: out,
      images,
      missingImages: format === 'h2' ? missingImages : [],
      hasCategories: categoriesText !== null,
      hasTags,
      manifest,
      zipDate: dates.length ? new Date(Math.max(...dates)) : null,
    },
    problems: [],
    warnings,
  };
}
