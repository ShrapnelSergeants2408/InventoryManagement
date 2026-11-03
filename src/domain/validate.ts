// Field rules shared by the editors and every importer (SPEC v3.0 §3).
import { isMonthDay } from './seasons';
import { BIN_STATES, CONDITIONS, ITEM_STATUSES, PARTS, RUN_PHASES, SEASON_COLORS, TASK_PHASES, type Area, type Bin, type Display, type Item, type Part, type Season, type SeasonRun, type SeasonTask, type Spot } from './types';

export const isPart = (p: unknown): p is Part => PARTS.includes(p as Part);
const partError = (p: unknown): FieldError => ({ field: 'part', message: `part "${String(p)}" must be household or holiday` });

export type NumberParse = { ok: true; value: number } | { ok: false; error: string };

/** Whole number ≥ min. */
export function parseWholeNumber(raw: string, field: string, min = 0): NumberParse {
  const s = raw.trim();
  if (!/^\d+$/.test(s)) {
    if (/^-\d+$/.test(s)) return { ok: false, error: `${field} can't be negative` };
    return { ok: false, error: `${field} "${s}" must be a whole number${min > 0 ? ` ≥ ${min}` : ''}` };
  }
  const value = Number(s);
  if (!Number.isSafeInteger(value)) return { ok: false, error: `${field} "${s}" is too large` };
  if (value < min) return { ok: false, error: `${field} must be a whole number ≥ ${min}` };
  return { ok: true, value };
}

/** Strict ISO calendar date YYYY-MM-DD that exists. */
export function isIsoDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

export interface FieldError {
  field: string;
  message: string;
}

const wholeOrNull = (v: number | null) => v === null || (Number.isSafeInteger(v) && v >= 0);

/** Tags are written to CSV separated by ";" (§7), so a tag can't contain one. */
export function tagProblem(tag: string): string | null {
  if (tag.trim() === '') return 'a tag can’t be blank';
  if (tag.includes(';')) return `tag "${tag}" can’t contain ";"`;
  return null;
}

function checkTags(tags: readonly string[], errors: FieldError[]): void {
  for (const t of tags) {
    const p = tagProblem(t);
    if (p) errors.push({ field: 'tags', message: p });
  }
}

/** Validates a complete item before it is saved. */
export function validateItem(item: Item): FieldError[] {
  const errors: FieldError[] = [];
  const req = (field: string, value: string, label: string) => {
    if (value.trim() === '') errors.push({ field, message: `${label} is required` });
  };
  const date = (field: string, value: string, label: string) => {
    if (value !== '' && !isIsoDate(value)) errors.push({ field, message: `${label} "${value}" isn't a date (YYYY-MM-DD)` });
  };
  req('id', item.id, 'id');
  if (!isPart(item.part)) errors.push(partError(item.part));
  req('name', item.name, 'name');
  req('category', item.category, 'category');
  if (!(Number.isSafeInteger(item.quantity) && item.quantity >= 0)) errors.push({ field: 'quantity', message: 'quantity must be a whole number ≥ 0' });
  if (item.binId !== '' && item.spotId !== '') errors.push({ field: 'home', message: 'an item is in a bin or on a spot, not both' });
  if (!ITEM_STATUSES.includes(item.status)) errors.push({ field: 'status', message: `status "${item.status}" must be stored, out or lent` });
  if (!CONDITIONS.includes(item.condition)) errors.push({ field: 'condition', message: `condition "${item.condition}" must be ok, needs repair, replace or toss` });
  if (!wholeOrNull(item.value)) errors.push({ field: 'value', message: 'value must be whole cents ≥ 0' });
  if (!wholeOrNull(item.keepAtLeast)) errors.push({ field: 'keepAtLeast', message: 'keep at least must be a whole number ≥ 0' });
  if (item.outSince !== null && !Number.isSafeInteger(item.outSince)) errors.push({ field: 'outSince', message: 'out since must be a time' });
  if (item.checkedAt !== null && !Number.isSafeInteger(item.checkedAt)) errors.push({ field: 'checkedAt', message: 'checked at must be a time' });
  if (item.part === 'household') {
    // Seasons, displays and condition checks are Holiday only (§3).
    if (item.seasonId !== '') errors.push({ field: 'seasonId', message: 'a household item has no season' });
    if (item.displayId !== '' || item.outDisplayId !== '') errors.push({ field: 'displayId', message: 'a household item has no display' });
    if (item.checkedAt !== null) errors.push({ field: 'checkedAt', message: 'a household item has no condition check date' });
  }
  date('lentOn', item.lentOn, 'lent on');
  date('purchaseDate', item.purchaseDate, 'purchase date');
  date('warrantyUntil', item.warrantyUntil, 'warranty until');
  checkTags(item.tags, errors);
  return errors;
}

/** Area codes are 1–8 capital letters ("ATTIC"); letters only, so a bin number never runs into one. */
export const isAreaCode = (s: string) => /^[A-Z]{1,8}$/.test(s);

export function validateArea(a: Area): FieldError[] {
  const errors: FieldError[] = [];
  if (a.id.trim() === '') errors.push({ field: 'id', message: 'id is required' });
  if (!isPart(a.part)) errors.push(partError(a.part));
  if (a.name.trim() === '') errors.push({ field: 'name', message: 'area name is required' });
  if (!isAreaCode(a.code)) errors.push({ field: 'code', message: `area code "${a.code}" must be 1 to 8 letters A–Z` });
  return errors;
}

export function validateSpot(s: Spot): FieldError[] {
  const errors: FieldError[] = [];
  if (s.id.trim() === '') errors.push({ field: 'id', message: 'id is required' });
  if (s.areaId.trim() === '') errors.push({ field: 'areaId', message: 'a spot needs an area' });
  if (s.name.trim() === '') errors.push({ field: 'name', message: 'spot name is required' });
  return errors;
}

/** "ATTIC-04": an area code, a dash and at least two digits. 0.1.2's "A-04" fits too. */
export const BIN_CODE_PATTERN = /^[A-Z]{1,8}-\d{2,}$/;

export function validateBin(b: Bin): FieldError[] {
  const errors: FieldError[] = [];
  if (b.id.trim() === '') errors.push({ field: 'id', message: 'id is required' });
  if (!isPart(b.part)) errors.push(partError(b.part));
  if (b.part === 'household' && b.seasonId !== '') errors.push({ field: 'seasonId', message: 'a household bin has no season' });
  if (b.name.trim() === '') errors.push({ field: 'name', message: 'bin name is required' });
  if (!BIN_CODE_PATTERN.test(b.code)) errors.push({ field: 'code', message: `bin code "${b.code}" must look like A-04` });
  if (!BIN_STATES.includes(b.state)) errors.push({ field: 'state', message: `bin state "${b.state}" must be stored or out` });
  if (b.labelPrintedAt !== null && !Number.isSafeInteger(b.labelPrintedAt)) errors.push({ field: 'labelPrintedAt', message: 'label printed at must be a time' });
  checkTags(b.tags, errors);
  return errors;
}

export function validateSeason(s: Season): FieldError[] {
  const errors: FieldError[] = [];
  if (s.id.trim() === '') errors.push({ field: 'id', message: 'id is required' });
  if (s.name.trim() === '') errors.push({ field: 'name', message: 'season name is required' });
  if (!SEASON_COLORS.includes(s.color)) errors.push({ field: 'color', message: `season color "${s.color}" isn't in the palette` });
  for (const [field, label] of [['setupFrom', 'setup from'], ['takedownBy', 'takedown by']] as const) {
    if (s[field] !== '' && !isMonthDay(s[field])) errors.push({ field, message: `${label} "${s[field]}" must be a month and day (MM-DD)` });
  }
  if ((s.setupFrom === '') !== (s.takedownBy === '')) errors.push({ field: 'takedownBy', message: 'a season needs both dates, or neither' });
  return errors;
}

export function validateDisplay(d: Display): FieldError[] {
  const errors: FieldError[] = [];
  if (d.id.trim() === '') errors.push({ field: 'id', message: 'id is required' });
  if (d.name.trim() === '') errors.push({ field: 'name', message: 'display name is required' });
  return errors;
}

export function validateSeasonTask(t: SeasonTask): FieldError[] {
  const errors: FieldError[] = [];
  if (t.id.trim() === '') errors.push({ field: 'id', message: 'id is required' });
  if (t.seasonId.trim() === '') errors.push({ field: 'seasonId', message: 'a season task needs a season' });
  if (!TASK_PHASES.includes(t.phase)) errors.push({ field: 'phase', message: `task phase "${t.phase}" must be setup or takedown` });
  if (t.text.trim() === '') errors.push({ field: 'text', message: 'task text is required' });
  return errors;
}

export function validateSeasonRun(r: SeasonRun): FieldError[] {
  const errors: FieldError[] = [];
  if (r.id.trim() === '') errors.push({ field: 'id', message: 'id is required' });
  if (r.seasonId.trim() === '') errors.push({ field: 'seasonId', message: 'a season run needs a season' });
  if (!(Number.isSafeInteger(r.year) && r.year >= 2000 && r.year <= 2999)) errors.push({ field: 'year', message: `year "${r.year}" must be a year such as 2026` });
  if (!RUN_PHASES.includes(r.phase)) errors.push({ field: 'phase', message: `run phase "${r.phase}" must be one of: ${RUN_PHASES.join(', ')}` });
  for (const [field, label] of [['setupFrom', 'setup from'], ['takedownBy', 'takedown by']] as const) {
    if (r[field] !== '' && !isMonthDay(r[field])) errors.push({ field, message: `${label} "${r[field]}" must be a month and day (MM-DD)` });
  }
  if ((r.setupFrom === '') !== (r.takedownBy === '')) errors.push({ field: 'takedownBy', message: 'a run gives both dates, or neither' });
  for (const [field, label] of [['startedAt', 'started at'], ['finishedAt', 'finished at']] as const) {
    if (r[field] !== null && !Number.isSafeInteger(r[field])) errors.push({ field, message: `${label} must be a time` });
  }
  return errors;
}
