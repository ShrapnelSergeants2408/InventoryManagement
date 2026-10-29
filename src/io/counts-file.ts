// Reading a helper's counts file on the shop tablet (SPEC §18.4, §18.5 Check), and the pending
// items in full backups (§7 pending-items.csv). Each file is checked as a whole: one problem and
// nothing from it is used. Nothing here touches the database.
import JSZip from 'jszip';
import { readCountStamp } from '../domain/dates';
import { COUNTS_FORMAT, COUNTS_FORMAT_VERSION } from '../domain/helper-mode';
import type { CountsFile, IncomingCount } from '../domain/import-counts';
import { parseWholeNumber } from '../domain/validate';
import { cellGetter, readCsv, type FileProblem } from './csv';
import { COUNTS_CSV_FILE, COUNTS_JSON_FILE, NEW_ITEMS_FILE, NEW_LOCATIONS_FILE } from './count-kit';
import { helperIdOf, parsePendingCsv } from './pending-csv';

export type CountsRead = { ok: true; file: CountsFile } | { ok: false; newer: boolean; problems: string[] };

const PHOTO_TYPES: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
export const missingColumns = (have: Map<string, number>, want: readonly string[]) => want.filter((c) => !have.has(c));
const where = (p: FileProblem) => (p.row === null ? `${p.file}: ${p.message}` : `${p.file} row ${p.row}: ${p.message}`);

/** counts.csv (§18.4). */
export function parseCountsCsv(text: string): { counts: IncomingCount[]; problems: FileProblem[] } {
  const file = COUNTS_CSV_FILE;
  const table = readCsv(text, file);
  const problems = [...table.problems];
  const missing = missingColumns(table.columns, ['item_id', 'on_hand', 'counted_at', 'location', 'barcode', 'outside_assignment']);
  if (missing.length > 0) {
    problems.push({ file, row: table.headerRow, message: `missing column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}` });
    return { counts: [], problems };
  }
  const counts: IncomingCount[] = [];
  const ids = new Set<string>();
  for (const { row, cells } of table.rows) {
    const get = (h: string) => cellGetter(table, cells)(h).trim();
    const bad = (message: string) => problems.push({ file, row, message });
    const itemId = get('item_id');
    if (itemId === '') bad('item_id is blank');
    else if (ids.has(itemId)) bad(`item ${itemId} appears more than once`);
    ids.add(itemId);
    let onHand: number | null = null;
    if (get('on_hand') !== '') {
      const p = parseWholeNumber(get('on_hand'), 'on_hand');
      if (p.ok) onHand = p.value;
      else bad(p.error);
    }
    const countedAt = readCountStamp(get('counted_at'));
    if (countedAt === null) bad(`counted_at "${get('counted_at')}" must be a date and time like 2026-10-24T18:42-05:00`);
    else if (get('on_hand') !== '' && countedAt === '') bad('a count needs its counted_at');
    else if (get('on_hand') === '' && countedAt !== '') bad('counted_at is given but on_hand is blank');
    const outside = get('outside_assignment').toLowerCase();
    if (outside !== '' && outside !== 'yes') bad(`outside_assignment must be "yes" or blank, not "${get('outside_assignment')}"`);
    if (get('on_hand') === '' && get('location') === '' && get('barcode') === '') bad('the row changes nothing (no count, location or barcode)');
    counts.push({ itemId, onHand, countedAt: countedAt ?? '', location: get('location'), barcode: get('barcode'), outside: outside === 'yes' });
  }
  return { counts, problems };
}

/**
 * Reads one counts file (§18.5 Check): format and version, required columns, numbers ≥ 0,
 * valid dates. A newer format is refused with "reload" (§18.7). Kits and backups are refused
 * with a pointer to the screen that uses them.
 */
export async function readCountsFile(name: string, bytes: Uint8Array | ArrayBuffer): Promise<CountsRead> {
  const refuse = (message: string, newer = false): CountsRead => ({ ok: false, newer, problems: [message] });
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    return refuse('This file isn’t a counts file. Choose the counts-….zip a helper sent.');
  }
  const entries = Object.values(zip.files).filter((f) => !f.dir && !f.name.startsWith('__MACOSX/'));
  const named = (file: string) => entries.filter((f) => f.name.toLowerCase() === file || f.name.toLowerCase().endsWith(`/${file}`)).sort((a, b) => a.name.length - b.name.length)[0] ?? null;
  const json = named(COUNTS_JSON_FILE);
  if (!json) {
    if (named('kit.json')) return refuse('This is a count kit for a helper device, not a counts file. Open it on the helper with “Join as a helper”.');
    if (named('inventory.csv')) return refuse('This is an inventory backup, not a counts file. To restore it, use More › Backup › Restore.');
    return refuse('This file isn’t a counts file. Choose the counts-….zip a helper sent.');
  }
  const prefix = json.name.slice(0, json.name.length - COUNTS_JSON_FILE.length);
  const entry = (file: string) => entries.find((f) => f.name.toLowerCase() === (prefix + file).toLowerCase()) ?? null;
  let raw: Record<string, unknown> | null = null;
  try {
    raw = JSON.parse(await json.async('string')) as Record<string, unknown>;
  } catch {
    raw = null;
  }
  if (!raw || raw.format !== COUNTS_FORMAT) return refuse(`${COUNTS_JSON_FILE} isn’t from this app.`);
  const v = raw.format_version;
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 1) return refuse(`${COUNTS_JSON_FILE} has no format version.`);
  if (v > COUNTS_FORMAT_VERSION) return refuse('This counts file was made by a newer version of the app. Reload the app on this tablet to update it (close it and open it again), then import the file again.', true);
  const text = (k: string) => (typeof raw![k] === 'string' ? (raw![k] as string).trim() : '');
  const problems: string[] = [];
  for (const k of ['kit_id', 'helper_id', 'helper_name']) if (text(k) === '') problems.push(`${COUNTS_JSON_FILE}: ${k} is missing`);
  const createdAt = readCountStamp(text('created_at'));
  if (!createdAt) problems.push(`${COUNTS_JSON_FILE}: created_at is missing or not a date and time`);
  const sequence = raw.sequence;
  if (typeof sequence !== 'number' || !Number.isSafeInteger(sequence) || sequence < 1) problems.push(`${COUNTS_JSON_FILE}: sequence must be a whole number of 1 or more`);

  const csvText = await entry(COUNTS_CSV_FILE)?.async('string');
  if (csvText === undefined) problems.push(`the file has no ${COUNTS_CSV_FILE}`);
  const counts = csvText === undefined ? { counts: [], problems: [] } : parseCountsCsv(csvText);
  problems.push(...counts.problems.map(where));
  const helper = { id: text('helper_id'), name: text('helper_name') };
  const itemsText = await entry(NEW_ITEMS_FILE)?.async('string');
  const pend = itemsText === undefined ? { items: [], photoFiles: new Map<string, string>(), problems: [] } : parsePendingCsv(itemsText, NEW_ITEMS_FILE, helper);
  problems.push(...pend.problems.map(where));
  for (const p of pend.items) if (helperIdOf(p.id) !== '' && helperIdOf(p.id) !== helper.id) problems.push(`${NEW_ITEMS_FILE}: ${p.id} isn’t from this helper`);
  const locText = await entry(NEW_LOCATIONS_FILE)?.async('string');
  const newLocations: string[] = [];
  if (locText !== undefined) {
    const t = readCsv(locText, NEW_LOCATIONS_FILE);
    problems.push(...t.problems.map(where));
    if (!t.columns.has('name')) problems.push(`${NEW_LOCATIONS_FILE}: missing column: name`);
    else for (const { cells } of t.rows) {
      const n = cellGetter(t, cells)('name').trim();
      if (n !== '') newLocations.push(n);
    }
  }
  const photos = new Map<string, Blob>();
  for (const p of pend.items) {
    const path = pend.photoFiles.get(p.id);
    if (!path) continue;
    const f = entry(path);
    const type = PHOTO_TYPES[path.split('.').pop()?.toLowerCase() ?? ''];
    if (!f || !type) {
      problems.push(`${NEW_ITEMS_FILE}: the photo ${path} for ${p.id} isn’t in the file`);
      continue;
    }
    photos.set(p.id, new Blob([await f.async('arraybuffer')], { type }));
    p.hasPhoto = true;
  }
  if (problems.length > 0) return { ok: false, newer: false, problems };
  return {
    ok: true,
    file: {
      fileName: name,
      meta: { kitId: text('kit_id'), helperId: helper.id, helperName: helper.name, createdAt: createdAt!, sequence: sequence as number, appVersion: text('app_version') },
      counts: counts.counts,
      newItems: pend.items,
      newLocations,
      photos,
    },
  };
}

