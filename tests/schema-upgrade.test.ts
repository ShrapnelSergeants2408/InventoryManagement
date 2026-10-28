// The schema upgrades: v1 → v2 (M15), v2 → v3 (M16a) and v3 → v4 (M19), stage6-plan §3; Stage 5 findings 1
// and 6. A v1 or v2 database with real-shaped rows is opened by today's code: only the planned
// fields change (last_counted to a local date-time, counted_by added), everything else comes
// through byte-equal, the new tables are empty, and the guard keeps an older copy away from a
// newer database without writing anything. Tests run in America/Chicago (vite.config.ts).
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InventoryDb, SCHEMA_KEY, SCHEMA_VERSION, checkSchema, fromItemRow, toItemRow, upgradeItemToV3 } from '../src/data/db';
import { loadOrderLists } from '../src/data/order-lists';
import { countGroups, overallProgress } from '../src/domain/count';
import { canOfferReset, resetConfirmed, storageErrorName } from '../src/domain/storage-error';
import { item, vendor } from './helpers';

const opened: Dexie[] = [];
afterEach(() => {
  for (const d of opened.splice(0)) d.close();
});
const track = <T extends Dexie>(d: T) => (opened.push(d), d);

/** The schema exactly as `stage5-verified` and M11–M14 shipped it. */
const V1 = {
  items: 'id, category, location, barcode, *supplierKeys, lastCounted',
  photos: 'itemId',
  suppliers: 'key, name',
  locations: 'key, order',
  categories: 'name, order',
  settings: 'key',
};
/** What M15 and M15b added. */
const V2 = { orderLists: 'id, &key, *itemIds' };
/** What M16a adds (for the guard tests' "newer" databases). */
const V3 = { helpers: 'id, &key', pendingItems: 'id, helperId, barcode', pendingPhotos: 'pendingId', importUndo: 'id' };
/** What M19 adds: placed orders and receipts (§21.6). */
const V4 = { orders: 'id, supplierKey, placedOn, *itemIds', receipts: 'id, orderId' };
const NEW_TABLES = [...Object.keys(V3), ...Object.keys(V4)];

const bytes = (...b: number[]) => new Blob([new Uint8Array(b)], { type: 'image/jpeg' });

/** A date-only item row as v1 and v2 stored it: no counted_by field at all. */
function oldRow(over: Parameters<typeof item>[0]) {
  const { countedBy: _c, ...row } = toItemRow(item(over), 1_700_000_000_000);
  return row;
}

/**
 * Rows as a v1 tablet holds them: counted on each side of both 2026 DST changes (Mar 8 and
 * Nov 1, at 2 a.m.), never counted, photos, lists, settings.
 */
function v1Rows() {
  return {
    items: [
      oldRow({ id: 'st-0001', name: 'NEO 2.0', category: 'Electrical', lastCounted: '2026-03-07', onHand: 2, desired: 4, hasPhoto: true }),
      oldRow({ id: 'st-0002', name: 'Bolt ¼-20 × ¾"', category: 'Fasteners', lastCounted: '2026-03-08', notes: 'line one\nline, "two"' }),
      oldRow({ id: 'st-0003', name: 'Hex shaft', category: 'Fasteners', lastCounted: '2026-03-09' }),
      oldRow({ id: 'st-0004', name: 'Belt', category: 'Power Transfer', lastCounted: '2026-10-31', vendors: [vendor({ supplier: 'WCP', packPriceCents: null }), vendor(), null] }),
      oldRow({ id: 'st-0005', name: 'Pulley', category: 'Power Transfer', lastCounted: '2026-11-01' }),
      oldRow({ id: 'st-0006', name: 'Chain', category: 'Power Transfer', lastCounted: '2026-11-02' }),
      oldRow({ id: 'tm-ABCDE', name: 'Never counted', lastCounted: '', location: 'Bin F3' }),
    ],
    photos: [
      { itemId: 'st-0001', full: bytes(0xff, 0xd8, 1, 2, 3), thumb: bytes(9), updatedAt: 5, taken: 6 },
      { itemId: 'tm-ABCDE', full: bytes(0xff, 0xd8, 4), thumb: null, updatedAt: 7 },
    ],
    suppliers: [
      { key: 'rev', name: 'REV', website: 'https://revrobotics.com', notes: '' },
      { key: 'wcp', name: 'WCP', website: '', notes: 'n' },
      { key: 'other', name: 'other', website: '', notes: '' },
    ],
    locations: [{ key: 'bin f3', name: 'Bin F3', notes: '', order: 0 }],
    categories: [
      { name: 'Electrical', order: 0, subcategories: ['Motors'] },
      { name: 'Fasteners', order: 1, subcategories: [] },
      { name: 'Power Transfer', order: 2, subcategories: [] },
      { name: 'Motors', order: 3, subcategories: [] },
    ],
    settings: [
      { key: 'pinHash', value: { salt: 'abc', hash: 'def', iterations: 100000 } },
      { key: 'recoveryHash', value: { salt: 'x', hash: 'y', iterations: 100000 } },
      { key: 'countSince', value: '2026-10-01' },
      { key: 'lastBackupAt', value: 1_760_000_000_000 },
      { key: 'setupDoneAt', value: 1_750_000_000_000 },
    ],
  };
}

/** Local midnight with that day's offset, worked out by hand for Chicago (CST -06:00, CDT -05:00). */
const EXPECTED: Record<string, string> = {
  '2026-03-07': '2026-03-07T00:00:00-06:00',
  '2026-03-08': '2026-03-08T00:00:00-06:00', // DST starts at 2 a.m.: midnight is still CST
  '2026-03-09': '2026-03-09T00:00:00-05:00',
  '2026-10-31': '2026-10-31T00:00:00-05:00',
  '2026-11-01': '2026-11-01T00:00:00-05:00', // DST ends at 2 a.m.: midnight is still CDT
  '2026-11-02': '2026-11-02T00:00:00-06:00',
  '': '',
};

const ORDER_LIST = { id: 'ol-1', key: 'wcp order', name: 'WCP order', notes: 'n, "q"', created: 1, updated: 2, lines: [{ itemId: 'st-0004', quantity: 3 }], itemIds: ['st-0004'] };

async function makeOld(name: string, version: 1 | 2) {
  const old = new Dexie(name);
  old.version(1).stores(V1);
  if (version === 2) old.version(2).stores(V2);
  const rows: Record<string, object[]> = v1Rows();
  if (version === 2) rows.orderLists = [ORDER_LIST];
  await old.transaction('rw', old.tables, async () => {
    for (const [t, list] of Object.entries(rows)) await old.table(t).bulkAdd(list);
  });
  old.close();
}

async function dump(db: Dexie, table: string): Promise<unknown[]> {
  const rows = await db.table(table).toArray();
  return Promise.all(
    rows.map(async (r: Record<string, unknown>) => {
      const out: Record<string, unknown> = { ...r };
      for (const k of ['full', 'thumb']) if (r[k] instanceof Blob) out[k] = { type: (r[k] as Blob).type, bytes: [...new Uint8Array(await (r[k] as Blob).arrayBuffer())] };
      return out;
    }),
  );
}

/** Opens the old database as it is (no upgrade) and dumps every table. */
async function dumpAll(name: string, tables: string[]): Promise<Record<string, unknown[]>> {
  const before = track(new Dexie(name));
  await before.open();
  const out: Record<string, unknown[]> = {};
  for (const t of tables) out[t] = await dump(before, t);
  before.close();
  return out;
}

describe.each([1, 2] as const)('upgrade v%i → v4 (M16a, then M19)', (from) => {
  const tables = [...Object.keys(V1), ...(from === 2 ? Object.keys(V2) : [])];

  it('converts last_counted to local midnight on both sides of each DST change, adds counted_by, and changes nothing else', async () => {
    const name = `up${from}-${Math.random()}`;
    await makeOld(name, from);
    const before = await dumpAll(name, tables);

    const db = track(new InventoryDb(name));
    await db.open();
    expect(db.verno).toBe(4);

    // Items: exactly the two planned fields differ; the date-only value is gone.
    const after = (await dump(db, 'items')) as Array<Record<string, unknown>>;
    expect(after).toEqual(
      (before.items as Array<Record<string, unknown>>).map((r) => ({ ...r, lastCounted: EXPECTED[r.lastCounted as string], countedBy: '' })),
    );
    expect(after.map((r) => r.lastCounted)).toEqual(['2026-03-07T00:00:00-06:00', '2026-03-08T00:00:00-06:00', '2026-03-09T00:00:00-05:00', '2026-10-31T00:00:00-05:00', '2026-11-01T00:00:00-05:00', '2026-11-02T00:00:00-06:00', '']);

    // Every other table byte-equal, photos and order lists included.
    for (const t of tables) if (t !== 'items' && t !== 'settings') expect(await dump(db, t), t).toEqual(before[t]);
    for (const t of NEW_TABLES) expect(await db.table(t).count(), t).toBe(0);
    if (from === 2) expect((await loadOrderLists(db)).map((l) => l.name)).toEqual(['WCP order']);
    else expect(await loadOrderLists(db)).toEqual([]);

    // Settings: unchanged, plus the schema version once the app has checked it.
    expect(await checkSchema(db)).toBe('ok');
    const settings = (await dump(db, 'settings')) as { key: string }[];
    expect(settings.filter((s) => s.key !== SCHEMA_KEY)).toEqual(before.settings);
    expect(await db.settings.get(SCHEMA_KEY)).toEqual({ key: SCHEMA_KEY, value: 4 });
  });

  it('count rounds give the same progress after the upgrade as before (§19)', async () => {
    const name = `prog${from}-${Math.random()}`;
    await makeOld(name, from);
    const old = v1Rows();
    const beforeItems = old.items.map((r) => fromItemRow({ ...r, countedBy: '' }));
    const db = track(new InventoryDb(name));
    const afterItems = (await db.items.toArray()).map(fromItemRow);
    for (const since of ['', '2026-03-07', '2026-03-08', '2026-03-09', '2026-11-01', '2026-11-02', '2026-11-03']) {
      expect(overallProgress(afterItems, since), since).toEqual(overallProgress(beforeItems, since));
      expect(countGroups(afterItems, old.categories, [], 'category', false, since), since).toEqual(
        countGroups(beforeItems, old.categories, [], 'category', false, since).map((g) => ({ ...g, items: g.items.map((i) => afterItems.find((a) => a.id === i.id)) })),
      );
    }
  });
});

describe('upgrade v3 → v4 (M19)', () => {
  it('adds the empty orders and receipts tables and changes nothing else, byte for byte', async () => {
    const name = `up3-${Math.random()}`;
    await makeOld(name, 2);
    // Bring it to v3 the way M16a did, with helper-era rows in the v3 tables.
    const v3 = new Dexie(name);
    v3.version(1).stores(V1);
    v3.version(2).stores(V2);
    v3.version(3).stores(V3).upgrade((tx) => tx.table('items').toCollection().modify(upgradeItemToV3));
    await v3.open();
    await v3.table('helpers').add({ id: 'hp-AAAAA', key: 'maya', name: 'Maya', kind: 'category', groups: ['Fasteners'], allowNewItems: true, kits: [], lastImportAt: null, created: 1 });
    await v3.table('pendingItems').add({ id: 'pd-1', helperId: 'hp-AAAAA', barcode: '', name: 'Spacer' });
    await v3.table('pendingPhotos').add({ pendingId: 'pd-1', full: bytes(0xff, 0xd8, 7) });
    await v3.table('importUndo').add({ id: 'last', at: 5 });
    await v3.table('settings').put({ key: SCHEMA_KEY, value: 3 });
    v3.close();
    const tables = [...Object.keys(V1), ...Object.keys(V2), ...Object.keys(V3)];
    const before = await dumpAll(name, tables);

    const db = track(new InventoryDb(name));
    await db.open();
    expect(db.verno).toBe(4);
    for (const t of tables) if (t !== 'settings') expect(await dump(db, t), t).toEqual(before[t]);
    expect(await db.orders.count()).toBe(0);
    expect(await db.receipts.count()).toBe(0);
    expect(await checkSchema(db)).toBe('ok');
    const settings = (await dump(db, 'settings')) as { key: string }[];
    expect(settings.filter((s) => s.key !== SCHEMA_KEY)).toEqual((before.settings as { key: string }[]).filter((s) => s.key !== SCHEMA_KEY));
    expect((await db.settings.get(SCHEMA_KEY))!.value).toBe(4);
  });

  it('a v3 app finds a v4 database “outdated” and writes nothing', async () => {
    const name = `old3-${Math.random()}`;
    const db = track(new InventoryDb(name));
    await db.open();
    expect(await checkSchema(db)).toBe('ok');
    db.close();
    // The v3 app's own guard, as shipped in M16a–M18: schema 3, browser version up to 30.
    const v3app = track(new Dexie(name));
    await v3app.open();
    const stored = (await v3app.table('settings').get(SCHEMA_KEY))?.value as number;
    const native = v3app.backendDB().version;
    expect(stored > 3 || native / 10 > 3).toBe(true);
  });

  it('the multi-entry index finds every order an item is on, and the supplier key every order from a supplier', async () => {
    const db = track(new InventoryDb(`oix-${Math.random()}`));
    const o = { supplier: 'REV', placedOn: '2026-10-28', orderNo: '', payment: '', cancelled: false, taxCents: 0, shippingCents: 0, feesCents: 0, discount: { kind: '$' as const, value: 0 }, notes: '', fromList: '', receipts: [], created: 1, updated: 1 };
    const line = (itemId: string) => ({ itemId, description: itemId, partNo: '', unit: 'each', category: '', packs: 1, packSize: 1, packPriceCents: 100, received: 0 });
    await db.orders.add({ ...o, id: 'po-1', supplierKey: 'rev', itemIds: ['x', 'y'], lines: [line('x'), line('y'), line('')] });
    await db.orders.add({ ...o, id: 'po-2', supplier: 'WCP', supplierKey: 'wcp', itemIds: ['y'], lines: [line('y')] });
    expect((await db.orders.where('itemIds').equals('y').primaryKeys()).sort()).toEqual(['po-1', 'po-2']);
    expect(await db.orders.where('supplierKey').equals('rev').primaryKeys()).toEqual(['po-1']);
  });
});

describe('the v3 item change itself', () => {
  it('leaves a date-time and an existing counted_by as they are, and keeps blank blank', () => {
    const a = { lastCounted: '2026-10-24T18:42:07-05:00', countedBy: 'Maya' };
    upgradeItemToV3(a);
    expect(a).toEqual({ lastCounted: '2026-10-24T18:42:07-05:00', countedBy: 'Maya' });
    const b: { lastCounted: string; countedBy?: string } = { lastCounted: '' };
    upgradeItemToV3(b);
    expect(b).toEqual({ lastCounted: '', countedBy: '' });
    const c: { lastCounted: string; countedBy?: string } = { lastCounted: '2026-07-04' };
    upgradeItemToV3(c);
    expect(c).toEqual({ lastCounted: '2026-07-04T00:00:00-05:00', countedBy: '' });
    // Text the app never writes is left as it is rather than shifted to another day (independent review, finding 3).
    for (const odd of ['2026-02-30', '0050-13-01']) {
      const r: { lastCounted: string; countedBy?: string } = { lastCounted: odd };
      upgradeItemToV3(r);
      expect(r).toEqual({ lastCounted: odd, countedBy: '' });
    }
  });
});

describe('a new tablet', () => {
  it('starts at v4 with the schema version recorded', async () => {
    const db = track(new InventoryDb(`new-${Math.random()}`));
    await db.open();
    expect(db.verno).toBe(4);
    expect(await db.settings.get(SCHEMA_KEY)).toBeUndefined();
    expect(await checkSchema(db)).toBe('ok');
    expect((await db.settings.get(SCHEMA_KEY))!.value).toBe(4);
    expect(SCHEMA_VERSION).toBe(4);
  });

  it('the multi-entry index finds the lists an item is on', async () => {
    const db = track(new InventoryDb(`ix-${Math.random()}`));
    await db.orderLists.add({ id: 'ol-1', key: 'a', name: 'A', notes: '', created: 1, updated: 1, lines: [{ itemId: 'x', quantity: 1 }, { itemId: 'y', quantity: 2 }], itemIds: ['x', 'y'] });
    await db.orderLists.add({ id: 'ol-2', key: 'b', name: 'B', notes: '', created: 1, updated: 1, lines: [{ itemId: 'y', quantity: 1 }], itemIds: ['y'] });
    expect((await db.orderLists.where('itemIds').equals('y').primaryKeys()).sort()).toEqual(['ol-1', 'ol-2']);
    // Names are unique ignoring capitals (§3), enforced by the index too.
    await expect(db.orderLists.add({ id: 'ol-3', key: 'a', name: 'a', notes: '', created: 1, updated: 1, lines: [], itemIds: [] })).rejects.toThrow();
  });

  it('helper names are unique ignoring capitals, enforced by the index too', async () => {
    const db = track(new InventoryDb(`hx-${Math.random()}`));
    const h = { id: 'hp-AAAAA', key: 'maya', name: 'Maya', kind: 'category' as const, groups: ['Fasteners'], allowNewItems: true, kits: [], lastImportAt: null, created: 1 };
    await db.helpers.add(h);
    await expect(db.helpers.add({ ...h, id: 'hp-BBBBB', name: 'MAYA' })).rejects.toThrow();
  });
});

describe('schema guard (Stage 5 finding 6)', () => {
  async function newer(name: string, stored: number | null) {
    const d = new Dexie(name);
    d.version(1).stores(V1);
    d.version(2).stores(V2);
    d.version(3).stores(V3);
    d.version(4).stores(V4);
    d.version(5).stores({ somethingNew: 'id' });
    await d.open();
    if (stored !== null) await d.table('settings').put({ key: SCHEMA_KEY, value: stored });
    await d.table('items').put(toItemRow(item({ id: 'kept' }), 1));
    d.close();
  }

  it('a database at a newer version is “outdated”, and nothing is written', async () => {
    const name = `new4-${Math.random()}`;
    await newer(name, 5);
    const db = track(new InventoryDb(name));
    await db.open();
    const before = await dump(db, 'settings');
    expect(await checkSchema(db)).toBe('outdated');
    expect(await dump(db, 'settings')).toEqual(before);
    expect((await db.items.get('kept'))!.id).toBe('kept');
  });

  it('a newer stored schema version alone is enough (same browser version number)', async () => {
    const db = track(new InventoryDb(`st-${Math.random()}`));
    await db.settings.put({ key: SCHEMA_KEY, value: SCHEMA_VERSION + 1 });
    expect(await checkSchema(db)).toBe('outdated');
    expect((await db.settings.get(SCHEMA_KEY))!.value).toBe(SCHEMA_VERSION + 1);
  });

  it('a newer browser version number alone is enough (no stored setting)', async () => {
    const name = `nv-${Math.random()}`;
    await newer(name, null);
    const db = track(new InventoryDb(name));
    await db.open();
    expect(await checkSchema(db)).toBe('outdated');
    expect(await db.settings.get(SCHEMA_KEY)).toBeUndefined();
  });
});

describe('blocked upgrade (§3: never the "Set up again" path)', () => {
  it('raises "blocked" while an old connection holds v2, then opens once it closes', async () => {
    const name = `bl-${Math.random()}`;
    await makeOld(name, 2);
    // An old tab: a plain connection that ignores versionchange.
    const old: IDBDatabase = await new Promise((resolve, reject) => {
      const r = indexedDB.open(name, 20);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const db = track(new InventoryDb(name));
    const blocked = vi.fn();
    db.on('blocked', blocked);
    const opening = db.open();
    await vi.waitFor(() => expect(blocked).toHaveBeenCalled());
    old.close();
    await opening;
    expect(db.verno).toBe(4);
    expect(await db.items.count()).toBe(7);
    expect((await db.items.get('st-0002'))!.lastCounted).toBe('2026-03-08T00:00:00-06:00');
  });
});

describe('"Set up again" (Stage 5 finding 1)', () => {
  const err = (name: string) => Object.assign(new Error('x'), { name });
  const wrapped = (inner: string) => Object.assign(new Error('open failed'), { name: 'OpenFailedError', inner: err(inner) });

  it('is never offered on the first failure', () => {
    expect(canOfferReset(err('UnknownError'), 0)).toBe(false);
    expect(canOfferReset(err('UnknownError'), 1)).toBe(false);
    expect(canOfferReset(err('UnknownError'), 2)).toBe(true);
  });
  it('is never offered for errors that clear up by themselves, wrapped by Dexie or not', () => {
    for (const n of ['QuotaExceededError', 'AbortError', 'TimeoutError', 'DatabaseClosedError', 'VersionError']) {
      expect(canOfferReset(err(n), 5), n).toBe(false);
      expect(canOfferReset(wrapped(n), 5), n).toBe(false);
    }
    expect(storageErrorName(wrapped('QuotaExceededError'))).toBe('QuotaExceededError');
    expect(canOfferReset(wrapped('UnknownError'), 2)).toBe(true);
  });
  it('needs DELETE typed', () => {
    expect(resetConfirmed('delete ')).toBe(true);
    expect(resetConfirmed('DELET')).toBe(false);
    expect(resetConfirmed('')).toBe(false);
  });
});
