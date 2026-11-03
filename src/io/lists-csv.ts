// categories.csv (SPEC v3.0 §7): each part's categories and subcategories. A 0.1.2 file has no
// `part` column; its rows are read as Household.
import { PARTS, nameKey, type Category, type Item, type Part } from '../domain/types';
import { parseWholeNumber } from '../domain/validate';
import { cellGetter, readCsv, writeCsv, type CsvTable, type FileProblem } from './csv';

export const CATEGORIES_FILE = 'categories.csv';

export const CATEGORY_COLUMNS = ['part', 'category', 'subcategory', 'order'] as const;

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

const catKey = (part: Part, name: string) => `${part}\n${nameKey(name)}`;

/**
 * One row per (part, category, subcategory) in order; an empty category or one with no
 * subcategories gets a single row with a blank subcategory. `order` is the category's position
 * within its part.
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
    const partRaw = get('part').trim().toLowerCase();
    if (name === '') {
      problems.push({ file: CATEGORIES_FILE, row, message: 'category name is required' });
      return;
    }
    const part = partRaw === '' ? 'household' : PARTS.find((p) => p === partRaw);
    if (!part) {
      problems.push({ file: CATEGORIES_FILE, row, message: `part "${partRaw}" must be household or holiday` });
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
    let entry = byKey.get(catKey(part, name));
    if (!entry) {
      entry = { cat: { part, name, order: 0, subcategories: [] }, sortKey, pos };
      byKey.set(catKey(part, name), entry);
    }
    if (sub !== '' && !entry.cat.subcategories.some((s) => nameKey(s) === nameKey(sub))) entry.cat.subcategories.push(sub);
  });
  const sorted = [...byKey.values()].sort((a, b) => a.sortKey - b.sortKey || a.pos - b.pos);
  const list = PARTS.flatMap((p) => sorted.filter((e) => e.cat.part === p).map((e, i) => ({ ...e.cat, order: i })));
  return { list, problems };
}

export function serializeCategoriesCsv(categories: readonly Category[]): string {
  const rows: string[][] = [];
  for (const part of PARTS) {
    categories
      .filter((c) => c.part === part)
      .sort((a, b) => a.order - b.order)
      .forEach((c, i) => {
        if (c.subcategories.length === 0) rows.push([part, c.name, '', String(i)]);
        else for (const s of c.subcategories) rows.push([part, c.name, s, String(i)]);
      });
  }
  return writeCsv(CATEGORY_COLUMNS, rows);
}

// ── Rebuilding lists from item data (restores, §7) ──

type Categorized = Pick<Item, 'part' | 'category' | 'subcategory'>;

/**
 * Spells each item's category and subcategory the way its part's list does. Names match ignoring
 * capitals (§3), so a hand-edited `lights` becomes `Lights`. Run after completeCategories, so
 * every name the items use is in the list.
 */
export function spellLikeLists<T extends Categorized>(items: readonly T[], categories: readonly Category[]): T[] {
  const cats = new Map(categories.map((c) => [catKey(c.part, c.name), c]));
  return items.map((item) => {
    const cat = cats.get(catKey(item.part, item.category));
    const category = cat?.name ?? item.category;
    const subcategory = (item.subcategory !== '' && cat?.subcategories.find((s) => nameKey(s) === nameKey(item.subcategory))) || item.subcategory;
    return category === item.category && subcategory === item.subcategory ? item : { ...item, category, subcategory };
  });
}

/** Appends categories and subcategories used by items to their part's list, in first-appearance order. */
export function completeCategories(list: readonly Category[], items: readonly Categorized[]): { list: Category[]; added: string[] } {
  const out = PARTS.flatMap((p) =>
    list
      .filter((c) => c.part === p)
      .sort((a, b) => a.order - b.order)
      .map((c, i) => ({ ...c, order: i, subcategories: [...c.subcategories] })),
  );
  const byKey = new Map(out.map((c) => [catKey(c.part, c.name), c]));
  const added: string[] = [];
  for (const item of items) {
    let cat = byKey.get(catKey(item.part, item.category));
    if (!cat) {
      cat = { part: item.part, name: item.category, order: out.filter((c) => c.part === item.part).length, subcategories: [] };
      out.push(cat);
      byKey.set(catKey(item.part, item.category), cat);
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
