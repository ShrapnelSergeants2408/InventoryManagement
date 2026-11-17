// M34: photos are stored a batch at a time after the rest (helper join, restore, setup from a
// backup), so Android Chrome's refusal of 1533 photo Blobs in one transaction no longer stops a
// helper joining, and a restore never loses a photo the tablet already had.
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { existsSync, readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { applyRestore } from '../src/data/backup';
import { InventoryDb } from '../src/data/db';
import { HelperDb, joinKit, photoWarning } from '../src/data/helper-db';
import { PHOTO_BATCH } from '../src/data/inventory';
import { isSetUp, startInventory } from '../src/data/setup';
import { readCountKit } from '../src/io/count-kit';
import type { RestorePlan } from '../src/io/restore';
import { item } from './helpers';

// The kit that failed on a student's Android phone, 2026-11-17 (not in the repo).
const REAL_KIT = 'D:/Downloads/Mechanical_3_Helper (1).zip';

const dbs: InventoryDb[] = [];
afterEach(async () => {
  for (const db of dbs.splice(0)) {
    db.close();
    await Dexie.delete(db.name);
  }
});

async function realKit() {
  const r = await readCountKit(new Uint8Array(readFileSync(REAL_KIT)));
  if (!r.ok) throw new Error(r.problems.join('; '));
  return r.read;
}

describe.skipIf(!existsSync(REAL_KIT))('joining the Mechanical 3 kit (1533 photos)', { timeout: 60000 }, () => {
  it('stores every photo, in batches, and marks each item', async () => {
    const read = await realKit();
    const db = new HelperDb(`kit-batches-${Math.random()}`);
    dbs.push(db);
    const progress: number[] = [];
    const r = await joinKit(db, read, 1000, undefined, (n) => progress.push(n));
    expect(r).toEqual({ photosSaved: read.data.photos.size, photosTotal: read.data.photos.size });
    expect(photoWarning(r)).toBeNull();
    expect(await db.photos.count()).toBe(read.data.photos.size);
    expect(await db.items.filter((i) => i.hasPhoto).count()).toBe(read.data.photos.size);
    expect(progress.length).toBe(Math.ceil(read.data.photos.size / PHOTO_BATCH) + 1);
  });

  it('opens the kit even when the device refuses photos, and says how many it kept', async () => {
    const read = await realKit();
    const db = new HelperDb(`kit-refuse-${Math.random()}`);
    dbs.push(db);
    let batches = 0;
    db.photos.hook('creating', () => {
      if (++batches > PHOTO_BATCH * 2) throw new Error('Error preparing Blob/File data to be stored in object store');
    });
    const r = await joinKit(db, read, 1000);
    expect(r.photosSaved).toBe(PHOTO_BATCH * 2);
    expect(r.error).toMatch(/preparing Blob/);
    expect(photoWarning(r)).toBe(`This device could only store ${PHOTO_BATCH * 2} of ${read.data.photos.size} photos. Counting works without them; items just show no picture.`);
    // The kit is open: every item is there, and only items with a stored photo say they have one.
    expect(await db.items.count()).toBe(read.data.items.length);
    expect(await db.photos.count()).toBe(PHOTO_BATCH * 2);
    expect(await db.items.filter((i) => i.hasPhoto).count()).toBe(PHOTO_BATCH * 2);
    expect((await db.settings.get('helperKit'))?.value).toMatchObject({ helperName: 'Mechanical 3' });
  });
});

// ── Restore on the shop tablet (same single-transaction risk) ──

const N = 120;
const ids = Array.from({ length: N }, (_, i) => `tm-P${String(i).padStart(4, '0')}`);
const photo = (tag: string) => new Blob([tag], { type: 'image/jpeg' });

function zipPlan(tag: string): RestorePlan {
  return {
    kind: 'zip',
    fileName: `${tag}.zip`,
    fileSize: 1,
    items: ids.map((id) => item({ id, name: id })),
    photos: new Map(ids.map((id) => [id, photo(`${tag} ${id}`)])),
    missingPhotos: [],
    suppliers: [{ name: 'REV', website: '', notes: '' }],
    locations: [],
    categories: [{ name: 'Motors', order: 0, subcategories: [] } as never],
    orderLists: [],
    pending: [],
    pendingPhotos: new Map(),
    orders: null,
    receipts: new Map(),
    addedSuppliers: [],
    addedLocations: [],
    savedAt: null,
    savedAtSource: null,
    warnings: [],
  };
}

/** Makes the browser refuse every photo row after the first `n`, as Android Chrome did. */
function refuseAfter(db: InventoryDb, n: number) {
  let rows = 0;
  const refuse = () => {
    if (++rows > n) throw new Error('Error preparing Blob/File data to be stored in object store');
  };
  db.photos.hook('creating', refuse);
  db.photos.hook('updating', refuse);
}

async function photoText(db: InventoryDb, id: string) {
  const row = await db.photos.get(id);
  return row ? await row.full.text() : null;
}

describe('restoring a backup stores its photos in batches', () => {
  it('stores every photo and says how many items have one', async () => {
    const db = new InventoryDb(`restore-${Math.random()}`);
    dbs.push(db);
    const progress: number[] = [];
    const r = await applyRestore(db, zipPlan('new'), 1000, (n) => progress.push(n));
    expect(r).toEqual({ withPhotos: N, photos: { photosSaved: N, photosTotal: N } });
    expect(progress).toEqual([0, 50, 100, 120]);
    expect(await photoText(db, ids[N - 1]!)).toBe(`new ${ids[N - 1]!}`);
  });

  it('a refused batch loses no photo: items not reached keep the tablet’s old one', async () => {
    const db = new InventoryDb(`restore-refuse-${Math.random()}`);
    dbs.push(db);
    await applyRestore(db, zipPlan('old'), 1000);
    refuseAfter(db, PHOTO_BATCH);
    const r = await applyRestore(db, zipPlan('new'), 2000);
    expect(r.photos.photosSaved).toBe(PHOTO_BATCH);
    expect(r.photos.error).toMatch(/preparing Blob/);
    expect(r.withPhotos).toBe(N);
    expect(await db.items.count()).toBe(N);
    expect(await db.photos.count()).toBe(N);
    expect(await photoText(db, ids[0]!)).toBe(`new ${ids[0]!}`);
    expect(await photoText(db, ids[PHOTO_BATCH]!)).toBe(`old ${ids[PHOTO_BATCH]!}`);
  });

  it('a refused batch on a fresh tablet: everything else restored, items without a stored photo say so', async () => {
    const db = new InventoryDb(`setup-refuse-${Math.random()}`);
    dbs.push(db);
    refuseAfter(db, PHOTO_BATCH * 2);
    const r = await startInventory(db, 'restore', zipPlan('new'), 1000);
    expect(r.withPhotos).toBe(PHOTO_BATCH * 2);
    expect(r.photos.error).toMatch(/preparing Blob/);
    expect(await db.items.count()).toBe(N);
    expect(await isSetUp(db)).toBe(true);
    expect((await db.items.get(ids[N - 1]!))?.hasPhoto).toBe(false);
  });

  it('a helper joining a synthetic kit gets every photo', async () => {
    const db = new HelperDb(`join-${Math.random()}`);
    dbs.push(db);
    const plan = zipPlan('kit');
    const kit = { kitId: 'kit-SYNTH001', helperId: 'hp-SYN01', helperName: 'Synth', createdAt: '', appVersion: '1.7.3', kind: 'category', groups: ['Motors'], allowNewItems: true, countSince: '', recountDays: null } as never;
    const r = await joinKit(db, { kit, data: plan, warnings: [] }, 1000, { id: 'dev-SYN', pendingBase: 0 });
    expect(r).toEqual({ photosSaved: N, photosTotal: N });
    expect(await db.items.filter((i) => i.hasPhoto).count()).toBe(N);
  });
});
