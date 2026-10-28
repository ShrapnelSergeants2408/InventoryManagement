// Pending items as rows (SPEC §18.4 new-items.csv in a counts file; §7 pending-items.csv in a
// full backup, the same columns plus helper_name). Read back with every field checked.
import { NEW_ITEMS_COLUMNS, type PendingItem, type PendingRecord } from "../domain/helper-mode";
import { centsToPlain, parsePrice } from '../domain/money';
import { readCountStamp } from '../domain/dates';
import { parseWholeNumber } from '../domain/validate';
import { cellGetter, readCsv, writeCsv, type FileProblem } from './csv';

export const PENDING_ITEMS_FILE = 'pending-items.csv';
export const PENDING_COLUMNS = [...NEW_ITEMS_COLUMNS, 'helper_name'] as const;

const missingColumns = (have: Map<string, number>, want: readonly string[]) => want.filter((x) => !have.has(x));

export function newItemRow(p: PendingRecord | PendingItem, photoFile: string): string[] {
  const v = p.vendor;
  return [
    p.id,
    p.name,
    p.category,
    p.subcategory,
    p.unit,
    String(p.onHand),
    String(p.desired),
    p.location,
    p.barcode,
    p.notes,
    photoFile,
    p.countedAt,
    v?.supplier ?? '',
    v?.partNo ?? '',
    v?.url ?? '',
    v ? String(v.packSize) : '',
    v && v.packPriceCents !== null ? centsToPlain(v.packPriceCents) : '',
  ];
}

/** The helper id inside a pending id, `pending-<helper id>-<n>` (§18.3); '' if it isn't one. */
export function helperIdOf(pendingId: string): string {
  const m = /^pending-(.+)-\d+$/.exec(pendingId);
  return m ? m[1]! : '';
}

/**
 * new-items.csv (a counts file) or pending-items.csv (a backup, with helper_name). `helper`
 * supplies the name and id for a counts file, where every row is from one helper.
 */
export function parsePendingCsv(text: string, file: string, helper: { id: string; name: string } | null): { items: PendingRecord[]; photoFiles: Map<string, string>; problems: FileProblem[] } {
  const table = readCsv(text, file);
  const problems = [...table.problems];
  const required = ['pending_id', 'name', 'category', 'unit', 'on_hand', ...(helper ? [] : ['helper_name'])];
  const missing = missingColumns(table.columns, required);
  if (missing.length > 0) {
    problems.push({ file, row: 1, message: `missing column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}` });
    return { items: [], photoFiles: new Map(), problems };
  }
  const items: PendingRecord[] = [];
  const photoFiles = new Map<string, string>();
  const ids = new Set<string>();
  for (const { row, cells } of table.rows) {
    const get = (h: string) => cellGetter(table, cells)(h).trim();
    const bad = (message: string) => problems.push({ file, row, message });
    const id = get('pending_id');
    if (id === '') bad('pending_id is blank');
    else if (ids.has(id)) bad(`pending_id ${id} appears more than once`);
    ids.add(id);
    for (const f of ['name', 'category', 'unit'] as const) if (get(f) === '') bad(`${f} is blank`);
    const onHand = parseWholeNumber(get('on_hand'), 'on_hand');
    if (!onHand.ok) bad(onHand.error);
    const desired = get('desired') === '' ? { ok: true as const, value: 0 } : parseWholeNumber(get('desired'), 'desired');
    if (!desired.ok) bad(desired.error);
    const countedAt = readCountStamp(get('counted_at'));
    if (countedAt === null || countedAt === '') bad(`counted_at "${get('counted_at')}" must be a date and time like 2026-10-24T18:42-05:00`);
    let vendor: PendingRecord['vendor'] = null;
    if (get('v1_supplier') !== '') {
      const ps = get('v1_pack_size') === '' ? { ok: true as const, value: 1 } : parseWholeNumber(get('v1_pack_size'), 'v1_pack_size', 1);
      if (!ps.ok) bad(ps.error);
      const price = parsePrice(get('v1_pack_price'));
      if (!price.ok) bad(`v1_pack_price: ${price.error}`);
      if (ps.ok && price.ok) vendor = { supplier: get('v1_supplier'), partNo: get('v1_part_no'), url: get('v1_url'), packSize: ps.value, packPriceCents: price.cents };
    }
    const helperName = helper ? helper.name : get('helper_name');
    if (!helper && helperName === '') bad('helper_name is blank');
    if (get('photo_file') !== '') photoFiles.set(id, get('photo_file'));
    if (onHand.ok && desired.ok && countedAt)
      items.push({
        id,
        name: get('name'),
        category: get('category'),
        subcategory: get('subcategory'),
        unit: get('unit'),
        onHand: onHand.value,
        desired: desired.value,
        location: get('location'),
        barcode: get('barcode'),
        // Notes keep their own line breaks; only the ends are trimmed.
        notes: cellGetter(table, cells)('notes').trim(),
        countedAt,
        vendor,
        hasPhoto: false,
        helperId: helper ? helper.id : helperIdOf(id),
        helperName,
      });
  }
  return { items, photoFiles, problems };
}

export function serializePendingCsv(pending: readonly PendingRecord[], photoPath: (p: PendingRecord) => string): string {
  const sorted = [...pending].sort((a, b) => a.id.localeCompare(b.id, 'en-US', { numeric: true }));
  return writeCsv(PENDING_COLUMNS, sorted.map((p) => [...newItemRow(p, photoPath(p)), p.helperName]));
}

