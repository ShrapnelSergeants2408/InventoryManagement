// Price-update import (F18, SPEC §10, spec-questions Q4). The whole file is checked against the
// tablet's data first; any problem means nothing is saved. Only vendor fields can change.
//
// Columns: `id` (required) and v1_…v3_ × supplier, part_no, url, pack_size, pack_price,
// price_checked. Other inventory.csv columns (name, on_hand, …) are ignored, so a data-only
// backup works as the input. Anything else is an error. A blank cell leaves the field as it is.
// A row can fill an empty vendor slot (supplier and pack size needed) but can't remove one or
// change the preferred vendor.
//
// Because a data-only export has every vendor cell filled, re-importing an old export would also
// write back vendor details edited (or options deleted) since then. The plan therefore carries a
// field-by-field preview, shown before the PIN, that flags anything other than a price or a
// price-checked date.
import { formatCents, parsePrice } from '../domain/money';
import { VENDOR_SLOTS, nameKey, type Item, type Supplier, type Vendor, type VendorSlot } from '../domain/types';
import { normalizeUrl } from '../domain/url';
import { isIsoDate, parseWholeNumber } from '../domain/validate';
import { cellGetter, normalizeDate, readCsv, type FileProblem } from './csv';
import { INVENTORY_COLUMNS, VENDOR_FIELDS } from './inventory-csv';

export interface PriceProblem extends FileProblem {
  /** The row's item id, when it has one. */
  id?: string;
}

export interface SlotUpdate {
  slot: VendorSlot;
  /** The fields the file gives (non-blank cells), already checked and converted. */
  set: Partial<Vendor>;
  /** True when the slot was empty on the tablet when the file was checked. */
  adds: boolean;
}

export interface ItemUpdate {
  row: number;
  id: string;
  updates: SlotUpdate[];
}

export type PriceField = 'supplier' | 'part #' | 'link' | 'pack size' | 'pack price' | 'price checked';

export interface FieldChange {
  field: PriceField;
  /** As shown to the mentor: "$12.99", "no price", "blank". */
  before: string;
  after: string;
}

export interface OptionPreview {
  slot: VendorSlot;
  /** The slot was empty on the tablet: the file adds a vendor option. */
  adds: boolean;
  changes: FieldChange[];
}

export interface ItemPreview {
  id: string;
  name: string;
  options: OptionPreview[];
}

export interface PricePlan {
  fileName: string;
  /** Data rows read (blank rows skipped). */
  rowCount: number;
  /** Only items with at least one vendor option that actually changes. */
  items: ItemUpdate[];
  optionsChanged: number;
  optionsAdded: number;
  /** Options the file mentions whose values already match. */
  optionsUnchanged: number;
  /** What changes, item by item, in the same order as `items`. */
  preview: ItemPreview[];
  /**
   * Changes to anything other than a price or price-checked date (supplier, part #, link, pack
   * size), plus added options. Expected rarely from a price refresh; the preview warns about them.
   */
  detailChanges: number;
  /** Ids in the file that aren't on the tablet (skipped, not an error). */
  notFound: string[];
  /** Supplier names not in the Supplier list; added on import, as spelled in the file. */
  newSuppliers: string[];
  ignoredColumns: string[];
}

export type PriceRead = { ok: true; plan: PricePlan } | { ok: false; problems: PriceProblem[] };

const VENDOR_FIELD_SET = new Set<string>(VENDOR_FIELDS);
const INVENTORY_SET = new Set(INVENTORY_COLUMNS);

function sameVendor(a: Vendor, b: Vendor): boolean {
  return (
    a.supplier === b.supplier &&
    a.partNo === b.partNo &&
    a.url === b.url &&
    a.packSize === b.packSize &&
    a.packPriceCents === b.packPriceCents &&
    a.priceChecked === b.priceChecked
  );
}

const FIELD_LABELS: [keyof Vendor, PriceField][] = [
  ['supplier', 'supplier'],
  ['partNo', 'part #'],
  ['url', 'link'],
  ['packSize', 'pack size'],
  ['packPriceCents', 'pack price'],
  ['priceChecked', 'price checked'],
];

function shown(field: keyof Vendor, v: Vendor | null): string {
  if (!v) return '—';
  if (field === 'packPriceCents') return v.packPriceCents === null ? 'no price' : formatCents(v.packPriceCents);
  const s = String(v[field]);
  return s === '' ? 'blank' : s;
}

/** The fields that differ between an option before and after an update. */
export function fieldChanges(before: Vendor | null, after: Vendor): FieldChange[] {
  return FIELD_LABELS.filter(([k]) => !before || before[k] !== after[k]).map(([k, field]) => ({ field, before: shown(k, before), after: shown(k, after) }));
}

/** True for a change a price refresh shouldn't normally make. */
export const isDetailChange = (c: FieldChange): boolean => c.field !== 'pack price' && c.field !== 'price checked';

/** The vendor option after an update; null when a new slot lacks supplier or pack size. */
export function applySlot(current: Vendor | null, set: Partial<Vendor>): Vendor | null {
  if (current) return { ...current, ...set };
  if (set.supplier === undefined || set.packSize === undefined) return null;
  return { supplier: set.supplier, partNo: '', url: '', packSize: set.packSize, packPriceCents: null, priceChecked: '', ...set };
}

export function planPriceImport(text: string, fileName: string, current: { items: readonly Item[]; suppliers: readonly Supplier[] }): PriceRead {
  const file = fileName;
  const table = readCsv(text, file);
  const problems: PriceProblem[] = [...table.problems];

  // Columns.
  const ignoredColumns: string[] = [];
  const slotColumns = new Set<string>();
  table.headers.forEach((h) => {
    const key = h.trim().toLowerCase();
    if (key === '' || key === 'id') return;
    const m = /^v(\d+)_(.+)$/.exec(key);
    if (m && VENDOR_FIELD_SET.has(m[2]!)) {
      const n = Number(m[1]);
      // "v01_…" would be read as slot 1 but its cells looked up as "v1_…", so it's refused.
      if (n >= 1 && n <= 3 && m[1] === String(n)) slotColumns.add(key);
      else problems.push({ file, row: table.headerRow, message: `column “${h}” isn’t recognized — items have at most 3 vendor options (v1_, v2_, v3_)` });
    } else if (INVENTORY_SET.has(key)) ignoredColumns.push(h);
    else problems.push({ file, row: table.headerRow, message: `column “${h}” isn’t recognized — a price file can have id and v1_…v3_ supplier, part_no, url, pack_size, pack_price, price_checked` });
  });
  if (!table.columns.has('id')) problems.push({ file, row: table.headerRow, message: 'missing column: id' });
  if (problems.length > 0) return { ok: false, problems };
  if (slotColumns.size === 0) {
    return { ok: false, problems: [{ file, row: table.headerRow, message: 'the file has no vendor columns (v1_pack_price, v1_price_checked, …), so there is nothing to import' }] };
  }

  const byId = new Map(current.items.map((i) => [i.id, i]));
  const byKey = new Map(current.items.map((i) => [i.id.toLowerCase(), i]));
  const supplierByKey = new Map(current.suppliers.map((s) => [nameKey(s.name), s.name]));
  const newSuppliers = new Map<string, string>();
  const seen = new Map<string, number>();
  const items: ItemUpdate[] = [];
  const notFound: string[] = [];
  let optionsChanged = 0;
  let optionsAdded = 0;
  let optionsUnchanged = 0;
  const preview: ItemPreview[] = [];
  let detailChanges = 0;

  for (const { row, cells } of table.rows) {
    const get = cellGetter(table, cells);
    const id = get('id').trim();
    const err = (message: string) => problems.push({ file, row, message, ...(id ? { id } : {}) });
    if (id === '') {
      err('id is blank');
      continue;
    }
    const first = seen.get(id.toLowerCase());
    if (first !== undefined) {
      err(`id “${id}” is used again (first on row ${first})`);
      continue;
    }
    seen.set(id.toLowerCase(), row);
    const item = byId.get(id) ?? byKey.get(id.toLowerCase()) ?? null;

    const updates: SlotUpdate[] = [];
    const options: OptionPreview[] = [];
    let rowChanged = 0;
    let rowAdded = 0;
    let rowUnchanged = 0;
    for (const slot of VENDOR_SLOTS) {
      const col = (f: string) => `v${slot}_${f}`;
      const cell = (f: string) => (slotColumns.has(col(f)) ? get(col(f)).trim() : '');
      if (VENDOR_FIELDS.every((f) => cell(f) === '')) continue;
      const set: Partial<Vendor> = {};
      // A known supplier keeps the list's spelling ("rev" → "REV").
      const supplier = cell('supplier');
      if (supplier !== '') set.supplier = supplierByKey.get(nameKey(supplier)) ?? newSuppliers.get(nameKey(supplier)) ?? supplier;
      if (cell('part_no') !== '') set.partNo = cell('part_no');
      if (cell('url') !== '') {
        const u = normalizeUrl(cell('url'), col('url'));
        if (u.ok) set.url = u.url;
        else err(u.error);
      }
      if (cell('pack_size') !== '') {
        const r = parseWholeNumber(cell('pack_size'), col('pack_size'), 1);
        if (r.ok) set.packSize = r.value;
        else err(r.error);
      }
      if (cell('pack_price') !== '') {
        const r = parsePrice(cell('pack_price'));
        if (r.ok) set.packPriceCents = r.cents;
        else err(`${col('pack_price')}: ${r.error}`);
      }
      if (cell('price_checked') !== '') {
        const raw = cell('price_checked');
        const d = normalizeDate(raw);
        if (d !== null && isIsoDate(d)) set.priceChecked = d;
        else err(`${col('price_checked')} “${raw}” must be a date like 2026-10-17`);
      }
      if (!item) continue;
      const before = item.vendors[slot - 1] ?? null;
      const after = applySlot(before, set);
      if (!after) {
        err(`vendor option ${slot} is empty on the tablet; to add it, fill in ${col('supplier')} and ${col('pack_size')}`);
        continue;
      }
      if (before && sameVendor(before, after)) {
        rowUnchanged++;
        continue;
      }
      updates.push({ slot, set, adds: !before });
      const changes = fieldChanges(before, after);
      options.push({ slot, adds: !before, changes });
      detailChanges += before ? changes.filter(isDetailChange).length : 1;
      // Only a supplier that ends up on an item is added to the list.
      if (set.supplier !== undefined && !supplierByKey.has(nameKey(set.supplier))) newSuppliers.set(nameKey(set.supplier), set.supplier);
      if (before) rowChanged++;
      else rowAdded++;
    }
    if (!item) {
      notFound.push(id);
      continue;
    }
    optionsChanged += rowChanged;
    optionsAdded += rowAdded;
    optionsUnchanged += rowUnchanged;
    if (updates.length > 0) {
      items.push({ row, id: item.id, updates });
      preview.push({ id: item.id, name: item.name, options });
    }
  }

  if (problems.length > 0) return { ok: false, problems };
  return {
    ok: true,
    plan: {
      fileName,
      rowCount: table.rows.length,
      items,
      optionsChanged,
      optionsAdded,
      optionsUnchanged,
      preview,
      detailChanges,
      notFound,
      newSuppliers: [...newSuppliers.values()],
      ignoredColumns,
    },
  };
}
