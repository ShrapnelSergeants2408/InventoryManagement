// The record files of a full backup (SPEC v2.0 §7): areas, spots, bins, items, seasons, tags
// and files (photo records). Columns are matched by header name; tags are separated by ";",
// money is dollars with 2 decimals, dates and times are ISO.
import { centsToPlain, parsePrice } from '../domain/money';
import { BIN_STATES, CONDITIONS, ITEM_STATUSES, SEASON_COLORS, type Area, type Bin, type Item, type PhotoInfo, type Season, type Spot, type Tag } from '../domain/types';
import { isIsoDate, parseWholeNumber } from '../domain/validate';
import { cellGetter, readCsv, writeCsv, type CsvTable, type FileProblem } from './csv';

export const AREAS_FILE = 'areas.csv';
export const SPOTS_FILE = 'spots.csv';
export const BINS_FILE = 'bins.csv';
export const ITEMS_FILE = 'items.csv';
export const SEASONS_FILE = 'seasons.csv';
export const TAGS_FILE = 'tags.csv';
export const FILES_FILE = 'files.csv';

export const AREA_COLUMNS = ['id', 'name', 'letter', 'order', 'notes'] as const;
export const SPOT_COLUMNS = ['id', 'area_id', 'name', 'order', 'notes'] as const;
export const BIN_COLUMNS = ['id', 'code', 'name', 'spot_id', 'season_id', 'tags', 'state', 'notes', 'label_printed_at', 'label_contents'] as const;
export const ITEM_COLUMNS = [
  'id', 'name', 'category', 'subcategory', 'bin_id', 'spot_id', 'quantity', 'approx', 'season_id', 'tags', 'status', 'out_where', 'out_since',
  'lent_to', 'lent_on', 'condition', 'condition_note', 'barcode', 'notes', 'value', 'purchase_date', 'model', 'serial', 'warranty_until', 'keep_at_least',
] as const;
export const SEASON_COLUMNS = ['id', 'name', 'order', 'color', 'setup_notes'] as const;
export const TAG_COLUMNS = ['name', 'order'] as const;
export const FILE_COLUMNS = ['id', 'owner_type', 'owner_id', 'kind', 'caption', 'order', 'path'] as const;

// ── Writing ──

export const tagsCell = (tags: readonly string[]) => tags.join('; ');
const timeCell = (ms: number | null) => (ms === null ? '' : new Date(ms).toISOString());
const yes = (b: boolean) => (b ? 'yes' : '');
const numCell = (n: number | null) => (n === null ? '' : String(n));

const sortByOrder = <T extends { order: number }>(list: readonly T[]) => [...list].sort((a, b) => a.order - b.order);

export const serializeAreas = (list: readonly Area[]) =>
  writeCsv(AREA_COLUMNS, sortByOrder(list).map((a, i) => [a.id, a.name, a.letter, String(i), a.notes]));

/** Spots in their area's walk order; `order` is the position within the area. */
export const serializeSpots = (list: readonly Spot[]) =>
  writeCsv(SPOT_COLUMNS, sortByOrder(list).map((s) => [s.id, s.areaId, s.name, String(s.order), s.notes]));

export const serializeBins = (list: readonly Bin[]) =>
  writeCsv(
    BIN_COLUMNS,
    [...list].sort((a, b) => a.code.localeCompare(b.code, 'en-US', { numeric: true })).map((b) => [b.id, b.code, b.name, b.spotId, b.seasonId, tagsCell(b.tags), b.state, b.notes, timeCell(b.labelPrintedAt), b.labelContents ?? '']),
  );

export function itemCells(i: Item): string[] {
  const cells: Record<(typeof ITEM_COLUMNS)[number], string> = {
    id: i.id,
    name: i.name,
    category: i.category,
    subcategory: i.subcategory,
    bin_id: i.binId,
    spot_id: i.spotId,
    quantity: String(i.quantity),
    approx: yes(i.approx),
    season_id: i.seasonId,
    tags: tagsCell(i.tags),
    status: i.status,
    out_where: i.outWhere,
    out_since: timeCell(i.outSince),
    lent_to: i.lentTo,
    lent_on: i.lentOn,
    condition: i.condition,
    condition_note: i.conditionNote,
    barcode: i.barcode,
    notes: i.notes,
    value: i.value === null ? '' : centsToPlain(i.value),
    purchase_date: i.purchaseDate,
    model: i.model,
    serial: i.serial,
    warranty_until: i.warrantyUntil,
    keep_at_least: numCell(i.keepAtLeast),
  };
  return ITEM_COLUMNS.map((c) => cells[c]);
}

export const serializeItems = (list: readonly Item[]) => writeCsv(ITEM_COLUMNS, list.map(itemCells));

export const serializeSeasons = (list: readonly Season[]) =>
  writeCsv(SEASON_COLUMNS, sortByOrder(list).map((s, i) => [s.id, s.name, String(i), s.color, s.setupNotes]));

export const serializeTags = (list: readonly Tag[]) => writeCsv(TAG_COLUMNS, sortByOrder(list).map((t, i) => [t.name, String(i)]));

/** Photo path inside a full backup ZIP; the extension follows the image type. */
export function photoPathFor(id: string, type = 'image/jpeg'): string {
  const ext = type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg';
  return `photos/${id}.${ext}`;
}

export const serializeFiles = (list: readonly PhotoInfo[], path: (p: PhotoInfo) => string) =>
  writeCsv(FILE_COLUMNS, list.map((p) => [p.id, p.ownerType, p.ownerId, p.kind, p.caption, String(p.order), path(p)]));

// ── Reading ──

export interface Parsed<T> {
  list: T[];
  problems: FileProblem[];
  ignoredColumns: string[];
}

/** One row's cells by header, collecting this row's problems. */
class Row {
  readonly errors: string[] = [];
  private readonly get: (h: string) => string;
  constructor(table: CsvTable, cells: string[]) {
    this.get = cellGetter(table, cells);
  }
  text(col: string): string {
    return this.get(col).trim();
  }
  /** Notes keep their inner line breaks and spacing; only outer whitespace is trimmed. */
  long(col: string): string {
    return this.get(col).trim();
  }
  required(col: string, label: string): string {
    const v = this.text(col);
    if (v === '') this.errors.push(`${label} is required`);
    return v;
  }
  whole(col: string, label: string, fallback: number | null): number | null {
    const raw = this.text(col);
    if (raw === '') return fallback;
    const r = parseWholeNumber(raw, label);
    if (r.ok) return r.value;
    this.errors.push(r.error);
    return fallback;
  }
  bool(col: string): boolean {
    const v = this.text(col).toLowerCase();
    if (v === '' || v === 'no' || v === 'false' || v === '0') return false;
    if (v === 'yes' || v === 'true' || v === '1' || v === 'y') return true;
    this.errors.push(`${col} "${this.text(col)}" must be yes or blank`);
    return false;
  }
  oneOf<T extends string>(col: string, allowed: readonly T[], fallback: T): T {
    const v = this.text(col).toLowerCase();
    if (v === '') return fallback;
    const hit = allowed.find((a) => a === v);
    if (hit) return hit;
    this.errors.push(`${col} "${this.text(col)}" must be one of: ${allowed.join(', ')}`);
    return fallback;
  }
  date(col: string, label: string): string {
    const v = this.text(col);
    if (v !== '' && !isIsoDate(v)) this.errors.push(`${label} "${v}" isn't a date (YYYY-MM-DD)`);
    return v;
  }
  time(col: string, label: string): number | null {
    const v = this.text(col);
    if (v === '') return null;
    const ms = Date.parse(v);
    if (Number.isNaN(ms)) {
      this.errors.push(`${label} "${v}" isn't a date and time`);
      return null;
    }
    return ms;
  }
  money(col: string): number | null {
    const r = parsePrice(this.text(col));
    if (r.ok) return r.cents;
    this.errors.push(r.error.replace(/^price/, 'value'));
    return null;
  }
  tags(col: string): string[] {
    const out: string[] = [];
    for (const t of this.text(col).split(';').map((x) => x.trim())) if (t !== '' && !out.some((o) => o.toLowerCase() === t.toLowerCase())) out.push(t);
    return out;
  }
}

function readTable<T>(text: string, file: string, columns: readonly string[], required: readonly string[], build: (r: Row) => T): Parsed<T> {
  const table = readCsv(text, file);
  const problems = [...table.problems];
  const known = new Set(columns);
  const ignoredColumns = table.headers.filter((h) => h !== '' && !known.has(h.trim().toLowerCase()));
  const missing = required.filter((c) => !table.columns.has(c));
  if (missing.length > 0) {
    problems.push({ file, row: table.headerRow, message: `missing column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}` });
    return { list: [], problems, ignoredColumns };
  }
  const list: T[] = [];
  for (const { row, cells } of table.rows) {
    const r = new Row(table, cells);
    const value = build(r);
    if (r.errors.length) for (const message of r.errors) problems.push({ file, row, message });
    else list.push(value);
  }
  return { list, problems, ignoredColumns };
}

/** Lists come back in file order when `order` is blank, else by `order` (ties keep file order). */
function byOrderThenFile<T extends { order: number }>(list: T[]): T[] {
  return list.map((x, pos) => ({ x, pos })).sort((a, b) => a.x.order - b.x.order || a.pos - b.pos).map(({ x }) => x);
}

const BLANK_ORDER = Number.MAX_SAFE_INTEGER;

export function parseAreas(text: string): Parsed<Area> {
  const p = readTable(text, AREAS_FILE, AREA_COLUMNS, ['id', 'name', 'letter'], (r) => ({
    id: r.required('id', 'id'),
    name: r.required('name', 'area name'),
    letter: r.required('letter', 'area letter').toUpperCase(),
    order: r.whole('order', 'order', BLANK_ORDER)!,
    notes: r.long('notes'),
  }));
  return { ...p, list: byOrderThenFile(p.list).map((a, order) => ({ ...a, order })) };
}

export function parseSpots(text: string): Parsed<Spot> {
  const p = readTable(text, SPOTS_FILE, SPOT_COLUMNS, ['id', 'area_id', 'name'], (r) => ({
    id: r.required('id', 'id'),
    areaId: r.required('area_id', 'area_id'),
    name: r.required('name', 'spot name'),
    order: r.whole('order', 'order', BLANK_ORDER)!,
    notes: r.long('notes'),
  }));
  // Renumbered within each area.
  const next = new Map<string, number>();
  return { ...p, list: byOrderThenFile(p.list).map((s) => ({ ...s, order: next.set(s.areaId, (next.get(s.areaId) ?? -1) + 1).get(s.areaId)! })) };
}

export function parseBins(text: string): Parsed<Bin> {
  return readTable(text, BINS_FILE, BIN_COLUMNS, ['id', 'code', 'name'], (r) => ({
    id: r.required('id', 'id'),
    code: r.required('code', 'bin code').toUpperCase(),
    name: r.required('name', 'bin name'),
    spotId: r.text('spot_id'),
    seasonId: r.text('season_id'),
    tags: r.tags('tags'),
    state: r.oneOf('state', BIN_STATES, 'stored'),
    notes: r.long('notes'),
    labelPrintedAt: r.time('label_printed_at', 'label printed at'),
    labelContents: r.long('label_contents') || null,
  }));
}

const EXCEL_SCIENTIFIC = /^\d(\.\d+)?e\+\d+$/i;

export function parseItems(text: string): Parsed<Item> {
  return readTable(text, ITEMS_FILE, ITEM_COLUMNS, ['id', 'name', 'category', 'quantity'], (r) => {
    const barcode = r.text('barcode');
    if (EXCEL_SCIENTIFIC.test(barcode)) r.errors.push(`barcode "${barcode}" was turned into scientific notation by a spreadsheet; re-enter the full number`);
    const quantity = r.text('quantity') === '' ? (r.errors.push('quantity is required'), 0) : r.whole('quantity', 'quantity', 0)!;
    return {
      id: r.required('id', 'id'),
      name: r.required('name', 'name'),
      category: r.required('category', 'category'),
      subcategory: r.text('subcategory'),
      binId: r.text('bin_id'),
      spotId: r.text('spot_id'),
      quantity,
      approx: r.bool('approx'),
      seasonId: r.text('season_id'),
      tags: r.tags('tags'),
      status: r.oneOf('status', ITEM_STATUSES, 'stored'),
      outWhere: r.text('out_where'),
      outSince: r.time('out_since', 'out since'),
      lentTo: r.text('lent_to'),
      lentOn: r.date('lent_on', 'lent on'),
      condition: r.oneOf('condition', CONDITIONS, 'ok'),
      conditionNote: r.long('condition_note'),
      barcode,
      notes: r.long('notes'),
      value: r.money('value'),
      purchaseDate: r.date('purchase_date', 'purchase date'),
      model: r.text('model'),
      serial: r.text('serial'),
      warrantyUntil: r.date('warranty_until', 'warranty until'),
      keepAtLeast: r.whole('keep_at_least', 'keep at least', null),
      hasPhoto: false,
    };
  });
}

export function parseSeasons(text: string): Parsed<Season> {
  const p = readTable(text, SEASONS_FILE, SEASON_COLUMNS, ['id', 'name'], (r) => ({
    id: r.required('id', 'id'),
    name: r.required('name', 'season name'),
    order: r.whole('order', 'order', BLANK_ORDER)!,
    color: r.oneOf('color', SEASON_COLORS, 'red'),
    setupNotes: r.long('setup_notes'),
  }));
  return { ...p, list: byOrderThenFile(p.list).map((s, order) => ({ ...s, order })) };
}

export function parseTags(text: string): Parsed<Tag> {
  const p = readTable(text, TAGS_FILE, TAG_COLUMNS, ['name'], (r) => ({ name: r.required('name', 'tag name'), order: r.whole('order', 'order', BLANK_ORDER)! }));
  return { ...p, list: byOrderThenFile(p.list).map((t, order) => ({ ...t, order })) };
}

export interface FileRow extends PhotoInfo {
  path: string;
}

export function parseFiles(text: string): Parsed<FileRow> {
  return readTable(text, FILES_FILE, FILE_COLUMNS, ['id', 'owner_type', 'owner_id', 'path'], (r) => ({
    id: r.required('id', 'id'),
    ownerType: r.oneOf('owner_type', ['item', 'bin', 'spot', 'season'] as const, 'item'),
    ownerId: r.required('owner_id', 'owner_id'),
    kind: r.oneOf('kind', ['photo', 'setup'] as const, 'photo'),
    caption: r.long('caption'),
    order: r.whole('order', 'order', 0)!,
    path: r.required('path', 'path'),
  }));
}
