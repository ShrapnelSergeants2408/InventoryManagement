// Import counts on the shop tablet (SPEC §18.5) and the §18.6 must-have tests: every row of
// the preview table (including a conflict between two helpers and the same helper sending
// twice), the same file twice, several files in any order, Undo exactly, a failed check
// changing nothing, the kit → helper → counts → import round trip, date-only times, the
// count-round rule; plus pending items (review, backups, restore) and Undo across a restore.
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import JSZip from 'jszip';
import { afterEach, describe, expect, it } from 'vitest';
import { applyRestore, buildBackup } from '../src/data/backup';
import { saveCount } from '../src/data/count';
import { InventoryDb, fromItemRow, toHelperRow, toItemRow, toLocationRow, toSupplierRow } from '../src/data/db';
import { HelperDb, addPendingItem, helperItems, joinKit, loadHelperState, pendingPhotos as helperPhotos } from '../src/data/helper-db';
import { applyImport, getImportUndo, previewImport, undoImport } from '../src/data/import-counts';
import { addLocation } from '../src/data/lists';
import { addItem, setBarcode } from '../src/data/items';
import { combinePendingItems, discardPending, loadPending, matchPending, pendingPhoto } from '../src/data/pending';
import { isCounted } from '../src/domain/count';
import type { Helper } from '../src/domain/helpers';
import type { PendingRecord } from '../src/domain/helper-mode';
import { findDuplicates, newestChoices, noChoices, planImport, similarNames, type CountsFile, type ImportChoices, type IncomingCount, type PlanInput } from '../src/domain/import-counts';
import { buildCountKit, buildCountsFile, readCountKit } from '../src/io/count-kit';
import { parseCountsCsv, readCountsFile } from '../src/io/counts-file';
import { parsePendingCsv } from '../src/io/pending-csv';
import { readRestoreFile } from '../src/io/restore';
import { item } from './helpers';

const KIT_AT = '2026-10-28T18:00:00-05:00';
const MAYA = 'Maya’s phone';
const T2 = 'Tablet 2';

const helper = (over: Partial<Helper> = {}): Helper => ({
  id: 'hp-MAYA1',
  name: MAYA,
  kind: 'category',
  groups: ['Electrical'],
  allowNewItems: true,
  kits: [{ id: 'kit-MAYA0001', createdAt: KIT_AT }],
  lastImportAt: null,
  created: 1,
  ...over,
});
const helpers = [helper(), helper({ id: 'hp-TAB22', name: T2, kits: [{ id: 'kit-TAB20001', createdAt: KIT_AT }] })];

const count = (itemId: string, onHand: number | null, countedAt: string, over: Partial<IncomingCount> = {}): IncomingCount => ({ itemId, onHand, countedAt, location: '', barcode: '', outside: false, ...over });
const file = (counts: IncomingCount[], over: Partial<CountsFile> = {}, meta: Partial<CountsFile['meta']> = {}): CountsFile => ({
  fileName: 'counts-maya-s-phone-2026-10-28-1912.zip',
  meta: { kitId: 'kit-MAYA0001', helperId: 'hp-MAYA1', helperName: MAYA, createdAt: '2026-10-28T19:12:00-05:00', sequence: 1, appVersion: '0.5.0', ...meta },
  counts,
  newItems: [],
  newLocations: [],
  photos: new Map(),
  ...over,
});
const tabletFile = (counts: IncomingCount[], seq = 1) => file(counts, { fileName: `counts-tablet-2-${seq}.zip` }, { kitId: 'kit-TAB20001', helperId: 'hp-TAB22', helperName: T2, sequence: seq });

const items = [
  item({ id: 'A', name: 'Never counted', category: 'Electrical', onHand: 0 }),
  item({ id: 'B', name: 'Counted here after the kit', category: 'Electrical', onHand: 9, lastCounted: '2026-10-28T18:40:00-05:00' }),
  item({ id: 'C', name: 'Counted here before the kit', category: 'Electrical', onHand: 5, lastCounted: '2026-10-28T17:00:00-05:00' }),
  item({ id: 'D', name: 'Counted by Maya earlier', category: 'Electrical', onHand: 3, lastCounted: '2026-10-28T18:10:00-05:00', countedBy: MAYA }),
  item({ id: 'E', name: 'Maya’s count already applied', category: 'Electrical', onHand: 2, lastCounted: '2026-10-28T18:20:00-05:00', countedBy: MAYA }),
  item({ id: 'F', name: 'Counted by Tablet 2 after the kit', category: 'Electrical', onHand: 1, lastCounted: '2026-10-28T18:30:00-05:00', countedBy: T2 }),
  item({ id: 'G', name: 'Has a location and barcode', category: 'Electrical', location: 'Bin A', barcode: '111', onHand: 4, lastCounted: '2026-10-28T17:00:00-05:00' }),
  item({ id: 'H', name: 'Fasteners item', category: 'Fasteners', onHand: 0 }),
];
const locations = [{ name: 'Bin A', notes: '', order: 0 }, { name: 'Shelf C1', notes: '', order: 1 }];
const input = (files: CountsFile[], over: Partial<PlanInput> = {}): PlanInput => ({ files, items, locations, helpers, knownPending: new Set(), ...over });
const row = (plan: ReturnType<typeof planImport>, id: string) => plan.rows.find((r) => r.itemId === id)!;

describe('the preview table (§18.5)', () => {
  const at = (hm: string) => `2026-10-28T${hm}:00-05:00`;

  it('new count: never counted here, counted here before the kit, or counted by the same helper earlier', () => {
    const p = planImport(input([file([count('A', 4, at('18:50')), count('C', 7, at('18:51')), count('D', 8, at('18:52'))])]));
    expect(['A', 'C', 'D'].map((id) => row(p, id).kind)).toEqual(['apply', 'apply', 'apply']);
    expect(p.changes.get('C')).toEqual({ onHand: 7, lastCounted: at('18:51'), countedBy: MAYA, location: '', barcode: '' });
    expect(p.counts.apply).toBe(3);
  });

  it('already applied: same helper, same counted_at (and an older count of the same helper) is skipped', () => {
    const p = planImport(input([file([count('E', 2, at('18:20')), count('D', 1, at('18:05'))])]));
    expect([row(p, 'E').kind, row(p, 'D').kind, p.changes.size, p.counts.applied]).toEqual(['applied', 'applied', 0, 2]);
  });

  it('same number: applied quietly, last_counted takes the newer time', () => {
    const p = planImport(input([file([count('B', 9, at('18:55')), count('G', 4, at('16:00'))])]));
    expect([row(p, 'B').kind, row(p, 'G').kind]).toEqual(['same', 'same']);
    expect(p.changes.get('B')).toEqual({ onHand: 9, lastCounted: at('18:55'), countedBy: MAYA, location: '', barcode: '' });
    // G's count here (17:00) is newer than the helper's (16:00): nothing changes.
    expect(p.changes.has('G')).toBe(false);
    expect(p.counts.same).toBe(2);
  });

  it('conflict: counted here after the kit, different numbers; Apply waits for a choice', () => {
    const p = planImport(input([file([count('B', 4, at('18:52'))])]));
    expect(row(p, 'B')).toMatchObject({ kind: 'conflict', conflict: { choice: null, keep: 9, helper: 4, add: 13 }, before: { onHand: 9, lastCounted: at('18:40'), countedBy: '' } });
    expect([p.ready, p.counts.conflictsLeft, p.changes.size]).toEqual([false, 1, 0]);
  });

  it.each<[ImportChoices['conflicts'][string], { onHand: number; lastCounted: string; countedBy: string } | null]>([
    ['keep', null],
    ['helper', { onHand: 4, lastCounted: '2026-10-28T18:52:00-05:00', countedBy: MAYA }],
    ['add', { onHand: 13, lastCounted: '2026-10-28T18:52:00-05:00', countedBy: MAYA }],
  ])('conflict choice %s', (choice, expected) => {
    const first = planImport(input([file([count('B', 4, at('18:52'))])]));
    const p = planImport(input([file([count('B', 4, at('18:52'))])]), { ...noChoices(), conflicts: { [row(first, 'B').key]: choice } });
    expect(p.ready).toBe(true);
    expect(p.changes.get('B') ?? null).toEqual(expected && { ...expected, location: '', barcode: '' });
  });

  it('a conflict between two helpers, and Use newest for all', () => {
    const p = planImport(input([file([count('F', 6, at('18:45')), count('B', 4, at('18:10'))])]));
    expect([row(p, 'F').kind, row(p, 'B').kind]).toEqual(['conflict', 'conflict']);
    const newest = newestChoices(p, noChoices());
    // F: Maya 18:45 is newer than Tablet 2's 18:30 → helper's; B: Maya 18:10 is older than 18:40 here → keep.
    expect(Object.values(newest.conflicts).sort()).toEqual(['helper', 'keep']);
    const done = planImport(input([file([count('F', 6, at('18:45')), count('B', 4, at('18:10'))])]), newest);
    expect([done.ready, done.changes.get('F')?.onHand, done.changes.has('B')]).toEqual([true, 6, false]);
  });

  it('conflicts between files in one import: the later file meets the earlier one’s count', () => {
    // Picked in the other order: counted_at decides, not the order of the files.
    const p = planImport(input([tabletFile([count('A', 5, at('18:55'))]), file([count('A', 3, at('18:50'))])]));
    // Maya's 18:50 is applied first; Tablet 2's 18:55 then meets a count by another helper after its kit.
    expect([row(p, 'A').kind, p.rows.filter((r) => r.itemId === 'A').map((r) => [r.helperName, r.kind])]).toEqual(['apply', [[MAYA, 'apply'], [T2, 'conflict']]]);
  });

  it('counted_at order wins over the helper: Tablet 2 counted first, so Maya’s later count is the conflict', () => {
    const p = planImport(input([file([count('A', 3, at('18:55'))]), tabletFile([count('A', 5, at('18:50'))])]));
    expect(p.rows.map((r) => [r.helperName, r.kind])).toEqual([[T2, 'apply'], [MAYA, 'conflict']]);
  });

  it('the same helper sending twice: the second file’s counts are already applied, newer ones apply', () => {
    const first = file([count('A', 3, at('18:50'))]);
    const second = file([count('A', 3, at('18:50')), count('C', 6, at('19:05'))], { fileName: 'second.zip' }, { sequence: 2 });
    const p = planImport(input([first, second]));
    expect(p.rows.map((r) => [r.itemId, r.kind])).toEqual([['A', 'apply'], ['A', 'applied'], ['C', 'apply']]);
  });

  it('cumulative files imported together: a conflict that’s in both files is asked once', () => {
    const first = file([count('B', 4, at('18:52')), count('A', 3, at('18:50'))]);
    const second = file([count('B', 4, at('18:52')), count('A', 3, at('18:50')), count('C', 6, at('19:05'))], { fileName: 'second.zip' }, { sequence: 2 });
    const p = planImport(input([second, first]));
    expect(p.counts).toMatchObject({ conflicts: 1, conflictsLeft: 1, apply: 2, applied: 2 });
    const done = planImport(input([second, first]), { ...noChoices(), conflicts: { [p.rows.find((r) => r.kind === 'conflict')!.key]: 'helper' } });
    expect([done.ready, done.changes.get('B')?.onHand]).toEqual([true, 4]);
  });

  it('outside assignment: applied, and counted for a glance', () => {
    const p = planImport(input([file([count('H', 2, at('18:50'), { outside: true })])]));
    expect([row(p, 'H').kind, row(p, 'H').outside, p.counts.outside]).toEqual(['apply', true, 1]);
  });

  it('unknown item: skipped and listed', () => {
    const p = planImport(input([file([count('Z', 2, at('18:50'))])]));
    expect([row(p, 'Z').kind, row(p, 'Z').item, p.counts.unknown, p.changes.size]).toEqual(['unknown', null, 1, 0]);
  });

  it('location: applied where the item has none; keep or use where it differs', () => {
    const rows = [count('A', 1, at('18:50'), { location: 'shelf c1' }), count('G', null, '', { location: 'Shelf C1' })];
    const p = planImport(input([file(rows)]));
    expect([row(p, 'A').location, row(p, 'G').location]).toEqual([
      { name: 'Shelf C1', state: 'apply', current: '', choice: 'keep' },
      { name: 'Shelf C1', state: 'choice', current: 'Bin A', choice: 'keep' },
    ]);
    expect([p.changes.get('A')?.location, p.changes.has('G')]).toEqual(['Shelf C1', false]);
    const use = planImport(input([file(rows)]), { ...noChoices(), locations: { [row(p, 'G').key]: 'helper' } });
    expect(use.changes.get('G')).toMatchObject({ location: 'Shelf C1', onHand: 4, lastCounted: '2026-10-28T17:00:00-05:00' });
  });

  it('barcode: applied where none; keep or use where different; never when another item has it', () => {
    const rows = [count('A', null, '', { barcode: '222' }), count('G', null, '', { barcode: '333' }), count('C', null, '', { barcode: '111' })];
    const p = planImport(input([file(rows)]));
    expect(['A', 'G', 'C'].map((id) => [row(p, id).barcode?.state, row(p, id).barcode?.takenBy])).toEqual([['apply', ''], ['choice', ''], ['taken', 'Has a location and barcode']]);
    expect([p.changes.get('A')?.barcode, p.changes.has('G'), p.changes.has('C')]).toEqual(['222', false, false]);
    const use = planImport(input([file(rows)]), { ...noChoices(), barcodes: { [row(p, 'G').key]: 'helper' } });
    expect(use.changes.get('G')?.barcode).toBe('333');
  });

  it('new location names: merged ignoring capitals; others Add (default, at the end) or Same as…', () => {
    const f = file([count('A', 1, at('18:50'), { location: 'Bin Z' }), count('C', 6, at('18:51'), { location: 'BIN A' })], { newLocations: ['Bin Z', 'Cart 2', 'bin a'] });
    const p = planImport(input([f]));
    expect(p.newLocations.map((n) => [n.name, n.choice.kind])).toEqual([['Bin Z', 'add'], ['Cart 2', 'add']]);
    expect([p.createdLocations, p.changes.get('A')?.location, p.changes.get('C')?.location]).toEqual([['Bin Z', 'Cart 2'], 'Bin Z', 'Bin A']);
    const same = planImport(input([f]), { ...noChoices(), newLocations: { 'bin z': { kind: 'same', as: 'shelf c1' } } });
    expect([same.createdLocations, same.changes.get('A')?.location]).toEqual([['Cart 2'], 'Shelf C1']);
  });

  it('new items become pending; ones already here or decided are skipped', () => {
    const pend = (id: string): PendingRecord => ({ id, name: 'Talon SRX', category: 'Electrical', subcategory: '', unit: 'each', onHand: 3, desired: 0, location: 'Bin Z', barcode: '', notes: '', countedAt: at('18:58'), vendor: null, hasPhoto: false, helperId: 'hp-MAYA1', helperName: MAYA });
    const f = file([], { newItems: [pend('pending-hp-MAYA1-1'), pend('pending-hp-MAYA1-2')] });
    const p = planImport(input([f], { knownPending: new Set(['pending-hp-MAYA1-2']) }));
    expect([p.pending.map((x) => x.id), p.pendingSkipped, p.createdLocations]).toEqual([['pending-hp-MAYA1-1'], 1, ['Bin Z']]);
  });

  it('unknown kit or helper: a warning, and counts still compare', () => {
    const p = planImport(input([file([count('C', 7, at('18:51'))], {}, { kitId: 'kit-OTHER' }), file([count('A', 1, at('18:52'))], { fileName: 'x.zip' }, { helperId: 'hp-GONE1', helperName: 'Gone' })]));
    expect(p.warnings.length).toBe(2);
    // An unknown kit: a count here can't be shown to be older than the kit, so a different number is a conflict.
    expect([row(p, 'C').kind, row(p, 'A').kind]).toEqual(['conflict', 'apply']);
  });

  it('several files give the same result in any order', () => {
    const files = [file([count('A', 3, at('18:50')), count('B', 4, at('19:00'))]), tabletFile([count('A', 5, at('18:55')), count('F', 2, at('18:56'))]), file([count('C', 1, at('19:10'))], { fileName: 'b.zip' }, { sequence: 2 })];
    const choose = (fs: CountsFile[]) => {
      const p = planImport(input(fs));
      return planImport(input(fs), newestChoices(p, noChoices()));
    };
    const a = choose(files);
    const b = choose([files[2]!, files[0]!, files[1]!]);
    expect([...b.changes].sort()).toEqual([...a.changes].sort());
    expect(b.rows.map((r) => [r.itemId, r.helperName, r.kind])).toEqual(a.rows.map((r) => [r.itemId, r.helperName, r.kind]));
  });

  it('the order total before and after', () => {
    const needed = items.map((i) => (i.id === 'A' ? { ...i, desired: 10 } : i));
    const p = planImport(input([file([count('A', 10, at('18:50'))])], { items: needed }));
    expect([p.totalBefore, p.totalAfter]).toEqual([10000, 0]);
  });
});

describe('likely duplicates and combining (§18.5)', () => {
  it('nearly the same name', () => {
    expect(similarNames('Victor SPX motor controller', 'victor-spx')).toBe(true);
    expect(similarNames('Victor SPX', 'Victor SPX')).toBe(true);
    expect(similarNames('Talon', 'Talon SRX')).toBe(true);
    expect(similarNames('NEO', 'NEO 550')).toBe(false);
    expect(similarNames('Talon SRX', 'Victor SPX')).toBe(false);
  });
  it('flags pending items with the same barcode or a similar name, against each other and existing items', () => {
    const p = (id: string, name: string, barcode = ''): PendingRecord => ({ id, name, category: 'Electrical', subcategory: '', unit: 'each', onHand: 1, desired: 0, location: '', barcode, notes: '', countedAt: '', vendor: null, hasPhoto: false, helperId: 'h', helperName: 'H' });
    const d = findDuplicates([p('p1', 'Victor SPX motor controller'), p('p2', 'Victor SPX'), p('p3', 'Gizmo', '111'), p('p4', 'Thing')], [item({ id: 'G', name: 'Bracket', barcode: '111' })]);
    expect(d.map((x) => [x.pendingId, x.other.id, x.why])).toEqual([['p1', 'p2', 'name'], ['p2', 'p1', 'name'], ['p3', 'G', 'barcode']]);
  });
});

describe('reading a counts file (§18.5 Check)', () => {
  it('a counts.csv with problems fails as a whole, with every reason', () => {
    const text = 'item_id,on_hand,counted_at,location,barcode,outside_assignment\nA,-1,2026-10-28T18:00:00-05:00,,,\nA,2,,,,\n,1,2026-10-28T18:00:00-05:00,,,maybe\nB,,2026-10-28T18:00:00-05:00,,,\nC,,,,,\n';
    const r = parseCountsCsv(text);
    // Row 5 has two: a time without a count, and nothing changed.
    expect(r.problems.map((p) => p.row)).toEqual([2, 3, 3, 4, 4, 5, 5, 6]);
  });
  it('a date-only counted_at (an older file) is midnight local time', () => {
    const r = parseCountsCsv('item_id,on_hand,counted_at,location,barcode,outside_assignment\nA,2,2026-11-01,,,\n');
    expect([r.problems, r.counts[0]!.countedAt]).toEqual([[], '2026-11-01T00:00:00-05:00']);
  });
  it('pending-items.csv: desired left blank is 0; notes keep their line breaks; the helper id comes from the pending id', () => {
    const text = 'pending_id,name,category,unit,on_hand,desired,counted_at,notes,helper_name\npending-hp-AB2CD-4,Victor SPX,Electrical,each,2,,2026-10-28T18:58:00-05:00,"a, b\nc",Maya\n';
    const r = parsePendingCsv(text, 'pending-items.csv', null);
    expect([r.problems, r.items.map((p) => [p.desired, p.notes, p.helperId, p.helperName])]).toEqual([[], [[0, 'a, b\nc', 'hp-AB2CD', 'Maya']]]);
  });

  it('missing columns', () => {
    expect(parseCountsCsv('item_id,on_hand\nA,1\n').problems[0]!.message).toMatch(/missing columns: counted_at, location, barcode, outside_assignment/);
  });
  it('kits, backups, a newer format and non-ZIP files are refused, saying where they go', async () => {
    const z = async (files: Record<string, string>) => {
      const zip = new JSZip();
      for (const [n, t] of Object.entries(files)) zip.file(n, t);
      return zip.generateAsync({ type: 'uint8array' });
    };
    expect(await readCountsFile('k.zip', await z({ 'kit.json': '{}', 'inventory.csv': '' }))).toMatchObject({ ok: false, problems: [expect.stringMatching(/count kit.*Join as a helper/)] });
    expect(await readCountsFile('b.zip', await z({ 'inventory.csv': '' }))).toMatchObject({ ok: false, problems: [expect.stringMatching(/More › Backup › Restore/)] });
    expect(await readCountsFile('n.zip', await z({ 'counts.json': JSON.stringify({ format: 'frc2408-counts', format_version: 2 }) }))).toMatchObject({ ok: false, newer: true, problems: [expect.stringMatching(/newer version.*Reload/)] });
    expect(await readCountsFile('x.zip', new Uint8Array([1, 2]))).toMatchObject({ ok: false, newer: false });
  });
  it('Restore refuses a counts file', async () => {
    const zip = new JSZip();
    zip.file('counts.json', '{}');
    zip.file('counts.csv', '');
    const r = await readRestoreFile({ name: 'counts-x.zip', bytes: await zip.generateAsync({ type: 'uint8array' }) }, { items: [], suppliers: [], locations: [], categories: [] });
    expect(r).toMatchObject({ ok: false, problems: [{ message: expect.stringMatching(/counts file.*Import counts/) }] });
  });
});

// ── With the database ──

let n = 0;
const open: Dexie[] = [];
async function tablet(): Promise<InventoryDb> {
  const db = new InventoryDb(`import-test-${++n}`);
  open.push(db);
  await db.items.bulkAdd(items.map((i) => toItemRow(i, 1)));
  await db.suppliers.bulkAdd([{ name: 'REV', website: '', notes: '' }, { name: 'other', website: '', notes: '' }].map(toSupplierRow));
  await db.locations.bulkAdd(locations.map(toLocationRow));
  await db.categories.bulkAdd([{ name: 'Electrical', order: 0, subcategories: [] }, { name: 'Fasteners', order: 1, subcategories: [] }]);
  await db.helpers.bulkAdd(helpers.map(toHelperRow));
  return db;
}
afterEach(async () => {
  for (const db of open.splice(0)) {
    db.close();
    await Dexie.delete(db.name);
  }
});
const all = async (db: InventoryDb) => (await db.items.toArray()).map(fromItemRow).sort((a, b) => a.id.localeCompare(b.id));
const strip = (xs: Awaited<ReturnType<typeof all>>) => xs.map(({ ...i }) => i);
const jpeg = (k: number) => new Blob([new Uint8Array([0xff, 0xd8, k, 0xff, 0xd9])], { type: 'image/jpeg' });
const at = (hm: string) => `2026-10-28T${hm}:00-05:00`;

describe('Apply, Undo (§18.5)', () => {
  const pend = (id: string, over: Partial<PendingRecord> = {}): PendingRecord => ({ id, name: 'Talon SRX, old', category: 'Electrical', subcategory: '', unit: 'each', onHand: 3, desired: 0, location: 'Bin Z', barcode: '', notes: 'a, b\nc', countedAt: at('18:58'), vendor: null, hasPhoto: true, helperId: 'hp-MAYA1', helperName: MAYA, ...over });
  const theFile = () => file([count('A', 4, at('18:50'), { location: 'Bin Z' }), count('C', 6, at('18:51'), { barcode: '999' }), count('H', 2, at('18:52'), { outside: true })], { newItems: [pend('pending-hp-MAYA1-1')], newLocations: ['Bin Z'], photos: new Map([['pending-hp-MAYA1-1', jpeg(7)]]) });

  it('saves everything together, records the undo, sets counted_by and last_import_at', async () => {
    const db = await tablet();
    const s = await applyImport(db, [theFile()], noChoices(), 5000);
    expect([s.applied, s.skipped, s.outside, s.newItems, s.locationsAdded, s.helperNames]).toEqual([3, 0, 1, 1, 1, [MAYA]]);
    const a = fromItemRow((await db.items.get('A'))!);
    expect([a.onHand, a.lastCounted, a.countedBy, a.location]).toEqual([4, at('18:50'), MAYA, 'Bin Z']);
    expect((await db.items.get('C'))!.barcode).toBe('999');
    expect((await db.locations.orderBy('order').toArray()).map((l) => [l.name, l.order])).toEqual([['Bin A', 0], ['Shelf C1', 1], ['Bin Z', 2]]);
    expect((await loadPending(db)).map((p) => [p.id, p.notes, p.hasPhoto])).toEqual([['pending-hp-MAYA1-1', 'a, b\nc', true]]);
    expect([...(new Uint8Array(await (await pendingPhoto(db, 'pending-hp-MAYA1-1'))!.arrayBuffer()))]).toEqual([0xff, 0xd8, 7, 0xff, 0xd9]);
    expect((await db.helpers.get('hp-MAYA1'))!.lastImportAt).toBe(5000);
    expect((await getImportUndo(db))?.fileNames).toEqual([theFile().fileName]);
  });

  it('importing the same file twice changes nothing the second time', async () => {
    const db = await tablet();
    await applyImport(db, [theFile()], noChoices(), 5000);
    const after1 = await all(db);
    const pending1 = await loadPending(db);
    const plan = await previewImport(db, [theFile()]);
    expect([plan.changes.size, plan.pending.length, plan.createdLocations, plan.counts.applied]).toEqual([0, 0, [], 3]);
    await applyImport(db, [theFile()], noChoices(), 6000);
    expect(strip(await all(db))).toEqual(strip(after1));
    expect(await loadPending(db)).toEqual(pending1);
  });

  it('several files together give the same result in any order (with the database)', async () => {
    const files = [file([count('A', 3, at('18:50')), count('B', 4, at('19:00'))]), tabletFile([count('A', 5, at('18:55')), count('F', 2, at('18:56'))])];
    const run = async (fs: CountsFile[]) => {
      const db = await tablet();
      const p = await previewImport(db, fs);
      await applyImport(db, fs, newestChoices(p, noChoices()), 5000);
      return (await all(db)).map((i) => [i.id, i.onHand, i.lastCounted, i.countedBy]);
    };
    expect(await run([files[1]!, files[0]!])).toEqual(await run(files));
  });

  it('Apply is refused while a conflict has no choice, and nothing is saved', async () => {
    const db = await tablet();
    const before = await all(db);
    await expect(applyImport(db, [file([count('B', 4, at('18:52')), count('A', 2, at('18:53'))])], noChoices(), 5000)).rejects.toThrow(/conflict/);
    expect([strip(await all(db)), await getImportUndo(db)]).toEqual([strip(before), null]);
  });

  it('Undo puts every changed field back exactly and removes the locations and pending items it added', async () => {
    const db = await tablet();
    const before = await all(db);
    await applyImport(db, [theFile()], noChoices(), 5000);
    const r = await undoImport(db, 6000);
    expect(r).toEqual({ items: 3, pending: 1, locations: 1 });
    expect((await all(db)).map(({ ...i }) => i)).toEqual(before);
    expect([await loadPending(db), await db.pendingPhotos.count(), (await db.locations.toArray()).map((l) => l.name).sort(), await getImportUndo(db)]).toEqual([[], 0, ['Bin A', 'Shelf C1'], null]);
    expect((await db.helpers.get('hp-MAYA1'))!.lastImportAt).toBe(null);
  });

  it('Undo keeps a location an item now uses, and items already accepted from pending', async () => {
    const db = await tablet();
    await applyImport(db, [theFile()], noChoices(), 5000);
    // An item added after the import uses the new location; the pending item is accepted.
    await addItem(db, item({ id: 'tm-NEW01', name: 'Talon SRX, old', category: 'Electrical', location: 'Bin Z' }), 5500, undefined, { pendingId: 'pending-hp-MAYA1-1' });
    const r = await undoImport(db, 6000);
    expect([r.locations, r.pending]).toEqual([0, 0]);
    expect((await db.locations.toArray()).map((l) => l.name)).toContain('Bin Z');
    expect(await db.items.get('tm-NEW01')).toBeTruthy();
  });

  it('an import after a restore can’t undo across the restore', async () => {
    const db = await tablet();
    await applyImport(db, [theFile()], noChoices(), 5000);
    const backup = await buildBackup(db, 'full', new Date(2026, 9, 28, 19, 30));
    const plan = await readRestoreFile({ name: 'b.zip', bytes: new Uint8Array(await backup.arrayBuffer()) }, { items: [], suppliers: [], locations: [], categories: [] });
    if (!plan.ok) throw new Error(JSON.stringify(plan.problems));
    await applyRestore(db, plan.plan, 5600);
    expect(await getImportUndo(db)).toBe(null);
    const restored = await all(db);
    await applyImport(db, [tabletFile([count('F', 9, at('19:40'))])], noChoices(), 6000);
    await undoImport(db, 6100);
    expect(strip(await all(db))).toEqual(strip(restored));
  });

  it('imported counts follow the count round rule (F24)', async () => {
    const db = await tablet();
    await applyImport(db, [file([count('A', 1, '2026-10-27T23:50:00-05:00'), count('H', 1, '2026-10-28T08:00:00-05:00')])], noChoices(), 5000);
    const [a, h] = [fromItemRow((await db.items.get('A'))!), fromItemRow((await db.items.get('H'))!)];
    expect([isCounted(a, '2026-10-28'), isCounted(h, '2026-10-28')]).toEqual([false, true]);
  });
});

describe('pending items: review (§18.5)', () => {
  const pend = (id: string, over: Partial<PendingRecord> = {}): PendingRecord => ({ id, name: 'Victor SPX', category: 'Electrical', subcategory: '', unit: 'each', onHand: 2, desired: 0, location: '', barcode: '', notes: '', countedAt: at('18:58'), vendor: null, hasPhoto: false, helperId: 'hp-MAYA1', helperName: MAYA, ...over });
  const withPending = async () => {
    const db = await tablet();
    await applyImport(db, [file([], { newItems: [pend('pending-hp-MAYA1-1'), pend('pending-hp-MAYA1-2', { name: 'Victor SPX motor controller', onHand: 3, hasPhoto: true, countedAt: at('19:01') })], photos: new Map([['pending-hp-MAYA1-2', jpeg(2)]]) })], noChoices(), 5000);
    return db;
  };

  it('accept: a real item with the helper’s count time and name; the pending item goes, and doesn’t come back on re-import', async () => {
    const db = await withPending();
    const saved = await addItem(db, item({ id: 'tm-ACC01', name: 'Victor SPX', category: 'Electrical', onHand: 2, lastCounted: 'x', countedBy: '' }), 6000, undefined, { pendingId: 'pending-hp-MAYA1-1' });
    expect([saved.lastCounted, saved.countedBy]).toEqual([at('18:58'), MAYA]);
    expect((await loadPending(db)).map((p) => p.id)).toEqual(['pending-hp-MAYA1-2']);
    const again = await previewImport(db, [file([], { newItems: [pend('pending-hp-MAYA1-1')] })]);
    expect([again.pending, again.pendingSkipped]).toEqual([[], 1]);
  });

  it('same as an existing item: use as the count, or add to it', async () => {
    const db = await withPending();
    await matchPending(db, 'pending-hp-MAYA1-1', 'C', 'use', 6000);
    expect(fromItemRow((await db.items.get('C'))!)).toMatchObject({ onHand: 2, lastCounted: at('18:58'), countedBy: MAYA });
    await matchPending(db, 'pending-hp-MAYA1-2', 'C', 'add', 6100);
    expect(fromItemRow((await db.items.get('C'))!)).toMatchObject({ onHand: 5, lastCounted: at('19:01'), countedBy: MAYA });
    expect(await loadPending(db)).toEqual([]);
  });

  it('combine: counts added, the photo carried over, the other removed; discard', async () => {
    const db = await withPending();
    const merged = await combinePendingItems(db, 'pending-hp-MAYA1-1', 'pending-hp-MAYA1-2', 'add');
    expect([merged.onHand, merged.hasPhoto, merged.countedAt]).toEqual([5, true, at('19:01')]);
    expect((await loadPending(db)).map((p) => p.id)).toEqual(['pending-hp-MAYA1-1']);
    expect(await pendingPhoto(db, 'pending-hp-MAYA1-1')).toBeTruthy();
    await discardPending(db, 'pending-hp-MAYA1-1');
    expect(await loadPending(db)).toEqual([]);
    await expect(discardPending(db, 'pending-hp-MAYA1-1')).rejects.toThrow(/already/);
  });

  it('combine keeping one leaves its count alone', async () => {
    const db = await withPending();
    expect((await combinePendingItems(db, 'pending-hp-MAYA1-2', 'pending-hp-MAYA1-1', 'keep')).onHand).toBe(3);
  });

  it('full backups carry pending items and their photos; a full restore replaces them, a CSV restore keeps them', async () => {
    const db = await withPending();
    const blob = await buildBackup(db, 'full', new Date(2026, 9, 28, 19, 30));
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    expect(Object.keys(zip.files).filter((f) => f.includes('pending'))).toEqual(['pending-items.csv', 'photos/pending-hp-MAYA1-2.jpg']);
    const read = await readRestoreFile({ name: 'b.zip', bytes: new Uint8Array(await blob.arrayBuffer()) }, { items: [], suppliers: [], locations: [], categories: [] });
    if (!read.ok) throw new Error(JSON.stringify(read.problems));
    expect(read.plan.pending?.map((p) => [p.id, p.name, p.onHand, p.helperName, p.helperId, p.hasPhoto])).toEqual([
      ['pending-hp-MAYA1-1', 'Victor SPX', 2, MAYA, 'hp-MAYA1', false],
      ['pending-hp-MAYA1-2', 'Victor SPX motor controller', 3, MAYA, 'hp-MAYA1', true],
    ]);
    await discardPending(db, 'pending-hp-MAYA1-1');
    await applyRestore(db, read.plan, 7000);
    expect((await loadPending(db)).length).toBe(2);
    expect([...new Uint8Array(await (await pendingPhoto(db, 'pending-hp-MAYA1-2'))!.arrayBuffer())]).toEqual([0xff, 0xd8, 2, 0xff, 0xd9]);
    const csv = await buildBackup(db, 'data', new Date());
    const csvPlan = await readRestoreFile({ name: 'd.csv', bytes: new Uint8Array(await csv.arrayBuffer()) }, { items: [], suppliers: [], locations: [], categories: [] });
    if (!csvPlan.ok) throw new Error('csv');
    await applyRestore(db, csvPlan.plan, 8000);
    expect((await loadPending(db)).length).toBe(2);
  });

  it('a backup with no pending items has no pending-items.csv', async () => {
    const db = await tablet();
    const zip = await JSZip.loadAsync(await (await buildBackup(db, 'full', new Date())).arrayBuffer());
    expect(zip.file('pending-items.csv')).toBe(null);
  });
});

describe('kit → helper → counts file → import (§18.6 round trip)', () => {
  it('counts, a new location, a new item with a photo and notes with commas and line breaks', async () => {
    const main = await tablet();
    const kitBlob = await buildCountKit({
      snapshot: { items: (await all(main)), suppliers: [{ name: 'REV', website: '', notes: '' }, { name: 'other', website: '', notes: '' }], locations, categories: [{ name: 'Electrical', order: 0, subcategories: [] }, { name: 'Fasteners', order: 1, subcategories: [] }] },
      photos: new Map(),
      helper: helpers[0]!,
      kitId: 'kit-MAYA0001',
      createdAt: KIT_AT,
      includePhotos: false,
      now: new Date(2026, 9, 28, 18, 0),
    });
    const kit = await readCountKit(new Uint8Array(await kitBlob.arrayBuffer()));
    if (!kit.ok) throw new Error(kit.problems.join('; '));
    const h = new HelperDb(`round-helper-${++n}`);
    open.push(h);
    await joinKit(h, kit.read, 1000);
    await addLocation(h, 'Bin Q', '', 1100);
    await saveCount(h, 'A', 6, 'Bin Q', at('18:30'), 1200);
    await saveCount(h, 'H', 2, undefined, at('18:31'), 1300);
    await setBarcode(h, 'C', '4455', 1400);
    await addPendingItem(h, (id, countedAt) => ({ id, name: 'Talon SRX', category: 'Electrical', subcategory: 'Controllers', unit: 'each', onHand: 2, desired: 1, location: 'Bin Q', barcode: '777', notes: 'red bin, top\nleft side', countedAt, vendor: { supplier: 'REV', partNo: 'X, 1', url: '', packSize: 1, packPriceCents: 4500 }, hasPhoto: false }), { full: jpeg(5), thumb: null }, 1500, at('18:40'));
    const st = (await loadHelperState(h))!;
    const blob = await buildCountsFile({ kit: st.kit, sequence: 1, createdAt: at('19:00'), changes: st.changes, items: await helperItems(h), pending: st.pending, pendingPhotos: await helperPhotos(h), now: new Date(2026, 9, 28, 19, 0) });

    const read = await readCountsFile('counts-maya.zip', new Uint8Array(await blob.arrayBuffer()));
    if (!read.ok) throw new Error(read.problems.join('; '));
    const plan = await previewImport(main, [read.file]);
    expect([plan.warnings, plan.counts, plan.createdLocations]).toEqual([[], { apply: 2, same: 0, conflicts: 0, conflictsLeft: 0, applied: 0, unknown: 0, outside: 1 }, ['Bin Q']]);
    await applyImport(main, [read.file], noChoices(), 9000);
    const got = (await all(main)).filter((i) => ['A', 'C', 'H'].includes(i.id)).map((i) => [i.id, i.onHand, i.lastCounted, i.countedBy, i.location, i.barcode]);
    expect(got).toEqual([
      ['A', 6, at('18:30'), MAYA, 'Bin Q', ''],
      ['C', 5, '2026-10-28T17:00:00-05:00', '', '', '4455'],
      ['H', 2, at('18:31'), MAYA, '', ''],
    ]);
    const p = (await loadPending(main))[0]!;
    expect([p.id, p.name, p.subcategory, p.notes, p.location, p.barcode, p.desired, p.vendor, p.countedAt, p.helperName, p.hasPhoto]).toEqual(['pending-hp-MAYA1-1', 'Talon SRX', 'Controllers', 'red bin, top\nleft side', 'Bin Q', '777', 1, { supplier: 'REV', partNo: 'X, 1', url: '', packSize: 1, packPriceCents: 4500 }, at('18:40'), MAYA, true]);
    expect([...new Uint8Array(await (await pendingPhoto(main, p.id))!.arrayBuffer())]).toEqual([0xff, 0xd8, 5, 0xff, 0xd9]);
  });
});
