import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { buildBackup } from '../src/data/backup';
import { InventoryDb } from '../src/data/db';
import { loadSnapshot, setOnHand } from '../src/data/inventory';
import { SETUP_DONE, STARTER_LOADED, emptyStart, isSetUp, requestPersistentStorage, startInventory } from '../src/data/setup';
import { orderTotalCents } from '../src/domain/count';
import { readRestoreFile } from '../src/io/restore';
import { readSeed } from '../src/io/seed';
import { seedBytes } from './helpers';

const dbs: InventoryDb[] = [];
afterEach(() => {
  for (const d of dbs.splice(0)) d.close();
});
const newDb = () => {
  const d = new InventoryDb(`setup-${Math.random()}`);
  dbs.push(d);
  return d;
};
async function seed() {
  const s = await readSeed(seedBytes());
  if (!s.ok) throw new Error(JSON.stringify(s.problems));
  return s.data;
}
const EMPTY = { items: [], suppliers: [], locations: [], categories: [] };

describe('first launch: load the starter catalog (F22)', () => {
  it('129 items, 168 vendor options, 128 photos stored, 9 suppliers, 12 categories; on hand 0, spares 0, never counted', async () => {
    const db = newDb();
    expect(await isSetUp(db)).toBe(false);
    const photos = await startInventory(db, 'starter', await seed(), 1000);
    const snap = await loadSnapshot(db);
    expect(photos).toBe(128);
    expect(snap.items).toHaveLength(129);
    expect(snap.items.flatMap((i) => i.vendors.filter(Boolean))).toHaveLength(168);
    expect(await db.photos.count()).toBe(128);
    expect(snap.items.filter((i) => i.hasPhoto)).toHaveLength(128);
    expect(snap.suppliers).toHaveLength(9);
    expect(snap.categories.map((c) => c.name)).toEqual([
      'Structure',
      'Fasteners',
      'Motion',
      'Drivetrain',
      'Motors',
      'Motor Controllers',
      'Power & Electrical',
      'Wiring & Connectors',
      'Control System & Sensors',
      'Pneumatics',
      'Tools & Consumables',
      'Pit & Safety',
    ]);
    expect(snap.locations).toEqual([]);
    expect(snap.items.every((i) => i.onHand === 0 && i.spares === 0 && i.lastCounted === '' && i.source === 'starter')).toBe(true);
    expect(snap.items.filter((i) => i.desired > 0).length).toBeGreaterThan(100);
    expect(orderTotalCents(snap.items)).toBe(841366);
  });

  it('marks setup done (and when the catalog was loaded) in the same step', async () => {
    const db = newDb();
    await startInventory(db, 'starter', await seed(), 1234);
    expect(await isSetUp(db)).toBe(true);
    expect((await db.settings.get(SETUP_DONE))?.value).toBe(1234);
    expect((await db.settings.get(STARTER_LOADED))?.value).toBe(1234);
  });

  it('never runs again once setup is done, so it can never replace the team’s data', async () => {
    const db = newDb();
    await startInventory(db, 'starter', await seed(), 1);
    await setOnHand(db, 'st-0001', 7);
    await expect(startInventory(db, 'starter', await seed(), 2)).rejects.toThrow(/already set up/);
    await expect(startInventory(db, 'empty', emptyStart(await seed()), 2)).rejects.toThrow(/already set up/);
    const snap = await loadSnapshot(db);
    expect(snap.items).toHaveLength(129);
    expect(snap.items.find((i) => i.id === 'st-0001')?.onHand).toBe(7);
    expect((await db.settings.get(SETUP_DONE))?.value).toBe(1);
  });

  it('reports photo progress as it reads the ZIP: from 0 to 128 of 128, with the 129 items', async () => {
    const calls: Array<[number, number, number]> = [];
    await readSeed(seedBytes(), (d, t, i) => calls.push([d, t, i]));
    expect(calls[0]).toEqual([0, 128, 129]);
    expect(calls.at(-1)).toEqual([128, 128, 129]);
    expect(calls.every(([d], k) => k === 0 || d >= calls[k - 1]![0])).toBe(true);
  });
});

describe('first launch: start empty', () => {
  it('the starter catalog’s suppliers and categories (with subcategories), no items, no photos', async () => {
    const db = newDb();
    const data = await seed();
    await startInventory(db, 'empty', emptyStart(data), 5);
    const snap = await loadSnapshot(db);
    expect(snap.items).toEqual([]);
    expect(await db.photos.count()).toBe(0);
    expect(snap.suppliers.map((s) => s.name).sort()).toEqual(data.suppliers.map((s) => s.name).sort());
    expect(snap.categories).toEqual(data.categories);
    expect(snap.categories.some((c) => c.subcategories.length > 0)).toBe(true);
    expect(await isSetUp(db)).toBe(true);
    expect(await db.settings.get(STARTER_LOADED)).toBeUndefined();
  });
});

describe('first launch: restore a backup file (Q2)', () => {
  it('a full backup from another tablet arrives whole: counts, photos and lists', async () => {
    const other = newDb();
    await startInventory(other, 'starter', await seed(), 1);
    await setOnHand(other, 'st-0063', 4);
    const zip = await buildBackup(other, 'full', new Date(2026, 9, 18, 12, 0));
    const read = await readRestoreFile({ name: 'backup.zip', bytes: new Uint8Array(await zip.arrayBuffer()) }, EMPTY);
    if (!read.ok) throw new Error(JSON.stringify(read.problems));

    const fresh = newDb();
    const photos = await startInventory(fresh, 'restore', read.plan, 9);
    const snap = await loadSnapshot(fresh);
    expect(photos).toBe(128);
    expect(snap.items).toHaveLength(129);
    expect(snap.items.find((i) => i.id === 'st-0063')?.onHand).toBe(4);
    expect(snap.suppliers).toHaveLength(9);
    expect(await isSetUp(fresh)).toBe(true);
    expect(await fresh.settings.get(STARTER_LOADED)).toBeUndefined();
  });
});

describe('requestPersistentStorage (SPEC §2)', () => {
  it('passes on what the browser says, and null when it can’t say', async () => {
    expect(await requestPersistentStorage({ persist: async () => true })).toBe(true);
    expect(await requestPersistentStorage({ persist: async () => false })).toBe(false);
    expect(await requestPersistentStorage(undefined)).toBeNull();
    expect(
      await requestPersistentStorage({
        persist: async () => {
          throw new Error('no');
        },
      }),
    ).toBeNull();
  });
});
