import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { buildBackup } from '../src/data/backup';
import { InventoryDb } from '../src/data/db';
import { loadSnapshot, replaceAll } from '../src/data/inventory';
import { addItem, deleteItem, updateItem } from '../src/data/items';
import { getThumbnail, setPhoto } from '../src/data/photos';
import { getSettings } from '../src/data/settings';
import { item, vendor } from './helpers';

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

// Take, replace and remove (F19, SPEC §8). No PIN anywhere here: the data layer has no gate,
// and the UI calls setPhoto directly (checked in scripts/m7-ui-check.mjs).
const lists = {
  suppliers: [
    { name: 'REV', website: '', notes: '' },
    { name: 'other', website: '', notes: '' },
  ],
  locations: [],
  categories: [{ name: 'Motors', order: 0, subcategories: [] }],
};
const jpeg = (...bytes: number[]) => new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' });

async function setup() {
  db = new InventoryDb(`p-${Math.random()}`);
  await replaceAll(db, { ...lists, items: [item({ id: 'a' }), item({ id: 'b' })], photos: new Map([['b', jpeg(7, 7)]]) }, 1);
}

/** Photo rows and hasPhoto flags must always name the same items. */
async function expectConsistent() {
  const items = await db.items.toArray();
  const withFlag = items.filter((i) => i.hasPhoto).map((i) => i.id).sort();
  const rows = (await db.photos.toCollection().primaryKeys()).sort();
  expect(rows).toEqual(withFlag);
}

describe('setPhoto (F19)', () => {
  it('adds a photo: row stored with its thumbnail, hasPhoto set, counts as a change', async () => {
    await setup();
    await setPhoto(db, 'a', { full: jpeg(1, 2, 3), thumb: jpeg(9) }, 500);
    const row = (await db.photos.get('a'))!;
    expect([row.full.size, row.thumb!.size, row.updatedAt, row.taken]).toEqual([3, 1, 500, 500]);
    const a = (await db.items.get('a'))!;
    expect([a.hasPhoto, a.updatedAt]).toEqual([true, 500]);
    expect((await getSettings(db)).lastChangeAt).toBe(500);
    await expectConsistent();
  });

  it('replaces a photo (including an imported one): the new bytes win, the old thumbnail goes', async () => {
    await setup();
    await db.photos.update('b', { thumb: jpeg(5) });
    await setPhoto(db, 'b', { full: jpeg(1, 2, 3, 4), thumb: null }, 600);
    const row = (await db.photos.get('b'))!;
    expect([row.full.size, row.thumb, row.taken]).toEqual([4, null, 600]);
    await expectConsistent();
  });

  it('removes a photo: row gone, hasPhoto cleared; other items untouched', async () => {
    await setup();
    await setPhoto(db, 'a', { full: jpeg(1), thumb: null }, 2);
    await setPhoto(db, 'b', 'remove', 700);
    expect(await db.photos.get('b')).toBeUndefined();
    expect((await db.items.get('b'))!.hasPhoto).toBe(false);
    expect((await db.photos.get('a'))!.full.size).toBe(1);
    expect((await getSettings(db)).lastChangeAt).toBe(700);
    await expectConsistent();
  });

  it('removing when there is no photo is harmless', async () => {
    await setup();
    await setPhoto(db, 'a', 'remove', 3);
    expect((await db.items.get('a'))!.hasPhoto).toBe(false);
    await expectConsistent();
  });

  it('an unknown item or an empty photo changes nothing', async () => {
    await setup();
    await expect(setPhoto(db, 'zz', { full: jpeg(1), thumb: null }, 9)).rejects.toThrow(/no item/);
    await expect(setPhoto(db, 'a', { full: jpeg(), thumb: null }, 9)).rejects.toThrow(/empty/);
    expect(await db.photos.count()).toBe(1);
    expect(await db.photos.get('zz')).toBeUndefined();
    expect((await getSettings(db)).lastChangeAt).toBe(1);
    await expectConsistent();
  });

  it('a counts edit saved afterwards keeps the photo (hasPhoto is never taken from the form)', async () => {
    await setup();
    const before = (await loadSnapshot(db)).items.find((i) => i.id === 'a')!;
    await setPhoto(db, 'a', { full: jpeg(1), thumb: null }, 5);
    // The editor was opened before the photo was taken, so its base says no photo.
    await updateItem(db, before, { ...before, onHand: 3 }, 6);
    expect((await db.items.get('a'))!.hasPhoto).toBe(true);
    await expectConsistent();
  });

  it('deleting the item removes its taken photo', async () => {
    await setup();
    await setPhoto(db, 'a', { full: jpeg(1), thumb: null }, 5);
    await deleteItem(db, 'a', 6);
    expect(await db.photos.get('a')).toBeUndefined();
    await expectConsistent();
  });

  it('a taken photo goes into the full backup as photos/<id>.jpg, byte for byte', async () => {
    await setup();
    await setPhoto(db, 'a', { full: jpeg(4, 5, 6), thumb: jpeg(1) }, 5);
    const zip = await JSZip.loadAsync(await (await buildBackup(db, 'full', new Date(5))).arrayBuffer());
    expect([...(await zip.file('photos/a.jpg')!.async('uint8array'))]).toEqual([4, 5, 6]);
    expect(await zip.file('inventory.csv')!.async('string')).toContain('photos/a.jpg');
  });
});

describe('photo saved with the editor (F6, F7)', () => {
  it('Add item with a photo: item and photo in one save', async () => {
    await setup();
    const saved = await addItem(db, item({ id: 'tm-NEW' }), 10, { full: jpeg(1, 2), thumb: jpeg(3) });
    expect(saved.hasPhoto).toBe(true);
    expect((await db.photos.get('tm-NEW'))!.full.size).toBe(2);
    await expectConsistent();
  });

  it('Add item that fails validation stores no photo either', async () => {
    await setup();
    const bad = item({ id: 'tm-BAD', vendors: [vendor({ supplier: 'Nobody' }), null, null] });
    await expect(addItem(db, bad, 10, { full: jpeg(1), thumb: null })).rejects.toThrow();
    expect(await db.items.get('tm-BAD')).toBeUndefined();
    expect(await db.photos.get('tm-BAD')).toBeUndefined();
    expect((await getSettings(db)).lastChangeAt).toBe(1);
  });

  it('Edit with a new photo, and Edit with Remove', async () => {
    await setup();
    const snap = await loadSnapshot(db);
    const a = snap.items.find((i) => i.id === 'a')!;
    const b = snap.items.find((i) => i.id === 'b')!;
    expect((await updateItem(db, a, { ...a, notes: 'n' }, 11, { full: jpeg(8), thumb: null })).hasPhoto).toBe(true);
    expect((await updateItem(db, b, b, 12, 'remove')).hasPhoto).toBe(false);
    expect((await db.items.get('a'))!.notes).toBe('n');
    expect((await db.photos.get('a'))!.full.size).toBe(1);
    expect(await db.photos.get('b')).toBeUndefined();
    await expectConsistent();
  });

  it('Edit that fails leaves the old photo', async () => {
    await setup();
    const b = (await loadSnapshot(db)).items.find((i) => i.id === 'b')!;
    await expect(updateItem(db, b, { ...b, name: '' }, 12, 'remove')).rejects.toThrow();
    expect((await db.photos.get('b'))!.full.size).toBe(2);
    await expectConsistent();
  });
});
