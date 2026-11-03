// The record files of a full backup (SPEC v3.0 §7): areas, spots, bins, items, seasons, tags,
// displays, season tasks and runs (0.1.4 on), and files (photo records). Columns are matched by header name; tags are separated by ";",
// money is dollars with 2 decimals, dates and times are ISO, season dates MM-DD. A 0.1.2 backup
// has no `part` columns; the reader reports that (`hasPart`) so the bundle can convert it.
import { centsToPlain, parsePrice } from '../domain/money';
import { isMonthDay } from '../domain/seasons';
import { BIN_STATES, CONDITIONS, ITEM_STATUSES, PARTS, PHOTO_OWNERS, RUN_PHASES, SEASON_COLORS, TASK_PHASES, type Area, type Bin, type Display, type Item, type Part, type PhotoInfo, type Season, type SeasonRun, type SeasonTask, type Spot, type Tag } from '../domain/types';
import { isIsoDate, parseWholeNumber } from '../domain/validate';
import { cellGetter, readCsv, writeCsv, type CsvTable, type FileProblem } from './csv';

export const AREAS_FILE = 'areas.csv';
export const SPOTS_FILE = 'spots.csv';
export const BINS_FILE = 'bins.csv';
export const ITEMS_FILE = 'items.csv';
export const SEASONS_FILE = 'seasons.csv';
export const TAGS_FILE = 'tags.csv';
export const FILES_FILE = 'files.csv';
export const DISPLAYS_FILE = 'displays.csv';
export const TASKS_FILE = 'season_tasks.csv';
export const RUNS_FILE = 'season_runs.csv';

export const AREA_COLUMNS = ['id', 'part', 'name', 'code', 'order', 'notes'] as const;
/** 0.1.2 wrote the area's letter; read into `code` (one letter) for the conversion. */
const AREA_COLUMNS_READ = [...AREA_COLUMNS, 'letter'] as const;
export const SPOT_COLUMNS = ['id', 'area_id', 'name', 'order', 'notes'] as const;
export const BIN_COLUMNS = ['id', 'part', 'code', 'name', 'spot_id', 'season_id', 'tags', 'state', 'notes', 'label_printed_at', 'label_contents'] as const;
export const ITEM_COLUMNS = [
  'id', 'part', 'name', 'category', 'subcategory', 'bin_id', 'spot_id', 'quantity', 'approx', 'season_id', 'display_id', 'tags', 'status', 'out_where', 'out_display_id', 'out_since',
  'lent_to', 'lent_on', 'condition', 'condition_note', 'checked_at', 'barcode', 'notes', 'value', 'purchase_date', 'model', 'serial', 'warranty_until', 'keep_at_least',
] as const;
export const SEASON_COLUMNS = ['id', 'name', 'order', 'color', 'setup_from', 'takedown_by', 'setup_notes'] as const;
export const TAG_COLUMNS = ['part', 'name', 'order'] as const;
export const FILE_COLUMNS = ['id', 'owner_type', 'owner_id', 'kind', 'season_id', 'caption', 'order', 'path'] as const;
export const DISPLAY_COLUMNS = ['id', 'name', 'order', 'notes'] as const;
export const TASK_COLUMNS = ['id', 'season_id', 'phase', 'text', 'order'] as const;
export const RUN_COLUMNS = ['id', 'season_id', 'year', 'setup_from', 'takedown_by', 'phase', 'done_task_ids', 'started_at', 'finished_at'] as const;

// ── Writing ──

export const tagsCell = (tags: readonly string[]) => tags.join('; ');
const timeCell = (ms: number | null) => (ms === null ? '' : new Date(ms).toISOString());
const yes = (b: boolean) => (b ? 'yes' : '');
const numCell = (n: number | null) => (n === null ? '' : String(n));

const sortByOrder = <T extends { order: number }>(list: readonly T[]) => [...list].sort((a, b) => a.order - b.order);
/** Household first, then Holiday, each in its own order; `order` is the position within the part. */
const byPartThenOrder = <T extends { part: Part; order: number }>(list: readonly T[]) => PARTS.flatMap((p) => sortByOrder(list.filter((x) => x.part === p)).map((x, i) => ({ x, i })));

export const serializeAreas = (list: readonly Area[]) =>
  writeCsv(AREA_COLUMNS, byPartThenOrder(list).map(({ x: a, i }) => [a.id, a.part, a.name, a.code, String(i), a.notes]));

/** Spots in their area's walk order; `order` is the position within the area. */
export const serializeSpots = (list: readonly Spot[]) =>
  writeCsv(SPOT_COLUMNS, sortByOrder(list).map((s) => [s.id, s.areaId, s.name, String(s.order), s.notes]));

export const serializeBins = (list: readonly Bin[]) =>
  writeCsv(
    BIN_COLUMNS,
    [...list].sort((a, b) => a.code.localeCompare(b.code, 'en-US', { numeric: true })).map((b) => [b.id, b.part, b.code, b.name, b.spotId, b.seasonId, tagsCell(b.tags), b.state, b.notes, timeCell(b.labelPrintedAt), b.labelContents ?? '']),
  );

export function itemCells(i: Item): string[] {
  const cells: Record<(typeof ITEM_COLUMNS)[number], string> = {
    id: i.id,
    part: i.part,
    name: i.name,
    category: i.category,
    subcategory: i.subcategory,
    bin_id: i.binId,
    spot_id: i.spotId,
    quantity: String(i.quantity),
    approx: yes(i.approx),
    season_id: i.seasonId,
    display_id: i.displayId,
    tags: tagsCell(i.tags),
    status: i.status,
    out_where: i.outWhere,
    out_display_id: i.outDisplayId,
    out_since: timeCell(i.outSince),
    lent_to: i.lentTo,
    lent_on: i.lentOn,
    condition: i.condition,
    condition_note: i.conditionNote,
    checked_at: timeCell(i.checkedAt),
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
  writeCsv(SEASON_COLUMNS, sortByOrder(list).map((s, i) => [s.id, s.name, String(i), s.color, s.setupFrom, s.takedownBy, s.setupNotes]));

export const serializeTags = (list: readonly Tag[]) => writeCsv(TAG_COLUMNS, byPartThenOrder(list).map(({ x: t, i }) => [t.part, t.name, String(i)]));

/** Photo path inside a full backup ZIP; the extension follows the image type. */
export function photoPathFor(id: string, type = 'image/jpeg'): string {
  const ext = type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg';
  return `photos/${id}.${ext}`;
}

export const serializeFiles = (list: readonly PhotoInfo[], path: (p: PhotoInfo) => string) =>
  writeCsv(FILE_COLUMNS, list.map((p) => [p.id, p.ownerType, p.ownerId, p.kind, p.seasonId ?? '', p.caption, String(p.order), path(p)]));

export const serializeDisplays = (list: readonly Display[]) => writeCsv(DISPLAY_COLUMNS, sortByOrder(list).map((d, i) => [d.id, d.name, String(i), d.notes]));

/** Tasks by season, then phase (setup first), then position; `order` is the position within its season and phase. */
export const serializeTasks = (list: readonly SeasonTask[]) =>
  writeCsv(
    TASK_COLUMNS,
    [...list].sort((a, b) => a.seasonId.localeCompare(b.seasonId) || TASK_PHASES.indexOf(a.phase) - TASK_PHASES.indexOf(b.phase) || a.order - b.order).map((t) => [t.id, t.seasonId, t.phase, t.text, String(t.order)]),
  );

export const serializeRuns = (list: readonly SeasonRun[]) =>
  writeCsv(
    RUN_COLUMNS,
    [...list].sort((a, b) => a.seasonId.localeCompare(b.seasonId) || a.year - b.year).map((r) => [r.id, r.seasonId, String(r.year), r.setupFrom, r.takedownBy, r.phase, r.doneTaskIds.join('; '), timeCell(r.startedAt), timeCell(r.finishedAt)]),
  );

// ── Reading ──

export interface Parsed<T> {
  list: T[];
  problems: FileProblem[];
  ignoredColumns: string[];
  /** The file has a `part` column (false: a 0.1.2 backup, all Household). */
  hasPart: boolean;
}

/** One row's cells by header, collecting this row's problems. */
class Row {
  readonly errors: string[] = [];
  private readonly get: (h: string) => string;
  private readonly hasPart: boolean;
  constructor(table: CsvTable, cells: string[]) {
    this.get = cellGetter(table, cells);
    this.hasPart = table.columns.has('part');
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
  /** A part; blank only in a file without the column (0.1.2), read as Household for conversion. */
  part(): Part {
    // A file with the column (0.1.3 on) needs it filled in; only a 0.1.2 file, without it, reads as Household.
    if (this.hasPart && this.text('part') === '') {
      this.errors.push('part is required (household or holiday)');
      return 'household';
    }
    return this.oneOf('part', PARTS, 'household');
  }
  monthDay(col: string, label: string): string {
    const v = this.text(col);
    if (v !== '' && !isMonthDay(v)) this.errors.push(`${label} "${v}" must be a month and day (MM-DD)`);
    return v;
  }
  /** A `;`-separated list of ids, duplicates dropped. */
  ids(col: string): string[] {
    return [...new Set(this.text(col).split(';').map((x) => x.trim()).filter((x) => x !== ''))];
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
  const hasPart = table.columns.has('part');
  const missing = required.filter((c) => !table.columns.has(c));
  if (missing.length > 0) {
    problems.push({ file, row: table.headerRow, message: `missing column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}` });
    return { list: [], problems, ignoredColumns, hasPart };
  }
  const list: T[] = [];
  for (const { row, cells } of table.rows) {
    const r = new Row(table, cells);
    const value = build(r);
    if (r.errors.length) for (const message of r.errors) problems.push({ file, row, message });
    else list.push(value);
  }
  return { list, problems, ignoredColumns, hasPart };
}

/** Lists come back in file order when `order` is blank, else by `order` (ties keep file order). */
function byOrderThenFile<T extends { order: number }>(list: T[]): T[] {
  return list.map((x, pos) => ({ x, pos })).sort((a, b) => a.x.order - b.x.order || a.pos - b.pos).map(({ x }) => x);
}

const BLANK_ORDER = Number.MAX_SAFE_INTEGER;

/** Renumbers `order` from 0 within each group (part, or area for spots), keeping the sorted order. */
function renumberWithin<T extends { order: number }>(list: T[], group: (x: T) => string): T[] {
  const next = new Map<string, number>();
  return byOrderThenFile(list).map((x) => {
    const order = next.get(group(x)) ?? 0;
    next.set(group(x), order + 1);
    return { ...x, order };
  });
}

export function parseAreas(text: string): Parsed<Area> {
  const p = readTable(text, AREAS_FILE, AREA_COLUMNS_READ, ['id', 'name'], (r) => ({
    id: r.required('id', 'id'),
    part: r.part(),
    name: r.required('name', 'area name'),
    code: (r.text('code') || r.required('letter', 'area code')).toUpperCase(),
    order: r.whole('order', 'order', BLANK_ORDER)!,
    notes: r.long('notes'),
  }));
  return { ...p, list: PARTS.flatMap((part) => renumberWithin(p.list.filter((a) => a.part === part), () => part)) };
}

export function parseSpots(text: string): Parsed<Spot> {
  const p = readTable(text, SPOTS_FILE, SPOT_COLUMNS, ['id', 'area_id', 'name'], (r) => ({
    id: r.required('id', 'id'),
    areaId: r.required('area_id', 'area_id'),
    name: r.required('name', 'spot name'),
    order: r.whole('order', 'order', BLANK_ORDER)!,
    notes: r.long('notes'),
  }));
  return { ...p, list: renumberWithin(p.list, (s) => s.areaId) };
}

export function parseBins(text: string): Parsed<Bin> {
  return readTable(text, BINS_FILE, BIN_COLUMNS, ['id', 'code', 'name'], (r) => ({
    id: r.required('id', 'id'),
    part: r.part(),
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
      part: r.part(),
      name: r.required('name', 'name'),
      category: r.required('category', 'category'),
      subcategory: r.text('subcategory'),
      binId: r.text('bin_id'),
      spotId: r.text('spot_id'),
      quantity,
      approx: r.bool('approx'),
      seasonId: r.text('season_id'),
      displayId: r.text('display_id'),
      tags: r.tags('tags'),
      status: r.oneOf('status', ITEM_STATUSES, 'stored'),
      outWhere: r.text('out_where'),
      outDisplayId: r.text('out_display_id'),
      outSince: r.time('out_since', 'out since'),
      lentTo: r.text('lent_to'),
      lentOn: r.date('lent_on', 'lent on'),
      condition: r.oneOf('condition', CONDITIONS, 'ok'),
      conditionNote: r.long('condition_note'),
      checkedAt: r.time('checked_at', 'checked at'),
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
    setupFrom: r.monthDay('setup_from', 'setup from'),
    takedownBy: r.monthDay('takedown_by', 'takedown by'),
    setupNotes: r.long('setup_notes'),
  }));
  return { ...p, list: byOrderThenFile(p.list).map((s, order) => ({ ...s, order })) };
}

export function parseTags(text: string): Parsed<Tag> {
  const p = readTable(text, TAGS_FILE, TAG_COLUMNS, ['name'], (r) => ({ part: r.part(), name: r.required('name', 'tag name'), order: r.whole('order', 'order', BLANK_ORDER)! }));
  return { ...p, list: PARTS.flatMap((part) => renumberWithin(p.list.filter((t) => t.part === part), () => part)) };
}

export interface FileRow extends PhotoInfo {
  path: string;
}

export function parseFiles(text: string): Parsed<FileRow> {
  return readTable(text, FILES_FILE, FILE_COLUMNS, ['id', 'owner_type', 'owner_id', 'path'], (r) => {
    const row: FileRow = {
      id: r.required('id', 'id'),
      ownerType: r.oneOf('owner_type', PHOTO_OWNERS, 'item'),
      ownerId: r.required('owner_id', 'owner_id'),
      kind: r.oneOf('kind', ['photo', 'setup'] as const, 'photo'),
      caption: r.long('caption'),
      order: r.whole('order', 'order', 0)!,
      path: r.required('path', 'path'),
    };
    const seasonId = r.text('season_id');
    if (seasonId) row.seasonId = seasonId;
    return row;
  });
}

export function parseDisplays(text: string): Parsed<Display> {
  const p = readTable(text, DISPLAYS_FILE, DISPLAY_COLUMNS, ['id', 'name'], (r) => ({
    id: r.required('id', 'id'),
    name: r.required('name', 'display name'),
    order: r.whole('order', 'order', BLANK_ORDER)!,
    notes: r.long('notes'),
  }));
  return { ...p, list: byOrderThenFile(p.list).map((d, order) => ({ ...d, order })) };
}

export function parseTasks(text: string): Parsed<SeasonTask> {
  const p = readTable(text, TASKS_FILE, TASK_COLUMNS, ['id', 'season_id', 'phase', 'text'], (r) => ({
    id: r.required('id', 'id'),
    seasonId: r.required('season_id', 'season_id'),
    phase: r.text('phase') === '' ? (r.errors.push('phase is required (setup or takedown)'), 'setup' as const) : r.oneOf('phase', TASK_PHASES, 'setup'),
    text: r.required('text', 'task text'),
    order: r.whole('order', 'order', BLANK_ORDER)!,
  }));
  return { ...p, list: renumberWithin(p.list, (t) => `${t.seasonId}\n${t.phase}`) };
}

export function parseRuns(text: string): Parsed<SeasonRun> {
  return readTable(text, RUNS_FILE, RUN_COLUMNS, ['id', 'season_id', 'year', 'phase'], (r) => ({
    id: r.required('id', 'id'),
    seasonId: r.required('season_id', 'season_id'),
    year: r.text('year') === '' ? (r.errors.push('year is required'), 0) : r.whole('year', 'year', 0)!,
    setupFrom: r.monthDay('setup_from', 'setup from'),
    takedownBy: r.monthDay('takedown_by', 'takedown by'),
    phase: r.text('phase') === '' ? (r.errors.push('phase is required'), 'planned' as const) : r.oneOf('phase', RUN_PHASES, 'planned'),
    doneTaskIds: r.ids('done_task_ids'),
    startedAt: r.time('started_at', 'started at'),
    finishedAt: r.time('finished_at', 'finished at'),
  }));
}
