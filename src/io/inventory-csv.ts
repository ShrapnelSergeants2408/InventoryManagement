// inventory.csv: one row per item (SPEC v2.0 §7; H2 replaces it with items.csv and the
// area, spot, bin and season files).
import type { Item } from '../domain/types';
import { parseWholeNumber, validateItem } from '../domain/validate';
import { cellGetter, readCsv, writeCsv, type FileProblem } from './csv';

export const INVENTORY_FILE = 'inventory.csv';

export const INVENTORY_COLUMNS: readonly string[] = ['id', 'name', 'category', 'subcategory', 'location', 'quantity', 'barcode', 'notes', 'photo_file'];

/** Columns a file must have; everything else defaults when missing (hand-edited files, §7). */
export const REQUIRED_INVENTORY_COLUMNS = ['id', 'name', 'category', 'quantity'] as const;

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
    problems.push({ file: INVENTORY_FILE, row: table.headerRow, message: `missing column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}` });
    return { items: [], photoFiles: new Map(), problems, ignoredColumns };
  }

  const items: Item[] = [];
  const photoFiles = new Map<string, string>();
  const seenIds = new Map<string, number>();

  for (const { row, cells } of table.rows) {
    const get = cellGetter(table, cells);
    const t = (h: string) => get(h).trim();
    const rowErrors: string[] = [];

    const id = t('id');
    if (id !== '') {
      const firstRow = seenIds.get(id.toLowerCase());
      if (firstRow !== undefined) rowErrors.push(`id "${id}" is used again (first on row ${firstRow})`);
      else seenIds.set(id.toLowerCase(), row);
    }

    let quantity = 0;
    const rawQty = t('quantity');
    if (rawQty === '') rowErrors.push('quantity is required');
    else {
      const q = parseWholeNumber(rawQty, 'quantity');
      if (q.ok) quantity = q.value;
      else rowErrors.push(q.error);
    }

    const barcode = t('barcode');
    if (EXCEL_SCIENTIFIC.test(barcode)) {
      rowErrors.push(`barcode "${barcode}" was turned into scientific notation by a spreadsheet; re-enter the full number`);
    }

    const photoFile = t('photo_file');
    const item: Item = {
      id,
      name: t('name'),
      category: t('category'),
      subcategory: t('subcategory'),
      location: t('location'),
      quantity,
      barcode,
      // Notes keep their inner line breaks and spacing; only outer whitespace is trimmed.
      notes: get('notes').trim(),
      hasPhoto: false,
    };

    if (rowErrors.length === 0) {
      for (const e of validateItem(item)) rowErrors.push(e.message);
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
    quantity: String(item.quantity),
    barcode: item.barcode,
    notes: item.notes,
    photo_file: item.hasPhoto ? photoPath(item.id) : '',
  };
  return INVENTORY_COLUMNS.map((c) => cells[c] ?? '');
}

export function serializeInventoryCsv(items: readonly Item[], photoPath: (id: string) => string = photoPathFor): string {
  return writeCsv(INVENTORY_COLUMNS, items.map((i) => inventoryRow(i, photoPath)));
}
