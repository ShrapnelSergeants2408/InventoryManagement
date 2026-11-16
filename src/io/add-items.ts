// Add items from a file (F33, SPEC §23): read a starter-catalog ZIP or a bare inventory.csv, then
// plan what to add. Nothing here touches the database; data/add-items.ts applies a plan.
//
// Unlike a restore or the price import, a bad row is skipped and listed rather than failing the
// file (§23.2). Existing items are never changed: a row that matches one is "already present".
import JSZip from 'jszip';
import { barcodeKey } from '../domain/scan';
import { parsePrice } from '../domain/money';
import { VENDOR_SLOTS, nameKey, type Category, type Item, type Supplier, type Vendor, type VendorSlot } from '../domain/types';
import { normalizeUrl } from '../domain/url';
import { isIsoDate, parseWholeNumber, validateItem } from '../domain/validate';
import { cellGetter, decodeCsvBytes, normalizeDate, readCsv, type FileProblem } from './csv';
import { INVENTORY_FILE, VENDOR_FIELDS } from './inventory-csv';
import { CATEGORIES_FILE, SUPPLIERS_FILE, parseCategoriesCsv, parseSuppliersCsv } from './lists-csv';
import { looksLikeZip } from './restore';

/** §23.1: the app has no limit on restore files, so this import sets its own. */
export const MAX_ADD_FILE_BYTES = 50 * 1024 * 1024;
export const MAX_ADD_ZIP_ENTRIES = 2000;

const PHOTO_TYPES: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
const EXCEL_SCIENTIFIC = /^\d(\.\d+)?e\+\d+$/i;

/** A row that passed the checks: an item without its id (the tablet gives it one) and where its photo is. */
export interface AddRow {
  /** Spreadsheet row number, for messages. */
  row: number;
  item: Item;
  /** photo_file as written, '' when none. */
  photoFile: string;
}

export interface SkippedRow {
  row: number;
  /** The row's name when it has one. */
  name: string;
  message: string;
}

export interface AddFile {
  fileName: string;
  /** Rows that can be considered for adding, in file order. */
  rows: AddRow[];
  /** Rows refused while reading (§23.2 item 3). */
  skipped: SkippedRow[];
  /** Data rows read (blank rows skipped). */
  rowCount: number;
  /** categories.csv / suppliers.csv, when the ZIP has them; used only for order, websites and notes. */
  categories: Category[] | null;
  suppliers: Supplier[] | null;
  /** photo_file → bytes, for photos found in the ZIP. */
  photos: Map<string, Blob>;
  /** Rows (by number) whose photo_file names a photo the ZIP doesn't have. */
  missingPhotos: number[];
  ignoredColumns: string[];
  /** Links that weren't web addresses and were left blank. */
  clearedLinks: string[];
  warnings: string[];
}

export type AddRead = { ok: true; file: AddFile } | { ok: false; problems: FileProblem[] };

const READ_COLUMNS = new Set(['name', 'category', 'subcategory', 'unit', 'barcode', 'notes', 'preferred_vendor', 'photo_file']);
const REQUIRED = ['name', 'category', 'unit'] as const;

const fail = (message: string, file = 'file'): AddRead => ({ ok: false, problems: [{ file, row: null, message }] });

/** Name as compared for "already present": capitals and extra spaces don't matter (§23.2). */
export const itemNameKey = (name: string) => name.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');

/** Supplier + part number, or null when there's no part number to compare (§23.2 a). */
export const partKey = (supplier: string, partNo: string): string | null => {
  const p = partNo.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
  return p === '' ? null : `${nameKey(supplier)}\u0000${p}`;
};

function readRows(text: string, fileName: string): { rows: AddRow[]; skipped: SkippedRow[]; rowCount: number; ignoredColumns: string[]; clearedLinks: string[] } | FileProblem[] {
  const table = readCsv(text, INVENTORY_FILE);
  if (table.problems.length > 0) return table.problems;
  const missing = REQUIRED.filter((c) => !table.columns.has(c));
  if (missing.length > 0) {
    return [{ file: INVENTORY_FILE, row: table.headerRow, message: `${fileName} isn't a catalog file: missing column${missing.length > 1 ? 's' : ''} ${missing.join(', ')}` }];
  }
  const vendorColumns = new Set(VENDOR_SLOTS.flatMap((s) => VENDOR_FIELDS.map((f) => `v${s}_${f}`)));
  const ignoredColumns = table.headers.filter((h) => {
    const k = h.trim().toLowerCase();
    return k !== '' && !READ_COLUMNS.has(k) && !vendorColumns.has(k);
  });
  const rows: AddRow[] = [];
  const skipped: SkippedRow[] = [];
  const clearedLinks: string[] = [];

  for (const { row, cells } of table.rows) {
    const get = cellGetter(table, cells);
    const t = (h: string) => get(h).trim();
    const errors: string[] = [];
    const name = t('name');

    for (const [h, label] of [['name', 'name'], ['category', 'category'], ['unit', 'unit']] as const) {
      if (t(h) === '') errors.push(`${label} is missing`);
    }
    const barcode = t('barcode');
    if (EXCEL_SCIENTIFIC.test(barcode)) errors.push(`barcode "${barcode}" was turned into scientific notation by a spreadsheet`);

    const vendors: Item['vendors'] = [null, null, null];
    for (const slot of VENDOR_SLOTS) {
      const v = (f: string) => t(`v${slot}_${f}`);
      if (VENDOR_FIELDS.every((f) => v(f) === '')) continue;
      const label = `vendor option ${slot}`;
      const supplier = v('supplier');
      if (supplier === '') errors.push(`${label}: supplier is missing`);
      const packSize = v('pack_size') === '' ? ({ ok: false, error: `${label}: pack size is missing` } as const) : parseWholeNumber(v('pack_size'), `${label} pack size`, 1);
      if (!packSize.ok) errors.push(packSize.error);
      const price = parsePrice(v('pack_price'));
      if (!price.ok) errors.push(`${label}: ${price.error}`);
      let checked = '';
      if (v('price_checked') !== '') {
        const d = normalizeDate(v('price_checked'));
        if (d !== null && isIsoDate(d)) checked = d;
        else errors.push(`${label}: price checked "${v('price_checked')}" must be a date like 2026-10-17`);
      }
      let url = '';
      if (v('url') !== '') {
        const u = normalizeUrl(v('url'), `${label} link`);
        if (u.ok) url = u.url;
        else clearedLinks.push(`row ${row} option ${slot} (${v('url').slice(0, 40)})`);
      }
      const vendor: Vendor = { supplier, partNo: v('part_no'), url, packSize: packSize.ok ? packSize.value : 1, packPriceCents: price.ok ? price.cents : null, priceChecked: checked };
      vendors[slot - 1] = vendor;
    }
    if (vendors.every((v) => v === null)) errors.push('no vendor option (supplier, part number and price)');

    // The first option the file fills in is preferred unless the file names another one that exists.
    const firstSlot = (VENDOR_SLOTS.find((s) => vendors[s - 1] !== null) ?? 1) as VendorSlot;
    const pv = Number(t('preferred_vendor'));
    const preferredVendor = (pv === 1 || pv === 2 || pv === 3) && vendors[pv - 1] ? (pv as VendorSlot) : firstSlot;

    const item: Item = {
      id: 'new',
      name,
      category: t('category'),
      subcategory: t('subcategory'),
      location: '',
      unit: t('unit'),
      onHand: 0,
      desired: 0,
      spares: 0,
      barcode,
      notes: get('notes').trim(),
      source: 'team',
      lastCounted: '',
      countedBy: '',
      preferredVendor,
      vendors,
      hasPhoto: false,
    };
    if (errors.length === 0) for (const e of validateItem(item, null)) errors.push(e.message);
    if (errors.length > 0) {
      skipped.push({ row, name, message: errors.join('; ') });
      continue;
    }
    rows.push({ row, item, photoFile: t('photo_file') });
  }
  return { rows, skipped, rowCount: table.rows.length, ignoredColumns, clearedLinks };
}

/** Reads the file (§23.1). Whole-file problems are refused; bad rows are skipped and listed. */
export async function readAddFile(data: Uint8Array, fileName: string): Promise<AddRead> {
  if (data.length > MAX_ADD_FILE_BYTES) return fail(`this file is larger than ${MAX_ADD_FILE_BYTES / 1024 / 1024} MB, which is more than a catalog file should be`, fileName);
  const warnings: string[] = [];

  if (!looksLikeZip(data)) {
    const decoded = decodeCsvBytes(data, fileName);
    const read = readRows(decoded.text, fileName);
    if (Array.isArray(read)) return { ok: false, problems: read };
    return {
      ok: true,
      file: { fileName, ...read, categories: null, suppliers: null, photos: new Map(), missingPhotos: [], warnings: [...decoded.warnings, ...cleared(read.clearedLinks)] },
    };
  }

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(data);
  } catch {
    return fail("this file isn't a readable ZIP", fileName);
  }
  const entries = Object.values(zip.files).filter((f) => !f.dir && !f.name.startsWith('__MACOSX/'));
  if (entries.length > MAX_ADD_ZIP_ENTRIES) return fail(`the ZIP has ${entries.length} files; the most this import reads is ${MAX_ADD_ZIP_ENTRIES}`, fileName);
  if (entries.some((f) => /(^|\/)kit\.json$/i.test(f.name))) return fail('this is a count kit for a helper device, not a catalog file', fileName);
  if (entries.some((f) => /(^|\/)counts\.json$/i.test(f.name))) return fail('this is a counts file from a helper device, not a catalog file. Import it with Count › Import counts', fileName);
  const csvEntry = entries.filter((f) => /(^|\/)inventory\.csv$/i.test(f.name)).sort((a, b) => a.name.length - b.name.length)[0];
  if (!csvEntry) return fail(`the ZIP has no ${INVENTORY_FILE}; a catalog file is an inventory.csv, or a ZIP holding one`, fileName);
  const prefix = csvEntry.name.slice(0, csvEntry.name.length - INVENTORY_FILE.length);
  const entry = (name: string) => entries.find((f) => f.name.toLowerCase() === (prefix + name).toLowerCase()) ?? null;
  const textOf = async (name: string) => {
    const f = entry(name);
    if (!f) return null;
    const d = decodeCsvBytes(await f.async('uint8array'), name);
    warnings.push(...d.warnings);
    return d.text;
  };

  const decoded = decodeCsvBytes(await csvEntry.async('uint8array'), INVENTORY_FILE);
  warnings.push(...decoded.warnings);
  const read = readRows(decoded.text, fileName);
  if (Array.isArray(read)) return { ok: false, problems: read };

  // categories.csv and suppliers.csv only supply order, websites and notes; a bad one is ignored with a note.
  let categories: Category[] | null = null;
  let suppliers: Supplier[] | null = null;
  const categoriesText = await textOf(CATEGORIES_FILE);
  if (categoriesText !== null) {
    const p = parseCategoriesCsv(categoriesText);
    if (p.problems.length > 0) warnings.push(`${CATEGORIES_FILE} was ignored: ${p.problems[0]!.message}`);
    else categories = p.list;
  }
  const suppliersText = await textOf(SUPPLIERS_FILE);
  if (suppliersText !== null) {
    const p = parseSuppliersCsv(suppliersText);
    if (p.problems.length > 0) warnings.push(`${SUPPLIERS_FILE} was ignored: ${p.problems[0]!.message}`);
    else suppliers = p.list;
  }

  const photos = new Map<string, Blob>();
  const missingPhotos: number[] = [];
  for (const r of read.rows) {
    if (r.photoFile === '') continue;
    const f = entry(r.photoFile);
    const type = PHOTO_TYPES[r.photoFile.split('.').pop()?.toLowerCase() ?? ''];
    if (!f || !type) {
      missingPhotos.push(r.row);
      continue;
    }
    if (!photos.has(r.photoFile)) photos.set(r.photoFile, new Blob([await f.async('arraybuffer')], { type }));
  }
  return { ok: true, file: { fileName, ...read, categories, suppliers, photos, missingPhotos, warnings: [...warnings, ...cleared(read.clearedLinks)] } };
}

function cleared(links: readonly string[]): string[] {
  if (links.length === 0) return [];
  return [`Links that aren't web addresses were left blank: ${links.slice(0, 5).join(', ')}${links.length > 5 ? ` and ${links.length - 5} more` : ''}`];
}

// ---------------------------------------------------------------------------------------------
// The plan (§23.2)

export interface PresentRow {
  row: number;
  name: string;
  /** Why it counts as present: "same part number from REV as “NEO 2.0” (REV-21-1650)" or "same name as …". */
  reason: string;
}

export interface NewItem {
  row: number;
  /** Complete except the id, which the tablet gives at apply time. Category, subcategory and suppliers are spelled as on the tablet. */
  item: Item;
  /** photo_file of the photo to store, or '' for none. */
  photoFile: string;
}

export interface AddPlan {
  fileName: string;
  rowCount: number;
  newItems: NewItem[];
  present: PresentRow[];
  skipped: SkippedRow[];
  /** Created in this order (§23.2 item 4). Subcategories are listed with their category. */
  newCategories: Category[];
  newSubcategories: { category: string; name: string }[];
  newSuppliers: Supplier[];
  photos: Map<string, Blob>;
  /** Rows whose photo the file named but didn't have (the item is still added). */
  missingPhotos: number;
  /** Barcodes left off because another item already has the same code. */
  barcodesCleared: number;
  ignoredColumns: string[];
  warnings: string[];
}

/** What the tablet already has, in the forms rows are compared by. */
export interface Presence {
  parts: Map<string, string>;
  names: Map<string, string>;
  barcodes: Set<string>;
}

export function presenceOf(items: readonly Item[]): Presence {
  const p: Presence = { parts: new Map(), names: new Map(), barcodes: new Set() };
  for (const it of items) addToPresence(p, it);
  return p;
}

export function addToPresence(p: Presence, it: Item): void {
  for (const v of it.vendors) {
    if (!v) continue;
    const k = partKey(v.supplier, v.partNo);
    if (k !== null && !p.parts.has(k)) p.parts.set(k, it.name);
  }
  const n = itemNameKey(it.name);
  if (!p.names.has(n)) p.names.set(n, it.name);
  if (it.barcode !== '') p.barcodes.add(barcodeKey(it.barcode));
}

/** Why the item is already present, or null (§23.2 a, b). */
export function presentReason(p: Presence, it: Item): string | null {
  for (const v of it.vendors) {
    if (!v) continue;
    const k = partKey(v.supplier, v.partNo);
    const other = k === null ? undefined : p.parts.get(k);
    if (other !== undefined) return `same part number (${v.supplier} ${v.partNo.trim()}) as “${other}”`;
  }
  const other = p.names.get(itemNameKey(it.name));
  return other === undefined ? null : `same name as “${other}”`;
}

export function planAddItems(file: AddFile, current: { items: readonly Item[]; suppliers: readonly Supplier[]; categories: readonly Category[] }): AddPlan {
  const have = presenceOf(current.items);
  const inFile: Presence = { parts: new Map(), names: new Map(), barcodes: new Set() };
  const categoryByKey = new Map(current.categories.map((c) => [nameKey(c.name), c]));
  const supplierByKey = new Map(current.suppliers.map((s) => [nameKey(s.name), s.name]));

  const skipped = [...file.skipped];
  const present: PresentRow[] = [];
  const newItems: NewItem[] = [];
  const createdCategories = new Map<string, string>(); // key → name as first written
  const createdSubs = new Map<string, { category: string; name: string }>();
  const createdSuppliers = new Map<string, string>();
  let barcodesCleared = 0;

  for (const r of file.rows) {
    const reason = presentReason(have, r.item);
    if (reason !== null) {
      present.push({ row: r.row, name: r.item.name, reason });
      continue;
    }
    const again = presentReason(inFile, r.item);
    if (again !== null) {
      skipped.push({ row: r.row, name: r.item.name, message: `repeats an earlier row in the file (${again})` });
      continue;
    }

    // Spell category, subcategory and suppliers like the tablet's lists (names match ignoring capitals, §3).
    const cat = categoryByKey.get(nameKey(r.item.category));
    const catName = cat?.name ?? createdCategories.get(nameKey(r.item.category)) ?? r.item.category;
    if (!cat && !createdCategories.has(nameKey(catName))) createdCategories.set(nameKey(catName), catName);
    let sub = r.item.subcategory;
    if (sub !== '') {
      const listed = cat?.subcategories.find((s) => nameKey(s) === nameKey(sub));
      const made = createdSubs.get(`${nameKey(catName)}\u0000${nameKey(sub)}`);
      if (listed) sub = listed;
      else if (made) sub = made.name;
      else createdSubs.set(`${nameKey(catName)}\u0000${nameKey(sub)}`, { category: catName, name: sub });
    }
    const vendors = r.item.vendors.map((v) => {
      if (!v) return null;
      const known = supplierByKey.get(nameKey(v.supplier)) ?? createdSuppliers.get(nameKey(v.supplier));
      if (known) return { ...v, supplier: known };
      createdSuppliers.set(nameKey(v.supplier), v.supplier);
      return v;
    }) as Item['vendors'];

    let barcode = r.item.barcode;
    if (barcode !== '' && (have.barcodes.has(barcodeKey(barcode)) || inFile.barcodes.has(barcodeKey(barcode)))) {
      barcode = '';
      barcodesCleared++;
    }
    const item: Item = { ...r.item, category: catName, subcategory: sub, barcode, vendors };
    addToPresence(inFile, item);
    newItems.push({ row: r.row, item, photoFile: r.photoFile });
  }

  // New lists, in the file's categories.csv order when it has one, else in order of first use (§23.2 item 4).
  const fileOrder = new Map((file.categories ?? []).map((c, i) => [nameKey(c.name), i]));
  const newCategories: Category[] = [...createdCategories.entries()]
    .map(([key, name], use) => ({ key, name, rank: fileOrder.get(key) ?? Number.MAX_SAFE_INTEGER, use }))
    .sort((a, b) => a.rank - b.rank || a.use - b.use)
    .map((c, i) => ({ name: c.name, order: current.categories.length + i, subcategories: [] }));
  const subs = [...createdSubs.values()];
  for (const c of newCategories) c.subcategories = subs.filter((s) => nameKey(s.category) === nameKey(c.name)).map((s) => s.name);
  const newSubcategories = subs.filter((s) => !newCategories.some((c) => nameKey(c.name) === nameKey(s.category)));

  const fileSuppliers = new Map((file.suppliers ?? []).map((s) => [nameKey(s.name), s]));
  const newSuppliers: Supplier[] = [...createdSuppliers.entries()].map(([key, name]) => ({ name, website: fileSuppliers.get(key)?.website ?? '', notes: fileSuppliers.get(key)?.notes ?? '' }));

  skipped.sort((a, b) => a.row - b.row);
  return {
    fileName: file.fileName,
    rowCount: file.rowCount,
    newItems,
    present,
    skipped,
    newCategories,
    newSubcategories,
    newSuppliers,
    photos: file.photos,
    missingPhotos: file.missingPhotos.filter((row) => newItems.some((n) => n.row === row)).length,
    barcodesCleared,
    ignoredColumns: file.ignoredColumns,
    warnings: file.warnings,
  };
}
