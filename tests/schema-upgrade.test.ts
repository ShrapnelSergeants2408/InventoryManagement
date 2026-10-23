// The first schema upgrade, v1 → v2 (stage6-plan §3; Stage 5 findings 1 and 6). A v1
// database with real-shaped rows is opened by today's code: every row comes through
// byte-equal, the new table is empty, and the guard keeps an older copy away from a newer
// database without writing anything.
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InventoryDb, SCHEMA_KEY, SCHEMA_VERSION, checkSchema, toItemRow } from '../src/data/db';
import { loadOrderLists } from '../src/data/order-lists';
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

const bytes = (...b: number[]) => new Blob([new Uint8Array(b)], { type: 'image/jpeg' });

/** Rows as a v1 tablet holds them: counted on each side of the DST changes, never counted, photos, lists, settings. */
function v1Rows() {
  const items = [
    item({ id: 'st-0001', name: 'NEO 2.0', category: 'Electrical', lastCounted: '2026-03-07', onHand: 2, desired: 4, hasPhoto: true }),
    item({ id: 'st-0002', name: 'Bolt ¼-20 × ¾"', category: 'Fasteners', lastCounted: '2026-03-08', notes: 'line one\nline, "two"' }),
    item({ id: 'st-0003', name: 'Belt', category: 'Power Transfer', lastCounted: '2026-11-01', vendors: [vendor({ supplier: 'WCP', packPriceCents: null }), vendor(), null] }),
    item({ id: 'tm-ABCDE', name: 'Never counted', lastCounted: '', location: 'Bin F3' }),
  ].map((i) => toItemRow(i, 1_700_000_000_000));
  return {
    items,
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

async function makeV1(name: string) {
  const old = new Dexie(name);
  old.version(1).stores(V1);
  const rows = v1Rows();
  await old.transaction('rw', old.tables, async () => {
    for (const [t, list] of Object.entries(rows)) await old.table(t).bulkAdd(list as object[]);
  });
  old.close();
  return rows;
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

describe('upgrade v1 → v2 (M15)', () => {
  it('keeps every v1 row byte-equal, photos included, and adds an empty orderLists table', async () => {
    const name = `up-${Math.random()}`;
    await makeV1(name);
    const before = track(new Dexie(name));
    await before.open();
    const snapshot: Record<string, unknown[]> = {};
    for (const t of Object.keys(V1)) snapshot[t] = await dump(before, t);
    before.close();

    const db = track(new InventoryDb(name));
    await db.open();
    expect(db.verno).toBe(2);
    for (const t of Object.keys(V1)) {
      if (t === 'settings') continue;
      expect(await dump(db, t), t).toEqual(snapshot[t]);
    }
    // Dates stay date-only in v2: the date-time conversion is v3 (M16a).
    expect((await db.items.get('st-0002'))!.lastCounted).toBe('2026-03-08');
    expect(await db.orderLists.count()).toBe(0);
    expect(await loadOrderLists(db)).toEqual([]);

    // Settings: unchanged, plus the schema version once the app has checked it.
    expect(await checkSchema(db)).toBe('ok');
    const settings = (await dump(db, 'settings')) as { key: string }[];
    expect(settings.filter((s) => s.key !== SCHEMA_KEY)).toEqual(snapshot.settings);
    expect(await db.settings.get(SCHEMA_KEY)).toEqual({ key: SCHEMA_KEY, value: SCHEMA_VERSION });
  });

  it('a new tablet starts at v2 with the schema version recorded', async () => {
    const db = track(new InventoryDb(`new-${Math.random()}`));
    await db.open();
    expect(await db.settings.get(SCHEMA_KEY)).toBeUndefined();
    expect(await checkSchema(db)).toBe('ok');
    expect((await db.settings.get(SCHEMA_KEY))!.value).toBe(2);
  });

  it('the multi-entry index finds the lists an item is on', async () => {
    const db = track(new InventoryDb(`ix-${Math.random()}`));
    await db.orderLists.add({ id: 'ol-1', key: 'a', name: 'A', notes: '', created: 1, updated: 1, lines: [{ itemId: 'x', quantity: 1 }, { itemId: 'y', quantity: 2 }], itemIds: ['x', 'y'] });
    await db.orderLists.add({ id: 'ol-2', key: 'b', name: 'B', notes: '', created: 1, updated: 1, lines: [{ itemId: 'y', quantity: 1 }], itemIds: ['y'] });
    expect((await db.orderLists.where('itemIds').equals('y').primaryKeys()).sort()).toEqual(['ol-1', 'ol-2']);
    // Names are unique ignoring capitals (§3), enforced by the index too.
    await expect(db.orderLists.add({ id: 'ol-3', key: 'a', name: 'a', notes: '', created: 1, updated: 1, lines: [], itemIds: [] })).rejects.toThrow();
  });
});

describe('schema guard (Stage 5 finding 6)', () => {
  it('a database at a newer version is “outdated”, and nothing is written', async () => {
    const name = `new3-${Math.random()}`;
    const newer = new Dexie(name);
    newer.version(1).stores(V1);
    newer.version(2).stores({ orderLists: 'id, &key, *itemIds' });
    newer.version(3).stores({ helpers: 'id, key' });
    await newer.open();
    await newer.table('settings').put({ key: SCHEMA_KEY, value: 3 });
    await newer.table('items').put(toItemRow(item({ id: 'kept' }), 1));
    newer.close();

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
    const newer = new Dexie(name);
    newer.version(1).stores(V1);
    newer.version(2).stores({ orderLists: 'id, &key, *itemIds' });
    newer.version(3).stores({ helpers: 'id, key' });
    await newer.open();
    newer.close();
    const db = track(new InventoryDb(name));
    await db.open();
    expect(await checkSchema(db)).toBe('outdated');
    expect(await db.settings.get(SCHEMA_KEY)).toBeUndefined();
  });
});

describe('blocked upgrade (§3: never the "Set up again" path)', () => {
  it('raises "blocked" while an old connection holds v1, then opens once it closes', async () => {
    const name = `bl-${Math.random()}`;
    await makeV1(name);
    // An old tab: a plain connection that ignores versionchange.
    const old: IDBDatabase = await new Promise((resolve, reject) => {
      const r = indexedDB.open(name, 10);
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
    expect(db.verno).toBe(2);
    expect(await db.items.count()).toBe(4);
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
