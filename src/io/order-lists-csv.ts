// order-lists.csv in full backups (SPEC §7, F27): one row per line, and a row with a blank
// item_id for an empty list. Read back by restore, so names and quantities are checked.
import { MAX_LIST_NAME, sortLists, type NamedOrderList } from '../domain/order-lists';
import { nameKey } from '../domain/types';
import { parseWholeNumber } from '../domain/validate';
import { cellGetter, readCsv, writeCsv, type FileProblem } from './csv';

export const ORDER_LISTS_FILE = 'order-lists.csv';
export const ORDER_LIST_COLUMNS = ['list_id', 'list_name', 'list_notes', 'item_id', 'quantity'] as const;

/** Lists A–Z, each list's lines in the order they were added. */
export function serializeOrderListsCsv(lists: readonly NamedOrderList[]): string {
  const rows: string[][] = [];
  for (const l of sortLists(lists)) {
    if (l.lines.length === 0) rows.push([l.id, l.name, l.notes, '', '']);
    for (const line of l.lines) rows.push([l.id, l.name, l.notes, line.itemId, String(line.quantity)]);
  }
  return writeCsv(ORDER_LIST_COLUMNS, rows);
}

/**
 * Lists in file order. Rows sharing a list_id are one list; its name and notes come from its
 * first row. `now` stamps created/updated, which the file doesn't carry.
 */
export function parseOrderListsCsv(text: string, now = Date.now()): { lists: NamedOrderList[]; problems: FileProblem[] } {
  const file = ORDER_LISTS_FILE;
  const table = readCsv(text, file);
  const problems = [...table.problems];
  const missing = ['list_id', 'list_name', 'item_id', 'quantity'].filter((c) => !table.columns.has(c));
  if (missing.length > 0) {
    problems.push({ file, row: table.headerRow, message: `missing column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}` });
    return { lists: [], problems };
  }
  const byId = new Map<string, { list: NamedOrderList; row: number; items: Map<string, number> }>();
  const byName = new Map<string, string>();
  for (const { row, cells } of table.rows) {
    const get = cellGetter(table, cells);
    const id = get('list_id').trim();
    const name = get('list_name').trim();
    if (id === '') {
      problems.push({ file, row, message: 'list_id is required' });
      continue;
    }
    let entry = byId.get(id);
    if (!entry) {
      if (name === '') {
        problems.push({ file, row, message: 'list_name is required' });
        continue;
      }
      if (name.length > MAX_LIST_NAME) {
        problems.push({ file, row, message: `list name "${name}" is longer than ${MAX_LIST_NAME} characters` });
        continue;
      }
      const other = byName.get(nameKey(name));
      if (other !== undefined) {
        problems.push({ file, row, message: `two lists are called "${name}" (list ids ${other} and ${id})` });
        continue;
      }
      byName.set(nameKey(name), id);
      entry = { list: { id, name, notes: get('list_notes').trim(), created: now, updated: now, lines: [] }, row, items: new Map() };
      byId.set(id, entry);
    }
    const itemId = get('item_id').trim();
    if (itemId === '') continue;
    const q = parseWholeNumber(get('quantity'), 'quantity', 1);
    if (!q.ok) {
      problems.push({ file, row, message: q.error });
      continue;
    }
    const first = entry.items.get(itemId);
    if (first !== undefined) {
      problems.push({ file, row, message: `item ${itemId} is on list "${entry.list.name}" twice (first on row ${first})` });
      continue;
    }
    entry.items.set(itemId, row);
    entry.list.lines.push({ itemId, quantity: q.value });
  }
  return { lists: [...byId.values()].map((e) => e.list), problems };
}
