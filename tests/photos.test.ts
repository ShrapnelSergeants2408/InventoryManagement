import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { InventoryDb } from '../src/data/db';
import { getThumbnail } from '../src/data/photos';
import { getSettings } from '../src/data/settings';

let db: InventoryDb;
afterEach(() => db?.close());
const full = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' });
const small = new Blob([new Uint8Array([9])], { type: 'image/jpeg' });

describe('list thumbnails', () => {
  it('no photo → null, and make is never called', async () => {
    db = new InventoryDb(`p-${Math.random()}`);
    let calls = 0;
    expect(await getThumbnail(db, 'x', async () => (calls++, small))).toBeNull();
    expect(calls).toBe(0);
  });

  it('made once from the full photo, then stored and reused', async () => {
    db = new InventoryDb(`p-${Math.random()}`);
    await db.photos.put({ itemId: 'a', full, thumb: null, updatedAt: 1 });
    let calls = 0;
    const make = async (b: Blob) => {
      calls++;
      expect(b.size).toBe(3);
      return small;
    };
    expect((await getThumbnail(db, 'a', make))!.size).toBe(1);
    expect((await getThumbnail(db, 'a', make))!.size).toBe(1);
    expect(calls).toBe(1);
    expect((await db.photos.get('a'))!.full.size).toBe(3); // full photo untouched
    expect((await getSettings(db)).lastChangeAt).toBeNull(); // not an inventory change
  });

  it('a photo replaced while the thumbnail was being made does not get the stale thumbnail', async () => {
    db = new InventoryDb(`p-${Math.random()}`);
    await db.photos.put({ itemId: 'a', full, thumb: null, updatedAt: 1 });
    const thumb = await getThumbnail(db, 'a', async () => {
      await db.photos.put({ itemId: 'a', full: small, thumb: null, updatedAt: 2 });
      return small;
    });
    expect(thumb).not.toBeNull();
    expect((await db.photos.get('a'))!.thumb).toBeNull();
  });
});
