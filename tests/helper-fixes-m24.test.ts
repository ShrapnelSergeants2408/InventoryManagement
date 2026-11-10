// M24 (SPEC v0.19): a device id in every counts file and new-item numbers that never repeat
// (one kit on two devices, a second kit for the same helper); the "saved to Downloads, not
// sent" state on a helper; the app's own address for the Helper devices QR code.
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { saveCount } from '../src/data/count';
import { InventoryDb, toHelperRow, toItemRow, toLocationRow, toSupplierRow } from '../src/data/db';
import { HelperDb, addPendingItem, confirmSent, getDeviceId, getSent, helperItems, joinKit, loadHelperState, markSent, pendingPhotos } from '../src/data/helper-db';
import { applyImport, getImportUndo, previewImport, undoImport } from '../src/data/import-counts';
import { loadPending } from '../src/data/pending';
import type { Helper } from '../src/domain/helpers';
import { PENDING_BLOCK, newHelperDevice, type PendingItem } from '../src/domain/helper-mode';
import { kitDevices, noChoices, planImport, type CountsFile } from '../src/domain/import-counts';
import { appAddress } from '../src/domain/url';
import { buildCountKit, buildCountsFile, readCountKit, type ReadKit } from '../src/io/count-kit';
import { readCountsFile } from '../src/io/counts-file';
import { helperIdOf } from '../src/io/pending-csv';
import { item } from './helpers';

const KIT_AT = '2026-11-10T15:00:00-06:00';
const at = (hm: string) => `2026-11-10T${hm}:00-06:00`;
const categories = [{ name: 'Electrical', order: 0, subcategories: [] }];
const suppliers = [{ name: 'REV', website: '', notes: '' }, { name: 'other', website: '', notes: '' }];
const items = [item({ id: 'A', name: 'Wire', category: 'Electrical' }), item({ id: 'B', name: 'Breaker', category: 'Electrical' })];
const maya = (over: Partial<Helper> = {}): Helper => ({ id: 'hp-MAYA1', name: 'Maya', kind: 'category', groups: ['Electrical'], allowNewItems: true, kits: [{ id: 'kit-ONE00001', createdAt: KIT_AT }], lastImportAt: null, created: 1, ...over });

let n = 0;
const open: Dexie[] = [];
afterEach(async () => {
  for (const db of open.splice(0)) {
    db.close();
    await Dexie.delete(db.name);
  }
});

async function tablet(helper = maya()): Promise<InventoryDb> {
  const db = new InventoryDb(`m24-tablet-${++n}`);
  open.push(db);
  await db.items.bulkAdd(items.map((i) => toItemRow(i, 1)));
  await db.suppliers.bulkAdd(suppliers.map(toSupplierRow));
  await db.locations.bulkAdd([{ name: 'Bin A', notes: '', order: 0 }].map(toLocationRow));
  await db.categories.bulkAdd(categories);
  await db.helpers.add(toHelperRow(helper));
  return db;
}

async function kit(kitId = 'kit-ONE00001'): Promise<ReadKit> {
  const blob = await buildCountKit({ snapshot: { items, suppliers, locations: [], categories }, photos: new Map(), helper: maya(), kitId, createdAt: KIT_AT, includePhotos: false, now: new Date(2026, 10, 10, 15, 0) });
  const r = await readCountKit(new Uint8Array(await blob.arrayBuffer()));
  if (!r.ok) throw new Error(r.problems.join('; '));
  return r.read;
}

/** A phone that opens the kit (with the app's own random device, unless one is given). */
async function phone(read: ReadKit, device?: { id: string; pendingBase: number }): Promise<HelperDb> {
  const db = new HelperDb(`m24-phone-${++n}`);
  open.push(db);
  if (device) await joinKit(db, read, 1000, device);
  else await joinKit(db, read, 1000);
  return db;
}

const newItem = (name: string, onHand: number) => (id: string, countedAt: string): PendingItem => ({ id, name, category: 'Electrical', subcategory: '', unit: 'each', onHand, desired: 0, location: '', barcode: '', notes: '', countedAt, vendor: null, hasPhoto: false });

/** The phone's counts file, as the shop tablet reads it. */
async function countsFile(db: HelperDb, fileName: string, sequence = 1): Promise<CountsFile> {
  const st = (await loadHelperState(db))!;
  const blob = await buildCountsFile({ kit: st.kit, deviceId: st.deviceId, sequence, createdAt: at('16:00'), changes: st.changes, items: await helperItems(db), pending: st.pending, pendingPhotos: await pendingPhotos(db), now: new Date(2026, 10, 10, 16, 0) });
  const r = await readCountsFile(fileName, new Uint8Array(await blob.arrayBuffer()));
  if (!r.ok) throw new Error(r.problems.join('; '));
  return r.file;
}

describe('a device id and a block of new-item numbers for every opened kit (§18.2, v0.19)', () => {
  it('newHelperDevice: a dev- id and a six-digit block, both from the random source', () => {
    expect(newHelperDevice(() => 0)).toEqual({ id: 'dev-22222', pendingBase: 100_000 * PENDING_BLOCK });
    expect(newHelperDevice(() => 0.999999)).toEqual({ id: 'dev-ZZZZZ', pendingBase: 999_999 * PENDING_BLOCK });
    const a = newHelperDevice();
    expect([/^dev-[2-9A-Z]{5}$/.test(a.id), a.pendingBase % PENDING_BLOCK, a.pendingBase >= 100_000 * PENDING_BLOCK, Number.isSafeInteger(a.pendingBase + PENDING_BLOCK)]).toEqual([true, 0, true, true]);
  });

  it('opening a kit stores the device id, numbers new items from the block, and puts the id in counts.json', async () => {
    const db = await phone(await kit(), { id: 'dev-PHNE1', pendingBase: 4_210_000 });
    expect(await getDeviceId(db)).toBe('dev-PHNE1');
    const a = await addPendingItem(db, newItem('Zip ties', 200), null, 2000, at('15:20'));
    const b = await addPendingItem(db, newItem('Fuse', 4), null, 2100, at('15:21'));
    expect([a.id, b.id]).toEqual(['pending-hp-MAYA1-4210001', 'pending-hp-MAYA1-4210002']);
    // The id still reads as this helper's, so a shop tablet on an older version accepts the file.
    expect(helperIdOf(a.id)).toBe('hp-MAYA1');
    const f = await countsFile(db, 'counts-maya.zip');
    expect([f.meta.deviceId, f.newItems.map((p) => p.id)]).toEqual(['dev-PHNE1', [a.id, b.id]]);
  });

  it('a second kit on the same device gets a new device id and new numbers', async () => {
    const db = await phone(await kit());
    const first = [await getDeviceId(db), (await addPendingItem(db, newItem('Zip ties', 200), null, 2000, at('15:20'))).id];
    await joinKit(db, await kit('kit-TWO00002'), 3000);
    const second = [await getDeviceId(db), (await addPendingItem(db, newItem('Fuse', 4), null, 3100, at('15:40'))).id];
    expect(second[0]).not.toBe(first[0]);
    expect(second[1]).not.toBe(first[1]);
  });

  it('a counts file from before v0.19 (no device_id) is read with a blank device', async () => {
    const db = await phone(await kit());
    await db.settings.delete('helperDevice');
    expect((await countsFile(db, 'old.zip')).meta.deviceId).toBe('');
  });
});

describe('one kit opened on two devices (§18.5, v0.19)', () => {
  it('both devices’ new items arrive, and the preview warns', async () => {
    const read = await kit();
    const [p1, p2] = [await phone(read), await phone(read)];
    await saveCount(p1, 'A', 5, undefined, at('15:10'), 2000);
    await addPendingItem(p1, newItem('Zip ties', 200), null, 2100, at('15:20'));
    await saveCount(p2, 'A', 3, undefined, at('15:30'), 2000);
    await addPendingItem(p2, newItem('Fuse', 4), null, 2100, at('15:35'));
    const files = [await countsFile(p1, 'counts-maya-1.zip'), await countsFile(p2, 'counts-maya-2.zip')];

    const db = await tablet();
    const plan = await previewImport(db, files);
    expect(plan.pending.map((p) => p.name).sort()).toEqual(['Fuse', 'Zip ties']);
    expect(plan.pendingSkipped).toBe(0);
    expect(plan.warnings).toEqual([expect.stringMatching(/count kit for “Maya” was opened on 2 devices/)]);
    // Counts are unchanged from v0.18: the newest of each item is used.
    expect([plan.counts.conflicts, plan.changes.get('A')?.onHand]).toEqual([0, 3]);

    await applyImport(db, files, noChoices(), 5000);
    expect((await loadPending(db)).map((p) => p.name).sort()).toEqual(['Fuse', 'Zip ties']);
  });

  it('one device, one kit: no warning, in one import or over several', async () => {
    const p1 = await phone(await kit());
    await saveCount(p1, 'A', 5, undefined, at('15:10'), 2000);
    const first = await countsFile(p1, 'counts-1.zip', 1);
    await saveCount(p1, 'B', 2, undefined, at('15:40'), 3000);
    const second = await countsFile(p1, 'counts-2.zip', 2);
    const db = await tablet();
    expect((await previewImport(db, [first, second])).warnings).toEqual([]);
    await applyImport(db, [first], noChoices(), 5000);
    expect((await previewImport(db, [second])).warnings).toEqual([]);
  });

  it('the devices are remembered on the helper, so a second device is noticed in a later import; Undo forgets them again', async () => {
    const read = await kit();
    const p1 = await phone(read, { id: 'dev-PHNE1', pendingBase: 10_000 });
    const p2 = await phone(read, { id: 'dev-PHNE2', pendingBase: 20_000 });
    await saveCount(p1, 'A', 5, undefined, at('15:10'), 2000);
    await saveCount(p2, 'B', 3, undefined, at('15:30'), 2000);
    const [f1, f2] = [await countsFile(p1, 'counts-1.zip'), await countsFile(p2, 'counts-2.zip')];

    const db = await tablet();
    await applyImport(db, [f1], noChoices(), 5000);
    expect((await db.helpers.get('hp-MAYA1'))!.devices).toEqual({ 'kit-ONE00001': ['dev-PHNE1'] });
    expect((await previewImport(db, [f2])).warnings).toEqual([expect.stringMatching(/opened on 2 devices/)]);

    await applyImport(db, [f2], noChoices(), 6000);
    expect((await db.helpers.get('hp-MAYA1'))!.devices).toEqual({ 'kit-ONE00001': ['dev-PHNE1', 'dev-PHNE2'] });
    await undoImport(db, 7000);
    expect((await db.helpers.get('hp-MAYA1'))!.devices).toEqual({ 'kit-ONE00001': ['dev-PHNE1'] });
    expect(await getImportUndo(db)).toBe(null);
  });

  it('Undo of the first such import leaves the helper with no devices field, as before', async () => {
    const p1 = await phone(await kit(), { id: 'dev-PHNE1', pendingBase: 10_000 });
    await saveCount(p1, 'A', 5, undefined, at('15:10'), 2000);
    const db = await tablet();
    const before = await db.helpers.get('hp-MAYA1');
    await applyImport(db, [await countsFile(p1, 'counts-1.zip')], noChoices(), 5000);
    await undoImport(db, 6000);
    expect(await db.helpers.get('hp-MAYA1')).toEqual(before);
  });

  it('files without a device id (older helpers) never warn and record nothing', async () => {
    const meta = { kitId: 'kit-ONE00001', helperId: 'hp-MAYA1', helperName: 'Maya', createdAt: at('16:00'), sequence: 1, appVersion: '1.0.0' };
    const old = (fileName: string): CountsFile => ({ fileName, meta, counts: [{ itemId: 'A', onHand: 5, countedAt: at('15:10'), location: '', barcode: '', outside: false }], newItems: [], newLocations: [], photos: new Map() });
    expect(planImport({ files: [old('a.zip'), old('b.zip')], items, locations: [], helpers: [maya()], knownPending: new Set() }).warnings).toEqual([]);
    expect(kitDevices([old('a.zip')], [maya()]).map((k) => [...k.devices])).toEqual([[]]);
    const db = await tablet();
    await applyImport(db, [old('a.zip')], noChoices(), 5000);
    expect((await db.helpers.get('hp-MAYA1'))!.devices).toBeUndefined();
  });

  it('an unknown helper’s files are compared with each other', () => {
    const f = (fileName: string, deviceId: string): CountsFile => ({ fileName, meta: { kitId: 'kit-X', helperId: 'hp-GONE1', helperName: 'Old phone', createdAt: at('16:00'), sequence: 1, appVersion: '1.1.0', deviceId }, counts: [], newItems: [], newLocations: [], photos: new Map() });
    const plan = planImport({ files: [f('a.zip', 'dev-AAAAA'), f('b.zip', 'dev-BBBBB')], items, locations: [], helpers: [], knownPending: new Set() });
    expect(plan.warnings.filter((w) => /opened on 2 devices/.test(w))).toEqual([expect.stringContaining('“Old phone”')]);
  });
});

describe('a second kit for the same helper (§18.3, v0.19)', () => {
  it('its new items are not taken for the first kit’s', async () => {
    const db = await tablet(maya({ kits: [{ id: 'kit-ONE00001', createdAt: KIT_AT }, { id: 'kit-TWO00002', createdAt: at('15:30') }] }));
    const p = await phone(await kit('kit-ONE00001'));
    await addPendingItem(p, newItem('Zip ties', 200), null, 2000, at('15:20'));
    await applyImport(db, [await countsFile(p, 'counts-1.zip')], noChoices(), 5000);

    await joinKit(p, await kit('kit-TWO00002'), 6000);
    await addPendingItem(p, newItem('Fuse', 4), null, 6100, at('15:40'));
    const plan = await previewImport(db, [await countsFile(p, 'counts-2.zip')]);
    expect([plan.pending.map((x) => x.name), plan.pendingSkipped, plan.warnings]).toEqual([['Fuse'], 0, []]);
  });
});

describe('saved to Downloads is not sent (§18.4, v0.19)', () => {
  it('a download is remembered until confirmed; a share, or the next send, clears it', async () => {
    const db = await phone(await kit());
    await saveCount(db, 'A', 5, undefined, at('15:10'), 2000);
    await markSent(db, 1, 2500, 'counts-maya-2026-11-10-1600.zip');
    expect(await getSent(db)).toEqual({ at: 2500, sequence: 1, saved: 'counts-maya-2026-11-10-1600.zip' });
    const st = (await loadHelperState(db))!;
    expect([st.unsent, st.sent.saved]).toEqual([0, 'counts-maya-2026-11-10-1600.zip']);

    await confirmSent(db);
    expect(await getSent(db)).toEqual({ at: 2500, sequence: 1 });
    expect('saved' in (await getSent(db))).toBe(false);

    await markSent(db, 2, 3000, 'counts-again.zip');
    await markSent(db, 3, 3500);
    expect(await getSent(db)).toEqual({ at: 3500, sequence: 3 });
  });

  it('opening another kit forgets it', async () => {
    const db = await phone(await kit());
    await markSent(db, 1, 2500, 'counts-maya.zip');
    await joinKit(db, await kit('kit-TWO00002'), 3000);
    expect(await getSent(db)).toEqual({ at: null, sequence: 0 });
  });
});

describe('the app’s address for the Helper devices QR code (§18.1, v0.19)', () => {
  it.each([
    ['https://team2408.com/InventoryManagement/#/helpers', 'https://team2408.com/InventoryManagement/'],
    ['https://team2408.com/InventoryManagement/index.html?x=1#/count', 'https://team2408.com/InventoryManagement/'],
    ['http://localhost:5173/', 'http://localhost:5173/'],
    ['https://example.org', 'https://example.org/'],
    ['file:///C:/app/index.html', ''],
    ['not an address', ''],
  ])('%s → %s', (href, want) => {
    expect(appAddress(href)).toBe(want);
  });
});
