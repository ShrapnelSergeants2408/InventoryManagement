// Helper mode on a helper device (SPEC §18.2–§18.4); stage6-plan M16b tests: the counts file
// (cumulative, latest values only, blank means unchanged, sequence number), new-item
// validation, pending ids, the unsent-changes count, kit format refusal, and Leave helper mode
// deleting only the helper database.
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import JSZip from 'jszip';
import Papa from 'papaparse';
import { afterEach, describe, expect, it } from 'vitest';
import { saveCount } from '../src/data/count';
import { InventoryDb, toItemRow } from '../src/data/db';
import {
  HelperDb,
  addPendingItem,
  existingDatabases,
  getSent,
  helperItems,
  joinKit,
  leaveHelperMode,
  loadHelperState,
  markSent,
  pendingPhotos,
} from '../src/data/helper-db';
import { setBarcode } from '../src/data/items';
import { addLocation } from '../src/data/lists';
import type { Helper } from '../src/domain/helpers';
import {
  KIT_FORMAT,
  blankPendingDraft,
  checkKitJson,
  checkPendingItem,
  countsRows,
  helperBarText,
  inAssignment,
  mergeItemChange,
  pendingId,
  sendSummary,
  unsentChanges,
  type HelperChange,
  type HelperKit,
  type PendingContext,
  type PendingDraft,
} from '../src/domain/helper-mode';
import { NO_LOCATION } from '../src/domain/lists';
import { APP_VERSION } from '../src/io/backup';
import { buildCountKit, buildCountsFile, countsFileName, readCountKit } from '../src/io/count-kit';
import { item, vendor } from './helpers';

const STAMP = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d[+-]\d\d:\d\d$/;

const categories = [
  { name: 'Electrical', order: 0, subcategories: ['Motors', 'Wiring'] },
  { name: 'Fasteners', order: 1, subcategories: ['Bolts'] },
];
const locations = [{ name: 'Bin A', notes: '', order: 0 }];
const suppliers = [
  { name: 'REV', website: '', notes: '' },
  { name: 'other', website: '', notes: '' },
];
const items = [
  item({ id: 'st-0001', name: 'NEO motor', category: 'Electrical', subcategory: 'Motors', location: 'Bin A', onHand: 2, lastCounted: '2026-10-20T10:00:00-05:00', notes: 'use with "swerve", not tank\nsecond line' }),
  item({ id: 'st-0002', name: 'Wire 18 AWG', category: 'Electrical', subcategory: 'Wiring', unit: 'ft' }),
  item({ id: 'st-0003', name: '10-32 bolt', category: 'Fasteners', subcategory: 'Bolts', barcode: '0123456789' }),
];

const helper = (over: Partial<Helper> = {}): Helper => ({
  id: 'hp-AAAAA',
  name: 'Maya’s phone',
  kind: 'category',
  groups: ['Electrical'],
  allowNewItems: true,
  kits: [],
  lastImportAt: null,
  created: 1,
  ...over,
});

const jpeg = (n: number) => new Blob([new Uint8Array([0xff, 0xd8, n, 0xff, 0xd9])], { type: 'image/jpeg' });

async function kitBytes(over: Partial<Helper> = {}, includePhotos = true): Promise<Uint8Array> {
  const blob = await buildCountKit({
    snapshot: { items, suppliers, locations, categories },
    photos: new Map([['st-0001', jpeg(1)]]),
    helper: helper(over),
    kitId: 'kit-TESTKIT1',
    createdAt: '2026-10-28T18:00:00-05:00',
    includePhotos,
    now: new Date(2026, 9, 28, 18, 0),
  });
  return new Uint8Array(await blob.arrayBuffer());
}

let n = 0;
const open: Dexie[] = [];
async function joined(over: Partial<Helper> = {}): Promise<HelperDb> {
  const db = new HelperDb(`helper-test-${++n}`);
  open.push(db);
  const read = await readCountKit(await kitBytes(over));
  if (!read.ok) throw new Error(read.problems.join('; '));
  await joinKit(db, read.read, 1000);
  return db;
}

afterEach(async () => {
  for (const db of open.splice(0)) {
    db.close();
    await Dexie.delete(db.name);
  }
});

const kitInfo = (over: Partial<HelperKit> = {}): HelperKit => ({
  kitId: 'kit-1',
  helperId: 'hp-AAAAA',
  helperName: 'Maya’s phone',
  createdAt: '2026-10-28T18:00:00-05:00',
  appVersion: '0.4.0',
  kind: 'category',
  groups: ['Electrical'],
  allowNewItems: true,
  ...over,
});

describe('kit.json check (§18.2, §18.7)', () => {
  const good = { format: KIT_FORMAT, format_version: 1, kit_id: 'kit-1', helper_id: 'hp-1', helper_name: ' Maya ', created_at: '2026-10-28T18:00:00-05:00', app_version: '0.4.0', groups: { kind: 'location', names: ['Bin A', NO_LOCATION] }, allow_new_items: false };

  it('reads a kit from this app', () => {
    expect(checkKitJson(good)).toEqual({
      ok: true,
      kit: { kitId: 'kit-1', helperId: 'hp-1', helperName: 'Maya', createdAt: good.created_at, appVersion: '0.4.0', kind: 'location', groups: ['Bin A', NO_LOCATION], allowNewItems: false },
    });
  });

  it('refuses a newer kit format and says to reload', () => {
    const r = checkKitJson({ ...good, format_version: 2 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.newer).toBe(true);
    expect(r.message).toMatch(/newer version of the app\. Reload the app/);
  });

  it('accepts the current format version exactly', () => {
    expect(checkKitJson({ ...good, format_version: 1 }).ok).toBe(true);
  });

  it.each([
    ['not an object', null],
    ['another format', { ...good, format: 'frc2408-counts' }],
    ['no version', { ...good, format_version: undefined }],
    ['version 0', { ...good, format_version: 0 }],
    ['a fractional version', { ...good, format_version: 1.5 }],
    ['no kit id', { ...good, kit_id: '' }],
    ['no helper id', { ...good, helper_id: '' }],
    ['a blank helper name', { ...good, helper_name: '  ' }],
    ['no date', { ...good, created_at: 5 }],
    ['a mixed group kind', { ...good, groups: { kind: 'both', names: [] } }],
    ['group names not text', { ...good, groups: { kind: 'category', names: [1] } }],
  ])('refuses %s (not as newer)', (_why, raw) => {
    const r = checkKitJson(raw);
    expect(r).toMatchObject({ ok: false, newer: false });
  });

  it('allow_new_items is on unless the kit says false', () => {
    const { allow_new_items: _a, ...rest } = good;
    const r = checkKitJson(rest);
    expect(r.ok && r.kit.allowNewItems).toBe(true);
  });
});

describe('the assignment (§18.3)', () => {
  it('categories match ignoring capitals', () => {
    expect(inAssignment({ category: 'electrical', location: '' }, kitInfo())).toBe(true);
    expect(inAssignment({ category: 'Fasteners', location: '' }, kitInfo())).toBe(false);
  });
  it('locations, with a blank location in "No location"', () => {
    const k = kitInfo({ kind: 'location', groups: ['Bin A', NO_LOCATION] });
    expect(inAssignment({ category: 'Fasteners', location: 'bin a' }, k)).toBe(true);
    expect(inAssignment({ category: 'Fasteners', location: '' }, k)).toBe(true);
    expect(inAssignment({ category: 'Electrical', location: 'Shelf C' }, k)).toBe(false);
    expect(inAssignment({ category: 'Electrical', location: '' }, kitInfo({ kind: 'location', groups: ['Bin A'] }))).toBe(false);
  });
  it('the helper bar: name and groups', () => {
    expect(helperBarText(kitInfo())).toBe('Maya’s phone · Electrical');
    expect(helperBarText(kitInfo({ groups: ['A', 'B', 'C'] }))).toBe('Maya’s phone · 3 categories');
    expect(helperBarText(kitInfo({ kind: 'location', groups: ['A', 'B'] }))).toBe('Maya’s phone · 2 locations');
  });
});

describe('changes and the unsent count (§18.4)', () => {
  it('a later change keeps earlier flags and the first change’s outside flag', () => {
    const a = mergeItemChange(null, { itemId: 'x', counted: true, outside: true }, 10);
    expect(a).toEqual({ kind: 'item', itemId: 'x', counted: true, location: false, barcode: false, outside: true, changedAt: 10 });
    const b = mergeItemChange(a, { itemId: 'x', barcode: true, outside: false }, 20);
    expect(b).toEqual({ kind: 'item', itemId: 'x', counted: true, location: false, barcode: true, outside: true, changedAt: 20 });
    const c = mergeItemChange(b, { itemId: 'x', location: true, outside: false }, 30);
    expect(c).toEqual({ kind: 'item', itemId: 'x', counted: true, location: true, barcode: true, outside: true, changedAt: 30 });
    expect(mergeItemChange(c, { itemId: 'x', outside: false }, 40)).toEqual({ ...c, changedAt: 40 });
  });

  it('counts changes after the last send; all of them before the first', () => {
    const c = [{ changedAt: 5 }, { changedAt: 10 }, { changedAt: 11 }];
    expect(unsentChanges(c, null)).toBe(3);
    expect(unsentChanges(c, 10)).toBe(1);
    expect(unsentChanges(c, 11)).toBe(0);
    expect(unsentChanges([], null)).toBe(0);
  });

  it('pending ids are pending-<helper id>-<n>', () => {
    expect(pendingId('hp-AAAAA', 1)).toBe('pending-hp-AAAAA-1');
    expect(pendingId('hp-AAAAA', 12)).toBe('pending-hp-AAAAA-12');
  });
});

describe('counts.csv rows (§18.4)', () => {
  const byId = new Map(
    [
      item({ id: 'b', onHand: 7, lastCounted: '2026-10-28T18:30:00-05:00', location: 'Bin A', barcode: '999' }),
      item({ id: 'a', onHand: 3, lastCounted: '2026-10-28T18:10:00-05:00', location: 'Shelf', barcode: '111' }),
      item({ id: 'c', onHand: 0, location: 'Bin Z', barcode: '222', lastCounted: '2026-10-01T09:00:00-05:00' }),
    ].map((i) => [i.id, i]),
  );
  const changes: HelperChange[] = [
    { kind: 'item', itemId: 'gone', counted: true, location: false, barcode: false, outside: false, changedAt: 0 },
    { kind: 'item', itemId: 'b', counted: true, location: false, barcode: false, outside: false, changedAt: 1 },
    { kind: 'item', itemId: 'a', counted: true, location: true, barcode: false, outside: true, changedAt: 2 },
    { kind: 'item', itemId: 'c', counted: false, location: false, barcode: true, outside: false, changedAt: 3 },
    { kind: 'location', name: 'Bin Z', changedAt: 5 },
  ];

  it('latest values from the item; blank where not changed; item-id order; only items', () => {
    expect(countsRows(changes, byId)).toEqual([
      { item_id: 'a', on_hand: '3', counted_at: '2026-10-28T18:10:00-05:00', location: 'Shelf', barcode: '', outside_assignment: 'yes' },
      { item_id: 'b', on_hand: '7', counted_at: '2026-10-28T18:30:00-05:00', location: '', barcode: '', outside_assignment: '' },
      { item_id: 'c', on_hand: '', counted_at: '', location: '', barcode: '222', outside_assignment: '' },
    ]);
  });

  it('the Send screen summary', () => {
    expect(sendSummary([...changes, { kind: 'pending', pendingId: 'p', changedAt: 9 }])).toEqual({ counted: 3, locationChanges: 1, barcodes: 1, newLocations: 1, newItems: 1, outside: 1 });
  });
});

describe('Add item not on the list: checks (§18.3)', () => {
  const ctx: PendingContext = {
    id: 'pending-hp-AAAAA-1',
    countedAt: '2026-10-28T18:40:00-05:00',
    categories,
    locations,
    supplierNames: suppliers.map((s) => s.name),
    items,
  };
  const d = (over: Partial<PendingDraft> = {}): PendingDraft => ({ ...blankPendingDraft('Electrical'), name: 'Talon SRX', onHand: '3', ...over });

  it('the four required fields', () => {
    const r = checkPendingItem({ ...blankPendingDraft(''), unit: ' ' }, ctx);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(Object.keys(r.errors).sort()).toEqual(['category', 'name', 'onHand', 'unit']);
    expect(r.errors.onHand).toBe('On hand is required: how many are here?');
  });

  it('only the required fields: desired 0, no vendor, the lists’ spelling', () => {
    expect(checkPendingItem(d({ category: 'electrical', name: '  Talon SRX ' }), ctx)).toEqual({
      ok: true,
      item: { id: ctx.id, name: 'Talon SRX', category: 'Electrical', subcategory: '', unit: 'each', onHand: 3, desired: 0, location: '', barcode: '', notes: '', countedAt: ctx.countedAt, vendor: null, hasPhoto: false },
    });
  });

  it('every optional field', () => {
    const r = checkPendingItem(
      d({ subcategory: 'motors', location: 'bin a', barcode: ' 7 22 ', notes: ' a, b\nc ', desired: '4', supplier: 'rev', partNo: ' am-1 ', url: 'andymark.com/x', packSize: '2', price: '12.5' }),
      ctx,
    );
    expect(r.ok && r.item).toEqual({
      id: ctx.id,
      name: 'Talon SRX',
      category: 'Electrical',
      subcategory: 'Motors',
      unit: 'each',
      onHand: 3,
      desired: 4,
      location: 'Bin A',
      barcode: '722',
      notes: 'a, b\nc',
      countedAt: ctx.countedAt,
      vendor: { supplier: 'REV', partNo: 'am-1', url: 'https://andymark.com/x', packSize: 2, packPriceCents: 1250 },
      hasPhoto: false,
    });
  });

  it('desired left blank is 0', () => {
    expect(checkPendingItem(d({ desired: ' ' }), ctx)).toMatchObject({ ok: true, item: { desired: 0 } });
  });

  it('a new subcategory is kept as typed; one that exists takes its spelling', () => {
    expect(checkPendingItem(d({ newSubcategory: ' Controllers ' }), ctx)).toMatchObject({ ok: true, item: { subcategory: 'Controllers' } });
    expect(checkPendingItem(d({ newSubcategory: 'WIRING' }), ctx)).toMatchObject({ ok: true, item: { subcategory: 'Wiring' } });
    expect(checkPendingItem(d({ newSubcategory: ' ' }), ctx)).toMatchObject({ ok: false, errors: { newSubcategory: expect.any(String) } });
  });

  it.each<[string, Partial<PendingDraft>, string]>([
    ['a negative count', { onHand: '-1' }, 'onHand'],
    ['a fraction', { onHand: '1.5' }, 'onHand'],
    ['a bad desired', { desired: 'lots' }, 'desired'],
    ['an unknown subcategory', { subcategory: 'Gears' }, 'subcategory'],
    ['an unknown location', { location: 'Bin Q' }, 'location'],
    ['a team label as barcode', { barcode: '2408:st-0001' }, 'barcode'],
    ['a barcode already on an item', { barcode: '0123456789' }, 'barcode'],
    ['vendor fields without a supplier', { partNo: 'X1' }, 'supplier'],
    ['a supplier not in the list', { supplier: 'Acme' }, 'supplier'],
    ['pack size 0', { supplier: 'REV', packSize: '0' }, 'packSize'],
    ['a bad price', { supplier: 'REV', price: 'ten' }, 'price'],
    ['a bad link', { supplier: 'REV', url: 'not a link' }, 'url'],
  ])('refuses %s', (_why, over, field) => {
    const r = checkPendingItem(d(over), ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors)).toEqual([field]);
  });

  it('pack size left blank with a supplier is 1', () => {
    expect(checkPendingItem(d({ supplier: 'REV', packSize: '' }), ctx)).toMatchObject({ ok: true, item: { vendor: { packSize: 1, packPriceCents: null } } });
  });
});

describe('opening a kit on the helper (§18.2)', () => {
  it('copies the kit: items not counted yet on the helper, lists, photos, no prices', async () => {
    const db = await joined();
    const state = await loadHelperState(db);
    expect(state?.kit).toMatchObject({ kitId: 'kit-TESTKIT1', helperId: 'hp-AAAAA', helperName: 'Maya’s phone', kind: 'category', groups: ['Electrical'], allowNewItems: true, appVersion: APP_VERSION });
    expect(state?.changes).toEqual([]);
    expect(state?.unsent).toBe(0);
    const all = [...(await helperItems(db)).values()];
    expect(all.map((i) => i.id).sort()).toEqual(['st-0001', 'st-0002', 'st-0003']);
    expect(all.every((i) => i.lastCounted === '' && i.countedBy === '')).toBe(true);
    expect(all.every((i) => i.vendors.every((v) => v === null || v.packPriceCents === null))).toBe(true);
    expect((await helperItems(db)).get('st-0001')?.notes).toBe('use with "swerve", not tank\nsecond line');
    expect(await db.photos.count()).toBe(1);
    expect((await db.categories.toArray()).map((c) => c.name)).toEqual(['Electrical', 'Fasteners']);
    expect((await db.locations.toArray()).map((l) => l.name)).toEqual(['Bin A']);
  });

  it('refuses a newer kit with “reload”', async () => {
    const zip = await JSZip.loadAsync(await kitBytes());
    const kit = JSON.parse(await zip.file('kit.json')!.async('string'));
    zip.file('kit.json', JSON.stringify({ ...kit, format_version: 99 }));
    const r = await readCountKit(await zip.generateAsync({ type: 'uint8array' }));
    expect(r).toMatchObject({ ok: false, newer: true, problems: [expect.stringMatching(/Reload the app/)] });
  });

  it('refuses a backup, a counts file and a non-ZIP, saying where each goes', async () => {
    const backup = new JSZip();
    backup.file('inventory.csv', 'id,name\n');
    expect(await readCountKit(await backup.generateAsync({ type: 'uint8array' }))).toMatchObject({ ok: false, newer: false, problems: [expect.stringMatching(/inventory backup, not a count kit/)] });
    const counts = new JSZip();
    counts.file('counts.json', '{}');
    expect(await readCountKit(await counts.generateAsync({ type: 'uint8array' }))).toMatchObject({ ok: false, problems: [expect.stringMatching(/Import counts/)] });
    expect(await readCountKit(new Uint8Array([1, 2, 3]))).toMatchObject({ ok: false, problems: [expect.stringMatching(/isn’t a count kit/)] });
  });

  it('opening another kit replaces everything, earlier changes and pending items too', async () => {
    const db = await joined();
    await saveCount(db, 'st-0002', 5, undefined, '2026-10-28T18:10:00-05:00', 2000);
    await addPendingItem(db, (id, at) => ({ ...pendingBase, id, countedAt: at }), { full: jpeg(3), thumb: null }, 2100);
    const read = await readCountKit(await kitBytes({ id: 'hp-BBBBB', name: 'Tablet 2', groups: ['Fasteners'] }));
    if (!read.ok) throw new Error('kit');
    await joinKit(db, read.read, 3000);
    const state = await loadHelperState(db);
    expect([state?.kit.helperName, state?.changes, state?.pending, await db.pendingPhotos.count(), (await helperItems(db)).get('st-0002')?.onHand, await getSent(db)]).toEqual([
      'Tablet 2',
      [],
      [],
      0,
      0,
      { at: null, sequence: 0 },
    ]);
  });
});

const pendingBase = {
  id: '',
  name: 'Talon SRX, "old" model',
  category: 'Electrical',
  subcategory: 'Controllers',
  unit: 'each',
  onHand: 3,
  desired: 0,
  location: '',
  barcode: '',
  notes: 'found in\nthe red bin, top',
  countedAt: '',
  vendor: null,
  hasPhoto: false,
};

describe('counting on the helper records every change (§18.3, §18.4)', () => {
  it('a count, a location, a barcode, a new location; outside the groups is flagged', async () => {
    const db = await joined();
    await saveCount(db, 'st-0002', 40, undefined, '2026-10-28T18:10:00-05:00', 2000);
    await saveCount(db, 'st-0003', 6, undefined, '2026-10-28T18:12:00-05:00', 2100);
    await addLocation(db, 'Bin B', '', 2200);
    await saveCount(db, 'st-0002', 42, 'Bin B', '2026-10-28T18:20:00-05:00', 2300);
    await setBarcode(db, 'st-0001', '555', 2400);
    const state = (await loadHelperState(db))!;
    expect(state.changes.sort((a, b) => a.changedAt - b.changedAt)).toEqual([
      { kind: 'item', itemId: 'st-0003', counted: true, location: false, barcode: false, outside: true, changedAt: 2100 },
      { kind: 'location', name: 'Bin B', changedAt: 2200 },
      { kind: 'item', itemId: 'st-0002', counted: true, location: true, barcode: false, outside: false, changedAt: 2300 },
      { kind: 'item', itemId: 'st-0001', counted: false, location: false, barcode: true, outside: false, changedAt: 2400 },
    ]);
    expect(state.unsent).toBe(4);
  });

  it('picking the location the item already has is not a location change', async () => {
    const db = await joined();
    await saveCount(db, 'st-0001', 3, 'Bin A', '2026-10-28T18:10:00-05:00', 2000);
    expect((await loadHelperState(db))!.changes).toEqual([{ kind: 'item', itemId: 'st-0001', counted: true, location: false, barcode: false, outside: false, changedAt: 2000 }]);
  });

  it('on the main tablet nothing is recorded (no changes table at all)', async () => {
    const main = new InventoryDb(`main-test-${++n}`);
    open.push(main);
    await main.items.add(toItemRow(item({ id: 'st-0001', category: 'Electrical' }), 1));
    await main.suppliers.add({ name: 'REV', website: '', notes: '', key: 'rev' });
    await saveCount(main, 'st-0001', 4, undefined, '2026-10-28T18:10:00-05:00', 2000);
    expect((await main.items.get('st-0001'))?.onHand).toBe(4);
    expect(main.tables.map((t) => t.name)).not.toContain('changes');
  });

  it('sending: the count since the last send, and the sequence number', async () => {
    const db = await joined();
    await saveCount(db, 'st-0002', 1, undefined, undefined, 2000);
    await markSent(db, 1, 2500);
    expect((await loadHelperState(db))!.unsent).toBe(0);
    await saveCount(db, 'st-0002', 2, undefined, undefined, 2600);
    await saveCount(db, 'st-0001', 2, undefined, undefined, 2700);
    expect((await loadHelperState(db))!.unsent).toBe(2);
    expect(await getSent(db)).toEqual({ at: 2500, sequence: 1 });
  });
});

describe('pending items on the helper (§18.3)', () => {
  it('numbered from 1 for this helper, with the photo, counted as a change', async () => {
    const db = await joined();
    const a = await addPendingItem(db, (id, at) => ({ ...pendingBase, id, countedAt: at }), { full: jpeg(7), thumb: null }, 2000, '2026-10-28T18:40:00-05:00');
    const b = await addPendingItem(db, (id, at) => ({ ...pendingBase, name: 'Victor SPX', id, countedAt: at }), null, 2100, '2026-10-28T18:41:00-05:00');
    expect([a.id, a.hasPhoto, b.id, b.hasPhoto]).toEqual(['pending-hp-AAAAA-1', true, 'pending-hp-AAAAA-2', false]);
    const state = (await loadHelperState(db))!;
    expect(state.pending.map((p) => p.id).sort()).toEqual(['pending-hp-AAAAA-1', 'pending-hp-AAAAA-2']);
    expect(state.unsent).toBe(2);
    expect([...(await pendingPhotos(db)).keys()]).toEqual(['pending-hp-AAAAA-1']);
    expect(await db.pendingItems.get('pending-hp-AAAAA-1')).toMatchObject({ helperId: 'hp-AAAAA', helperName: 'Maya’s phone', countedAt: '2026-10-28T18:40:00-05:00' });
  });

  it('refused when the kit doesn’t allow new items, and nothing is saved', async () => {
    const db = await joined({ allowNewItems: false });
    await expect(addPendingItem(db, (id, at) => ({ ...pendingBase, id, countedAt: at }), null, 2000)).rejects.toThrow(/doesn’t allow/);
    expect([await db.pendingItems.count(), (await loadHelperState(db))!.unsent]).toEqual([0, 0]);
  });
});

describe('the counts file (§18.4)', () => {
  async function read(blob: Blob) {
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const csv = async (name: string) => Papa.parse<Record<string, string>>((await zip.file(name)!.async('string')).replace(/^\uFEFF/, ''), { header: true, skipEmptyLines: true }).data;
    return {
      names: Object.keys(zip.files).sort(),
      json: JSON.parse(await zip.file('counts.json')!.async('string')),
      counts: await csv('counts.csv'),
      newItems: await csv('new-items.csv'),
      newLocations: await csv('locations-new.csv'),
      photo: zip.file('photos/pending-hp-AAAAA-1.jpg') ? await zip.file('photos/pending-hp-AAAAA-1.jpg')!.async('uint8array') : null,
    };
  }
  async function build(db: HelperDb, sequence: number) {
    const state = (await loadHelperState(db))!;
    return buildCountsFile({ kit: state.kit, sequence, createdAt: '2026-10-28T19:12:00-05:00', changes: state.changes, items: await helperItems(db), pending: state.pending, pendingPhotos: await pendingPhotos(db), now: new Date(2026, 9, 28, 19, 12) });
  }

  it('the whole file: counts.json, counts.csv, new items with photo, new locations', async () => {
    const db = await joined();
    await addLocation(db, 'Bin B', '', 1900);
    await saveCount(db, 'st-0002', 40, 'Bin B', '2026-10-28T18:10:00-05:00', 2000);
    await addPendingItem(db, (id, at) => ({ ...pendingBase, id, countedAt: at, location: 'Bin B', vendor: { supplier: 'REV', partNo: 'X, 1', url: '', packSize: 2, packPriceCents: 1999 } }), { full: jpeg(9), thumb: null }, 2100, '2026-10-28T18:40:00-05:00');
    const f = await read(await build(db, 1));
    expect(f.names).toEqual(['counts.csv', 'counts.json', 'locations-new.csv', 'new-items.csv', 'photos/', 'photos/pending-hp-AAAAA-1.jpg']);
    expect(f.json).toEqual({ format: 'frc2408-counts', format_version: 1, kit_id: 'kit-TESTKIT1', helper_id: 'hp-AAAAA', helper_name: 'Maya’s phone', created_at: '2026-10-28T19:12:00-05:00', sequence: 1, app_version: APP_VERSION });
    expect(f.counts).toEqual([{ item_id: 'st-0002', on_hand: '40', counted_at: '2026-10-28T18:10:00-05:00', location: 'Bin B', barcode: '', outside_assignment: '' }]);
    expect(f.newItems).toEqual([
      {
        pending_id: 'pending-hp-AAAAA-1',
        name: 'Talon SRX, "old" model',
        category: 'Electrical',
        subcategory: 'Controllers',
        unit: 'each',
        on_hand: '3',
        desired: '0',
        location: 'Bin B',
        barcode: '',
        notes: 'found in\nthe red bin, top',
        photo_file: 'photos/pending-hp-AAAAA-1.jpg',
        counted_at: '2026-10-28T18:40:00-05:00',
        v1_supplier: 'REV',
        v1_part_no: 'X, 1',
        v1_url: '',
        v1_pack_size: '2',
        v1_pack_price: '19.99',
      },
    ]);
    expect(f.newLocations).toEqual([{ name: 'Bin B' }]);
    expect([...f.photo!]).toEqual([0xff, 0xd8, 9, 0xff, 0xd9]);
  });

  it('cumulative, latest values only: a second file still has the first file’s counts, and a recount shows the new number', async () => {
    const db = await joined();
    await saveCount(db, 'st-0002', 40, undefined, '2026-10-28T18:10:00-05:00', 2000);
    await saveCount(db, 'st-0001', 3, undefined, '2026-10-28T18:11:00-05:00', 2100);
    const first = await read(await build(db, 1));
    await markSent(db, 1, 2200);
    await saveCount(db, 'st-0002', 41, undefined, '2026-10-28T18:30:00-05:00', 2300);
    const second = await read(await build(db, 2));
    expect(first.counts.map((r) => [r.item_id, r.on_hand])).toEqual([['st-0001', '3'], ['st-0002', '40']]);
    expect(second.counts.map((r) => [r.item_id, r.on_hand, r.counted_at])).toEqual([
      ['st-0001', '3', '2026-10-28T18:11:00-05:00'],
      ['st-0002', '41', '2026-10-28T18:30:00-05:00'],
    ]);
    expect(second.json.sequence).toBe(2);
  });

  it('nothing changed: the files are there with headers only', async () => {
    const db = await joined();
    const f = await read(await build(db, 1));
    expect([f.counts, f.newItems, f.newLocations, f.photo]).toEqual([[], [], [], null]);
  });

  it('a count saved now has a date-time with offset', async () => {
    const db = await joined();
    await saveCount(db, 'st-0002', 4);
    const f = await read(await build(db, 1));
    expect(f.counts[0]!.counted_at).toMatch(STAMP);
  });

  it('file name: counts-<helper name>-<date>-<time>.zip', () => {
    expect(countsFileName('Maya’s phone', new Date(2026, 9, 26, 19, 12))).toBe('counts-maya-s-phone-2026-10-26-1912.zip');
  });
});

describe('which databases this device has (F22, §18.7)', () => {
  it('reads the list without opening anything', async () => {
    const fake = { databases: async () => [{ name: 'frc2408-inventory', version: 30 }] } as unknown as IDBFactory;
    expect(await existingDatabases(fake)).toEqual({ inventory: true, helper: false });
    const both = { databases: async () => [{ name: 'frc2408-helper' }, { name: 'frc2408-inventory' }] } as unknown as IDBFactory;
    expect(await existingDatabases(both)).toEqual({ inventory: true, helper: true });
  });
});

describe('Leave helper mode (§18.2)', () => {
  it('deletes the helper database and nothing else', async () => {
    const main = new InventoryDb('frc2408-inventory');
    await main.items.add(toItemRow(item({ id: 'st-0001' }), 1));
    main.close();
    const db = new HelperDb('frc2408-helper');
    const read = await readCountKit(await kitBytes());
    if (!read.ok) throw new Error('kit');
    await joinKit(db, read.read, 1000);
    expect(await existingDatabases()).toEqual({ inventory: true, helper: true });

    await leaveHelperMode(db);
    expect(await existingDatabases()).toEqual({ inventory: true, helper: false });
    const again = new InventoryDb('frc2408-inventory');
    expect(await again.items.count()).toBe(1);
    again.close();
    await Dexie.delete('frc2408-inventory');
  });
});

describe('kit → helper → counts file round trip (§18.6)', () => {
  it('a kit with photos, counts, a new location and a new item with a photo and notes with commas and line breaks', async () => {
    const db = await joined();
    await addLocation(db, 'Shelf C', '', 1500);
    await saveCount(db, 'st-0001', 9, 'Shelf C', '2026-10-28T18:05:00-05:00', 1600);
    const check = checkPendingItem(
      { ...blankPendingDraft('Electrical'), name: 'Victor SPX', onHand: '2', notes: 'two, maybe three\nin the drawer', location: 'Shelf C' },
      { id: 'x', countedAt: 'y', categories: await db.categories.toArray(), locations: await db.locations.toArray(), supplierNames: ['REV'], items: [...(await helperItems(db)).values()] },
    );
    if (!check.ok) throw new Error(JSON.stringify(check.errors));
    await addPendingItem(db, (id, at) => ({ ...check.item, id, countedAt: at }), { full: jpeg(4), thumb: null }, 1700, '2026-10-28T18:45:00-05:00');
    const state = (await loadHelperState(db))!;
    const blob = await buildCountsFile({ kit: state.kit, sequence: 1, createdAt: '2026-10-28T19:00:00-05:00', changes: state.changes, items: await helperItems(db), pending: state.pending, pendingPhotos: await pendingPhotos(db), now: new Date() });
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const parse = async (n: string) => Papa.parse<Record<string, string>>((await zip.file(n)!.async('string')).replace(/^\uFEFF/, ''), { header: true, skipEmptyLines: true }).data;
    expect((await parse('counts.csv')).map((r) => [r.item_id, r.on_hand, r.location])).toEqual([['st-0001', '9', 'Shelf C']]);
    expect((await parse('new-items.csv')).map((r) => [r.pending_id, r.notes, r.location, r.photo_file])).toEqual([['pending-hp-AAAAA-1', 'two, maybe three\nin the drawer', 'Shelf C', 'photos/pending-hp-AAAAA-1.jpg']]);
    expect(await parse('locations-new.csv')).toEqual([{ name: 'Shelf C' }]);
    expect(JSON.parse(await zip.file('counts.json')!.async('string')).kit_id).toBe('kit-TESTKIT1');
  });

  it('a kit sent without photos opens with none', async () => {
    const db = new HelperDb(`helper-test-${++n}`);
    open.push(db);
    const read = await readCountKit(await kitBytes({}, false));
    if (!read.ok) throw new Error('kit');
    await joinKit(db, read.read, 1);
    expect([await db.photos.count(), (await db.items.toArray()).some((i) => i.hasPhoto)]).toEqual([0, false]);
  });
});


