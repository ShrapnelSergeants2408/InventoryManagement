// Reads a full backup ZIP into one in-memory bundle (SPEC v3.0 §7): the §7 files, or a 0.1.2
// backup (no parts) converted the way the phone's upgrade converts its data (§3, "Upgrading").
// 0.1.1 (H1) backups are no longer read. Nothing here touches the database; restore applies a
// bundle later.
import JSZip from 'jszip';
import { emptyData, type HouseholdData } from '../domain/integrity';
import { fromV2, lettersToCodes } from '../domain/parts';
import type { PhotoInfo } from '../domain/types';
import { decodeCsvBytes, type FileProblem } from './csv';
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

/** Written into full backups (§7); optional when reading. */
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
  /** Records per part (§7, from 0.1.3). */
  parts?: Record<string, { items: number; areas: number; bins: number }>;
}

/** The items file of a 0.1.1 backup, which this version no longer reads (§3). */
const H1_INVENTORY_FILE = 'inventory.csv';

export interface Bundle {
  /** v3: the §7 files (0.1.3 on); v2: a 0.1.2 backup, converted to two parts. */
  format: 'v3' | 'v2';
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
  const main = find(ITEMS_FILE);
  if (!main) {
    if (find(H1_INVENTORY_FILE)) return fail('this is a backup from version 0.1.1, which this version can no longer read');
    return fail(`the ZIP has no ${ITEMS_FILE}, so it isn't a backup made by this app`);
  }
  const prefix = main.name.slice(0, main.name.length - ITEMS_FILE.length);
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

  const read = async <T>(file: string, parse: (t: string) => Parsed<T>) => {
    const t = await text(file);
    if (t === null) return { list: [] as T[], hasPart: null };
    const p = parse(t);
    return { list: take(p, file), hasPart: p.hasPart };
  };
  const items = await read(ITEMS_FILE, parseItems);
  out.items = items.list;
  const areas = await read(AREAS_FILE, parseAreas);
  out.areas = areas.list;
  out.spots = (await read(SPOTS_FILE, parseSpots)).list;
  const bins = await read(BINS_FILE, parseBins);
  out.bins = bins.list;
  out.seasons = (await read(SEASONS_FILE, parseSeasons)).list;
  const tagsText = await text(TAGS_FILE);
  hasTags = tagsText !== null;
  out.tags = tagsText === null ? [] : take(parseTags(tagsText), TAGS_FILE);
  for (const { path, ...p } of (await read(FILES_FILE, parseFiles)).list) wanted.push({ ...p, path });
  // 0.1.2 wrote no `part` column (§3, "Upgrading a 0.1.2 phone").
  const format: Bundle['format'] = items.hasPart === false ? 'v2' : 'v3';
  // Every file with records of a part must agree: a 0.1.2 file mixed with 0.1.3 ones (one re-saved
  // without its part column) would otherwise move the whole Holiday part to Household.
  const mixed = [
    [ITEMS_FILE, items.hasPart],
    [AREAS_FILE, areas.hasPart],
    [BINS_FILE, bins.hasPart],
  ].filter(([, h]) => h !== null && h !== (format === 'v3'));
  if (mixed.length > 0) {
    problems.push({ file: 'backup', row: null, message: `${mixed.map(([f]) => f).join(', ')} ${format === 'v3' ? 'lack' : 'have'} the part column that ${ITEMS_FILE} ${format === 'v3' ? 'has' : 'lacks'}; the files don't come from one backup` });
  }

  if (problems.length > 0) return { bundle: null, problems, warnings };
  // The first 0.1.3 build wrote areas.csv with `letter`, not `code`: convert as its phones upgrade.
  const areasText = await text(AREAS_FILE);
  const areasHeader = (areasText ?? '').split(/\r?\n/, 1)[0]!.toLowerCase().split(',').map((h) => h.trim().replace(/^﻿/, ''));
  if (format === 'v3' && areasHeader.includes('letter') && !areasHeader.includes('code')) {
    const coded = lettersToCodes(out.areas.map(({ code, ...a }) => ({ ...a, letter: code })), out.bins);
    out.areas = coded.areas;
    out.bins = coded.bins;
    warnings.push('This backup is from the first 0.1.3 build: its areas get codes from their names, and their bins are renamed (A-04 → ATTIC-04).');
  }
  if (format === 'v2') {
    // Season dates came with 0.1.3: the conversion gives each season its default dates.
    const seasons = out.seasons.map(({ setupFrom: _f, takedownBy: _t, ...rest }) => rest);
    Object.assign(out, fromV2({ ...out, seasons, areas: out.areas.map(({ code, ...a }) => ({ ...a, letter: code })) }));
    warnings.push('This backup is from version 0.1.2: everything in it goes to Household, and its seasons to Holiday.');
  }

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
  if (missingImages.length > 0) warnings.push(`${missingImages.length} photo file(s) named in the backup aren't in the ZIP`);
  const unused = Object.values(zip.files).filter((f) => !f.dir && f.name.startsWith(`${prefix}photos/`) && !used.has(f.name));
  if (unused.length > 0) warnings.push(`${unused.length} photo file(s) in the ZIP aren't used by any record`);
  const withPhoto = new Set(out.photos.filter((p) => p.ownerType === 'item').map((p) => p.ownerId));
  out.items = out.items.map((i) => ({ ...i, hasPhoto: withPhoto.has(i.id) }));

  const dates = Object.values(zip.files)
    .filter((f) => !f.dir)
    .map((f) => f.date.getTime());
  return {
    bundle: {
      format,
      data: out,
      images,
      missingImages,
      hasCategories: categoriesText !== null,
      hasTags,
      manifest,
      zipDate: dates.length ? new Date(Math.max(...dates)) : null,
    },
    problems: [],
    warnings,
  };
}
