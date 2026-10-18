// inventory.csv (SPEC §7): one row per item, vendor options flattened into v1_/v2_/v3_ groups.
import { centsToPlain, parsePrice } from '../domain/money';
import { VENDOR_SLOTS, type Item, type Vendor, type VendorSlot } from '../domain/types';
import { isIsoDate, parseWholeNumber, validateItem } from '../domain/validate';
import { cellGetter, normalizeDate, readCsv, writeCsv, type FileProblem } from './csv';

export const INVENTORY_FILE = 'inventory.csv';

export const VENDOR_FIELDS = ['supplier', 'part_no', 'url', 'pack_size', 'pack_price', 'price_checked'] as const;

export const INVENTORY_COLUMNS: readonly string[] = [
  'id',
  'name',
  'category',
  'subcategory',
  'location',
  'unit',
  'on_hand',
  'desired',
  'spares',
  'barcode',
  'notes',
  'source',
  'preferred_vendor',
  'photo_file',
  'last_counted',
  ...VENDOR_SLOTS.flatMap((s) => VENDOR_FIELDS.map((f) => `v${s}_${f}`)),
];

/** Columns a file must have; everything else defaults when missing (older and hand-edited files, §7). */
export const REQUIRED_INVENTORY_COLUMNS = ['id', 'name', 'category', 'unit', 'on_hand', 'desired'] as const;

export interface ParsedInventory {
  items: Item[];
  /** Item id → photo path inside the ZIP (photo_file), for ids that name one. */
  photoFiles: Map<string, string>;
  problems: FileProblem[];
  /** Headers present in the file that this app doesn't use (ignored). */
  ignoredColumns: string[];
}

const EXCEL_SCIENTIFIC = /^\d(\.\d+)?e\+\d+$/i;

export function parseInventoryCsv(text: string): ParsedInventory {
  const table = readCsv(text, INVENTORY_FILE);
  const problems = [...table.problems];
  const known = new Set(INVENTORY_COLUMNS);
  const ignoredColumns = table.headers.filter((h) => h !== '' && !known.has(h.trim().toLowerCase()));
  const missing = REQUIRED_INVENTORY_COLUMNS.filter((c) => !table.columns.has(c));
  if (missing.length > 0) {
    problems.push({ file: INVENTORY_FILE, row: 1, message: `missing column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}` });
    return { items: [], photoFiles: new Map(), problems, ignoredColumns };
  }

  const items: Item[] = [];
  const photoFiles = new Map<string, string>();
  const seenIds = new Map<string, number>();

  for (const { row, cells } of table.rows) {
    const get = cellGetter(table, cells);
    const t = (h: string) => get(h).trim();
    const rowErrors: string[] = [];

    const whole = (h: string, label: string, fallback: number | null, min = 0): number => {
      const raw = t(h);
      if (raw === '' && fallback !== null) return fallback;
      if (raw === '') {
        rowErrors.push(`${label} is required`);
        return 0;
      }
      const r = parseWholeNumber(raw, label, min);
      if (!r.ok) {
        rowErrors.push(r.error);
        return 0;
      }
      return r.value;
    };
    const date = (h: string, label: string): string => {
      const raw = t(h);
      if (raw === '') return '';
      const d = normalizeDate(raw);
      if (d === null || !isIsoDate(d)) {
        rowErrors.push(`${label} "${raw}" must be a date like 2026-10-17`);
        return '';
      }
      return d;
    };

    const id = t('id');
    if (id !== '') {
      const firstRow = seenIds.get(id.toLowerCase());
      if (firstRow !== undefined) rowErrors.push(`id "${id}" is used again (first on row ${firstRow})`);
      else seenIds.set(id.toLowerCase(), row);
    }

    const sourceRaw = t('source').toLowerCase();
    let source: Item['source'] = 'team';
    if (sourceRaw === 'starter' || sourceRaw === 'team') source = sourceRaw;
    else if (sourceRaw !== '') rowErrors.push(`source "${t('source')}" must be "starter" or "team"`);

    const barcode = t('barcode');
    if (EXCEL_SCIENTIFIC.test(barcode)) {
      rowErrors.push(`barcode "${barcode}" was turned into scientific notation by a spreadsheet; re-enter the full number`);
    }

    const vendors: Item['vendors'] = [null, null, null];
    for (const slot of VENDOR_SLOTS) {
      const v = (f: string) => t(`v${slot}_${f}`);
      if (VENDOR_FIELDS.every((f) => v(f) === '')) continue;
      const label = `vendor option ${slot}`;
      const supplier = v('supplier');
      if (supplier === '') rowErrors.push(`${label}: supplier is required when any v${slot}_ field is filled in`);
      const packSize = whole(`v${slot}_pack_size`, `${label} pack size`, null, 1);
      const price = parsePrice(v('pack_price'));
      if (!price.ok) rowErrors.push(`${label}: ${price.error}`);
      const vendor: Vendor = {
        supplier,
        partNo: v('part_no'),
        url: v('url'),
        packSize,
        packPriceCents: price.ok ? price.cents : null,
        priceChecked: date(`v${slot}_price_checked`, `${label} price checked`),
      };
      vendors[slot - 1] = vendor;
    }

    let preferredVendor: VendorSlot = 1;
    const pv = t('preferred_vendor');
    if (pv === '2' || pv === '3') preferredVendor = Number(pv) as VendorSlot;
    else if (pv !== '' && pv !== '1') rowErrors.push(`preferred_vendor "${pv}" must be 1, 2 or 3`);

    const photoFile = t('photo_file');
    const item: Item = {
      id,
      name: t('name'),
      category: t('category'),
      subcategory: t('subcategory'),
      location: t('location'),
      unit: t('unit'),
      onHand: whole('on_hand', 'on hand', null),
      desired: whole('desired', 'desired', null),
      spares: whole('spares', 'spares', 0),
      barcode,
      // Notes keep their inner line breaks and spacing; only outer whitespace is trimmed.
      notes: get('notes').trim(),
      source,
      lastCounted: date('last_counted', 'last counted'),
      preferredVendor,
      vendors,
      hasPhoto: false,
    };

    if (rowErrors.length === 0) {
      for (const e of validateItem(item, null)) rowErrors.push(e.message);
    }
    if (rowErrors.length > 0) {
      for (const message of rowErrors) problems.push({ file: INVENTORY_FILE, row, message });
      continue;
    }
    if (photoFile !== '') photoFiles.set(id, photoFile);
    items.push(item);
  }
  return { items, photoFiles, problems, ignoredColumns };
}

/** Photo path inside a full backup ZIP (§7); the extension follows the photo's type. */
export function photoPathFor(id: string, type = 'image/jpeg'): string {
  const ext = type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg';
  return `photos/${id}.${ext}`;
}

export function inventoryRow(item: Item, photoPath: (id: string) => string = photoPathFor): string[] {
  const cells: Record<string, string> = {
    id: item.id,
    name: item.name,
    category: item.category,
    subcategory: item.subcategory,
    location: item.location,
    unit: item.unit,
    on_hand: String(item.onHand),
    desired: String(item.desired),
    spares: String(item.spares),
    barcode: item.barcode,
    notes: item.notes,
    source: item.source,
    preferred_vendor: String(item.preferredVendor),
    photo_file: item.hasPhoto ? photoPath(item.id) : '',
    last_counted: item.lastCounted,
  };
  for (const slot of VENDOR_SLOTS) {
    const v = item.vendors[slot - 1];
    cells[`v${slot}_supplier`] = v?.supplier ?? '';
    cells[`v${slot}_part_no`] = v?.partNo ?? '';
    cells[`v${slot}_url`] = v?.url ?? '';
    cells[`v${slot}_pack_size`] = v ? String(v.packSize) : '';
    cells[`v${slot}_pack_price`] = v && v.packPriceCents !== null ? centsToPlain(v.packPriceCents) : '';
    cells[`v${slot}_price_checked`] = v?.priceChecked ?? '';
  }
  return INVENTORY_COLUMNS.map((c) => cells[c] ?? '');
}

export function serializeInventoryCsv(items: readonly Item[], photoPath: (id: string) => string = photoPathFor): string {
  return writeCsv(INVENTORY_COLUMNS, items.map((i) => inventoryRow(i, photoPath)));
}
