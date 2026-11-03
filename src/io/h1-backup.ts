// Reading an H1 (0.1.1) full backup: inventory.csv and locations.csv, which H2 replaced with the
// §7 files. The data is converted the way an H1 phone is upgraded (SPEC "Upgrading an H1 phone").
import { convertH1, itemFromH1 } from '../domain/h1';
import { nameKey } from '../domain/types';
import { parseWholeNumber } from '../domain/validate';
import { cellGetter, readCsv, type FileProblem } from './csv';
import { requireColumns, type Parsed } from './lists-csv';

export const H1_INVENTORY_FILE = 'inventory.csv';
export const H1_LOCATIONS_FILE = 'locations.csv';

export const H1_INVENTORY_COLUMNS: readonly string[] = ['id', 'name', 'category', 'subcategory', 'location', 'quantity', 'barcode', 'notes', 'photo_file'];

/** Columns a file must have; everything else defaults when missing (hand-edited files). */
export const H1_REQUIRED_COLUMNS = ['id', 'name', 'category', 'quantity'] as const;

export interface H1Row {
  id: string;
  name: string;
  category: string;
  subcategory: string;
  location: string;
  quantity: number;
  barcode: string;
  notes: string;
  /** Path of its photo inside the ZIP, or ''. */
  photoFile: string;
}

export interface H1Location {
  name: string;
  notes: string;
  order: number;
}

const EXCEL_SCIENTIFIC = /^\d(\.\d+)?e\+\d+$/i;

export function parseH1Inventory(text: string): { rows: H1Row[]; problems: FileProblem[]; ignoredColumns: string[] } {
  const file = H1_INVENTORY_FILE;
  const table = readCsv(text, file);
  const problems = [...table.problems];
  const known = new Set(H1_INVENTORY_COLUMNS);
  const ignoredColumns = table.headers.filter((h) => h !== '' && !known.has(h.trim().toLowerCase()));
  const missing = H1_REQUIRED_COLUMNS.filter((c) => !table.columns.has(c));
  if (missing.length > 0) {
    problems.push({ file, row: table.headerRow, message: `missing column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}` });
    return { rows: [], problems, ignoredColumns };
  }
  const rows: H1Row[] = [];
  const seen = new Map<string, number>();
  for (const { row, cells } of table.rows) {
    const get = cellGetter(table, cells);
    const t = (h: string) => get(h).trim();
    const errors: string[] = [];
    const id = t('id');
    if (id === '') errors.push('id is required');
    else {
      const first = seen.get(id.toLowerCase());
      if (first !== undefined) errors.push(`id "${id}" is used again (first on row ${first})`);
      else seen.set(id.toLowerCase(), row);
    }
    if (t('name') === '') errors.push('name is required');
    if (t('category') === '') errors.push('category is required');
    let quantity = 0;
    if (t('quantity') === '') errors.push('quantity is required');
    else {
      const q = parseWholeNumber(t('quantity'), 'quantity');
      if (q.ok) quantity = q.value;
      else errors.push(q.error);
    }
    const barcode = t('barcode');
    if (EXCEL_SCIENTIFIC.test(barcode)) errors.push(`barcode "${barcode}" was turned into scientific notation by a spreadsheet; re-enter the full number`);
    if (errors.length) {
      for (const message of errors) problems.push({ file, row, message });
      continue;
    }
    rows.push({ id, name: t('name'), category: t('category'), subcategory: t('subcategory'), location: t('location'), quantity, barcode, notes: get('notes').trim(), photoFile: t('photo_file') });
  }
  return { rows, problems, ignoredColumns };
}

export function parseH1Locations(text: string): Parsed<H1Location> {
  const file = H1_LOCATIONS_FILE;
  const table = readCsv(text, file);
  const problems = [...table.problems];
  if (!requireColumns(file, table, ['name'], problems)) return { list: [], problems };
  const withOrder: { loc: H1Location; sortKey: number; pos: number }[] = [];
  const seen = new Map<string, number>();
  table.rows.forEach(({ row, cells }, pos) => {
    const get = cellGetter(table, cells);
    const name = get('name').trim();
    if (name === '') return void problems.push({ file, row, message: 'location name is required' });
    const first = seen.get(nameKey(name));
    if (first !== undefined) return void problems.push({ file, row, message: `location "${name}" is listed twice (first on row ${first})` });
    seen.set(nameKey(name), row);
    let sortKey = Number.MAX_SAFE_INTEGER;
    const orderRaw = get('order').trim();
    if (orderRaw !== '') {
      const r = parseWholeNumber(orderRaw, 'order');
      if (!r.ok) return void problems.push({ file, row, message: r.error });
      sortKey = r.value;
    }
    withOrder.push({ loc: { name, notes: get('notes').trim(), order: 0 }, sortKey, pos });
  });
  withOrder.sort((a, b) => a.sortKey - b.sortKey || a.pos - b.pos);
  return { list: withOrder.map((w, i) => ({ ...w.loc, order: i })), problems };
}

/**
 * Converts H1 rows and locations to the household model: locations (and any only items name)
 * become spots in "Unsorted", items keep them as their spot, the default seasons are added.
 */
export function convertH1Backup(rows: readonly H1Row[], locations: readonly H1Location[]) {
  const all = [...locations].sort((a, b) => a.order - b.order);
  const listed = new Set(all.map((l) => nameKey(l.name)));
  for (const r of rows) {
    if (r.location !== '' && !listed.has(nameKey(r.location))) {
      listed.add(nameKey(r.location));
      all.push({ name: r.location, notes: '', order: all.length });
    }
  }
  const c = convertH1(all.map((l, order) => ({ ...l, order })));
  const items = rows.map((r) => itemFromH1({ ...r, hasPhoto: false }, c.spotIdFor(r.location)));
  return { areas: c.area ? [c.area] : [], spots: c.spots, seasons: c.seasons, items };
}
