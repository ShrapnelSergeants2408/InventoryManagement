// suppliers.csv, locations.csv (SPEC §7) and categories.csv (spec-questions Q3).
import { compareSupplierNames } from '../domain/order';
import { OTHER_SUPPLIER, nameKey, type Category, type Item, type Location, type Supplier } from '../domain/types';
import { parseWholeNumber } from '../domain/validate';
import { cellGetter, readCsv, writeCsv, type FileProblem } from './csv';

export const SUPPLIERS_FILE = 'suppliers.csv';
export const LOCATIONS_FILE = 'locations.csv';
export const CATEGORIES_FILE = 'categories.csv';

export const SUPPLIER_COLUMNS = ['name', 'website', 'notes'] as const;
export const LOCATION_COLUMNS = ['name', 'notes', 'order'] as const;
export const CATEGORY_COLUMNS = ['category', 'subcategory', 'order'] as const;

interface Parsed<T> {
  list: T[];
  problems: FileProblem[];
}

function requireColumns(file: string, columns: Map<string, number>, need: readonly string[], problems: FileProblem[]): boolean {
  const missing = need.filter((c) => !columns.has(c));
  if (missing.length === 0) return true;
  problems.push({ file, row: 1, message: `missing column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}` });
  return false;
}

export function parseSuppliersCsv(text: string): Parsed<Supplier> {
  const table = readCsv(text, SUPPLIERS_FILE);
  const problems = [...table.problems];
  if (!requireColumns(SUPPLIERS_FILE, table.columns, ['name'], problems)) return { list: [], problems };
  const list: Supplier[] = [];
  const seen = new Map<string, number>();
  for (const { row, cells } of table.rows) {
    const get = cellGetter(table, cells);
    const name = get('name').trim();
    if (name === '') {
      problems.push({ file: SUPPLIERS_FILE, row, message: 'supplier name is required' });
      continue;
    }
    const first = seen.get(nameKey(name));
    if (first !== undefined) {
      problems.push({ file: SUPPLIERS_FILE, row, message: `supplier "${name}" is listed twice (first on row ${first})` });
      continue;
    }
    seen.set(nameKey(name), row);
    list.push({ name, website: get('website').trim(), notes: get('notes').trim() });
  }
  return { list, problems };
}

export function serializeSuppliersCsv(suppliers: readonly Supplier[]): string {
  const sorted = [...suppliers].sort((a, b) => compareSupplierNames(a.name, b.name));
  return writeCsv(SUPPLIER_COLUMNS, sorted.map((s) => [s.name, s.website, s.notes]));
}

export function parseLocationsCsv(text: string): Parsed<Location> {
  const table = readCsv(text, LOCATIONS_FILE);
  const problems = [...table.problems];
  if (!requireColumns(LOCATIONS_FILE, table.columns, ['name'], problems)) return { list: [], problems };
  const withOrder: { loc: Location; sortKey: number; pos: number }[] = [];
  const seen = new Map<string, number>();
  table.rows.forEach(({ row, cells }, pos) => {
    const get = cellGetter(table, cells);
    const name = get('name').trim();
    if (name === '') {
      problems.push({ file: LOCATIONS_FILE, row, message: 'location name is required' });
      return;
    }
    const first = seen.get(nameKey(name));
    if (first !== undefined) {
      problems.push({ file: LOCATIONS_FILE, row, message: `location "${name}" is listed twice (first on row ${first})` });
      return;
    }
    seen.set(nameKey(name), row);
    let sortKey = Number.MAX_SAFE_INTEGER;
    const orderRaw = get('order').trim();
    if (orderRaw !== '') {
      const r = parseWholeNumber(orderRaw, 'order');
      if (!r.ok) {
        problems.push({ file: LOCATIONS_FILE, row, message: r.error });
        return;
      }
      sortKey = r.value;
    }
    withOrder.push({ loc: { name, notes: get('notes').trim(), order: 0 }, sortKey, pos });
  });
  withOrder.sort((a, b) => a.sortKey - b.sortKey || a.pos - b.pos);
  return { list: withOrder.map((w, i) => ({ ...w.loc, order: i })), problems };
}

export function serializeLocationsCsv(locations: readonly Location[]): string {
  const sorted = [...locations].sort((a, b) => a.order - b.order);
  return writeCsv(LOCATION_COLUMNS, sorted.map((l, i) => [l.name, l.notes, String(i)]));
}

/**
 * One row per (category, subcategory) in order; an empty category or one with no
 * subcategories gets a single row with a blank subcategory. `order` is the category's position.
 */
export function parseCategoriesCsv(text: string): Parsed<Category> {
  const table = readCsv(text, CATEGORIES_FILE);
  const problems = [...table.problems];
  if (!requireColumns(CATEGORIES_FILE, table.columns, ['category'], problems)) return { list: [], problems };
  const byKey = new Map<string, { cat: Category; sortKey: number; pos: number }>();
  table.rows.forEach(({ row, cells }, pos) => {
    const get = cellGetter(table, cells);
    const name = get('category').trim();
    const sub = get('subcategory').trim();
    if (name === '') {
      problems.push({ file: CATEGORIES_FILE, row, message: 'category name is required' });
      return;
    }
    let sortKey = Number.MAX_SAFE_INTEGER;
    const orderRaw = get('order').trim();
    if (orderRaw !== '') {
      const r = parseWholeNumber(orderRaw, 'order');
      if (!r.ok) {
        problems.push({ file: CATEGORIES_FILE, row, message: r.error });
        return;
      }
      sortKey = r.value;
    }
    let entry = byKey.get(nameKey(name));
    if (!entry) {
      entry = { cat: { name, order: 0, subcategories: [] }, sortKey, pos };
      byKey.set(nameKey(name), entry);
    }
    if (sub !== '' && !entry.cat.subcategories.some((s) => nameKey(s) === nameKey(sub))) entry.cat.subcategories.push(sub);
  });
  const list = [...byKey.values()].sort((a, b) => a.sortKey - b.sortKey || a.pos - b.pos).map((e, i) => ({ ...e.cat, order: i }));
  return { list, problems };
}

export function serializeCategoriesCsv(categories: readonly Category[]): string {
  const rows: string[][] = [];
  [...categories]
    .sort((a, b) => a.order - b.order)
    .forEach((c, i) => {
      if (c.subcategories.length === 0) rows.push([c.name, '', String(i)]);
      else for (const s of c.subcategories) rows.push([c.name, s, String(i)]);
    });
  return writeCsv(CATEGORY_COLUMNS, rows);
}

// ── Rebuilding lists from item data (CSV-only restores and the seed, §7) ──

/** Appends supplier names used by vendor options that aren't in the list; ensures `other` exists. */
export function completeSuppliers(list: readonly Supplier[], items: readonly Item[]): { list: Supplier[]; added: string[] } {
  const out = [...list];
  const keys = new Set(out.map((s) => nameKey(s.name)));
  const added: string[] = [];
  const add = (name: string) => {
    if (name === '' || keys.has(nameKey(name))) return;
    keys.add(nameKey(name));
    out.push({ name, website: '', notes: '' });
    added.push(name);
  };
  for (const item of items) for (const v of item.vendors) if (v) add(v.supplier);
  if (!keys.has(OTHER_SUPPLIER)) {
    keys.add(OTHER_SUPPLIER);
    out.push({ name: OTHER_SUPPLIER, website: '', notes: '' });
  }
  return { list: out, added };
}

/** Appends location names used by items to the end of the walk order (§7). */
export function completeLocations(list: readonly Location[], items: readonly Item[]): { list: Location[]; added: string[] } {
  const out = [...list].sort((a, b) => a.order - b.order).map((l, i) => ({ ...l, order: i }));
  const keys = new Set(out.map((l) => nameKey(l.name)));
  const added: string[] = [];
  for (const item of items) {
    const name = item.location;
    if (name === '' || keys.has(nameKey(name))) continue;
    keys.add(nameKey(name));
    out.push({ name, notes: '', order: out.length });
    added.push(name);
  }
  return { list: out, added };
}

/** Appends categories and subcategories used by items, in first-appearance order. */
export function completeCategories(list: readonly Category[], items: readonly Item[]): { list: Category[]; added: string[] } {
  const out = [...list].sort((a, b) => a.order - b.order).map((c, i) => ({ ...c, order: i, subcategories: [...c.subcategories] }));
  const byKey = new Map(out.map((c) => [nameKey(c.name), c]));
  const added: string[] = [];
  for (const item of items) {
    let cat = byKey.get(nameKey(item.category));
    if (!cat) {
      cat = { name: item.category, order: out.length, subcategories: [] };
      out.push(cat);
      byKey.set(nameKey(item.category), cat);
      added.push(item.category);
    }
    const sub = item.subcategory;
    if (sub !== '' && !cat.subcategories.some((s) => nameKey(s) === nameKey(sub))) {
      cat.subcategories.push(sub);
      added.push(`${cat.name} › ${sub}`);
    }
  }
  return { list: out, added };
}
