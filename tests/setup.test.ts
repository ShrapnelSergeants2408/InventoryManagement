import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { buildBackup } from '../src/data/backup';
import { InventoryDb } from '../src/data/db';
import { addItem } from '../src/data/items';
import { loadSnapshot, setQuantity } from '../src/data/inventory';
import { DEFAULT_CATEGORIES, SETUP_DONE, emptyStart, ensurePersistentStorage, isSetUp, requestPersistentStorage, startInventory } from '../src/data/setup';
import { readRestoreFile } from '../src/io/restore';
import { item } from './helpers';

const dbs: InventoryDb[] = [];
afterEach(() => {
  for (const d of dbs.splice(0)) d.close();
});
const newDb = () => {
  const d = new InventoryDb(`setup-${Math.random()}`);
  dbs.push(d);
  return d;
};
const EMPTY = { items: [], locations: [], categories: [] };

describe('first launch: start fresh (SPEC v2.0 §12.5)', () => {
  it('the default household categories, no items, locations or photos; setup marked done in the same step', async () => {
    const db = newDb();
    expect(await isSetUp(db)).toBe(false);
    await startInventory(db, emptyStart(), 1234);
    const snap = await loadSnapshot(db);
    expect(snap.items).toEqual([]);
    expect(snap.locations).toEqual([]);
    expect(await db.photos.count()).toBe(0);
    expect(snap.categories.map((c) => c.name)).toEqual([...DEFAULT_CATEGORIES]);
    expect(snap.categories[0]).toEqual({ name: 'Decorations', order: 0, subcategories: [] });
    expect(await isSetUp(db)).toBe(true);
    expect((await db.settings.get(SETUP_DONE))?.value).toBe(1234);
  });

  it('never runs again once setup is done, so it can never replace the household’s data', async () => {
    const db = newDb();
    await startInventory(db, emptyStart(), 1);
    await addItem(db, item({ id: 'it-KEEP0001', quantity: 2 }));
    await setQuantity(db, 'it-KEEP0001', 7);
    await expect(startInventory(db, emptyStart(), 2)).rejects.toThrow(/already set up/);
    const snap = await loadSnapshot(db);
    expect(snap.items.map((i) => [i.id, i.quantity])).toEqual([['it-KEEP0001', 7]]);
    expect((await db.settings.get(SETUP_DONE))?.value).toBe(1);
  });
});

describe('first launch: restore a backup file', () => {
  it('a full backup from another phone arrives whole: quantities, photos and lists', async () => {
    const other = newDb();
    await startInventory(other, emptyStart(), 1);
    await addItem(other, item({ id: 'it-SNOWMAN2', name: 'Snowman lights', category: 'Lights', location: 'Attic shelf B', quantity: 4 }), 2, {
      full: new Blob([new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3])], { type: 'image/jpeg' }),
      thumb: null,
    });
    const zip = await buildBackup(other, 'full', new Date(2026, 10, 2, 12, 0));
    const read = await readRestoreFile({ name: 'backup.zip', bytes: new Uint8Array(await zip.arrayBuffer()) }, EMPTY);
    if (!read.ok) throw new Error(JSON.stringify(read.problems));

    const fresh = newDb();
    const photos = await startInventory(fresh, read.plan, 9);
    const snap = await loadSnapshot(fresh);
    expect(photos).toBe(1);
    expect(snap.items).toEqual([{ ...item({ id: 'it-SNOWMAN2', name: 'Snowman lights', category: 'Lights', location: 'Attic shelf B', quantity: 4 }), hasPhoto: true }]);
    expect(snap.locations.map((l) => l.name)).toEqual(['Attic shelf B']);
    expect(snap.categories.map((c) => c.name)).toEqual([...DEFAULT_CATEGORIES]);
    expect(await isSetUp(fresh)).toBe(true);
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

describe('ensurePersistentStorage on every launch (SPEC §2)', () => {
  /** A fake navigator.storage: persist() grants when `grants` is true; counts the persist() calls. */
  function fakeStorage(state: { granted: boolean; grants: boolean }) {
    const calls = { persist: 0 };
    const storage = {
      persisted: async () => state.granted,
      persist: async () => {
        calls.persist++;
        if (state.grants) state.granted = true;
        return state.granted;
      },
    };
    return { storage, calls };
  }

  it('granted: already persistent, so it doesn’t ask again', async () => {
    const { storage, calls } = fakeStorage({ granted: true, grants: true });
    expect(await ensurePersistentStorage(storage)).toBe(true);
    expect(calls.persist).toBe(0);
  });

  it('not yet persistent and the browser grants it now (after install): asks, then reports persisted()', async () => {
    const { storage, calls } = fakeStorage({ granted: false, grants: true });
    expect(await ensurePersistentStorage(storage)).toBe(true);
    expect(calls.persist).toBe(1);
  });

  it('denied: asks on every launch and reports not granted each time', async () => {
    const { storage, calls } = fakeStorage({ granted: false, grants: false });
    expect(await ensurePersistentStorage(storage)).toBe(false);
    expect(await ensurePersistentStorage(storage)).toBe(false);
    expect(calls.persist).toBe(2);
  });

  it('the result is persisted(), not what persist() returned', async () => {
    const storage = { persisted: async () => false, persist: async () => true };
    expect(await ensurePersistentStorage(storage)).toBe(false);
  });

  it('unsupported: null with no Storage API, no persisted(), or an error', async () => {
    expect(await ensurePersistentStorage(undefined)).toBeNull();
    expect(await ensurePersistentStorage({ persist: async () => true })).toBeNull();
    expect(
      await ensurePersistentStorage({
        persisted: async () => {
          throw new Error('no');
        },
      }),
    ).toBeNull();
  });

  it('with persisted() but no persist(): reports persisted() without asking', async () => {
    expect(await ensurePersistentStorage({ persisted: async () => false })).toBe(false);
  });
});
