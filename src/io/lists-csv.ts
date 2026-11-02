// categories.csv (SPEC v2.0 §7), shared by H1 and H2 backups.
import { nameKey, type Category, type Item } from '../domain/types';
import { parseWholeNumber } from '../domain/validate';
import { cellGetter, readCsv, writeCsv, type CsvTable, type FileProblem } from './csv';

export const CATEGORIES_FILE = 'categories.csv';

export const CATEGORY_COLUMNS = ['category', 'subcategory', 'order'] as const;

export interface Parsed<T> {
  list: T[];
  problems: FileProblem[];
}

export function requireColumns(file: string, table: CsvTable, need: readonly string[], problems: FileProblem[]): boolean {
  const missing = need.filter((c) => !table.columns.has(c));
  if (missing.length === 0) return true;
  problems.push({ file, row: table.headerRow, message: `missing column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}` });
  return false;
}

/**
 * One row per (category, subcategory) in order; an empty category or one with no
 * subcategories gets a single row with a blank subcategory. `order` is the category's position.
 */
export function parseCategoriesCsv(text: string): Parsed<Category> {
  const table = readCsv(text, CATEGORIES_FILE);
  const problems = [...table.problems];
  if (!requireColumns(CATEGORIES_FILE, table, ['category'], problems)) return { list: [], problems };
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

// ── Rebuilding lists from item data (CSV-only restores, §7) ──

/**
 * Spells each item's category and subcategory the way the list does. Names match ignoring
 * capitals (§3), so a hand-edited `lights` becomes `Lights`. Run after completeCategories, so
 * every name the items use is in the list.
 */
export function spellLikeLists<T extends Pick<Item, 'category' | 'subcategory'>>(items: readonly T[], categories: readonly Category[]): T[] {
  const cats = new Map(categories.map((c) => [nameKey(c.name), c]));
  return items.map((item) => {
    const cat = cats.get(nameKey(item.category));
    const category = cat?.name ?? item.category;
    const subcategory = (item.subcategory !== '' && cat?.subcategories.find((s) => nameKey(s) === nameKey(item.subcategory))) || item.subcategory;
    return category === item.category && subcategory === item.subcategory ? item : { ...item, category, subcategory };
  });
}

/** Appends categories and subcategories used by items, in first-appearance order. */
export function completeCategories(list: readonly Category[], items: readonly Pick<Item, 'category' | 'subcategory'>[]): { list: Category[]; added: string[] } {
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
