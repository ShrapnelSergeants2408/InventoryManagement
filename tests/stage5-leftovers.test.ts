import 'fake-indexeddb/auto';
import JSZip from 'jszip';
import { afterEach, describe, expect, it } from 'vitest';
import { applyRestore, buildBackup } from '../src/data/backup';
import { InventoryDb } from '../src/data/db';
import { emptyStart, STORAGE_PERSISTED_EVENT, watchPersistentStorage } from '../src/data/setup';
import { loadSnapshot, replaceAll, type ReplaceAllInput } from '../src/data/inventory';
import { getSettings } from '../src/data/settings';
import { readRestoreFile } from '../src/io/restore';
import { exportBackup, exportMessage } from '../src/ui/screens/more/export-backup';
import { item, vendor } from './helpers';

// SPEC v0.13 §22 "Stage 5 leftovers" (docs/history/stage5-review.md findings 4, 5, 7 and 9).

const dbs: InventoryDb[] = [];
afterEach(() => {
  for (const d of dbs.splice(0)) d.close();
});
const newDb = () => {
  const d = new InventoryDb(`s5-${Math.random()}`);
  dbs.push(d);
  return d;
};

const jpeg = (...b: number[]) => new Blob([new Uint8Array([0xff, 0xd8, ...b])], { type: 'image/jpeg' });
const blobBytes = async (b: Blob) => [...new Uint8Array(await b.arrayBuffer())];

function data(photos: [string, Blob][]): ReplaceAllInput {
  return {
    items: ['a1', 'a2', 'a3'].map((id) => item({ id, name: id, category: 'Motors', vendors: [vendor({ supplier: 'REV', packPriceCents: 100 }), null, null] })),
    photos: new Map(photos),
    suppliers: [
      { name: 'REV', website: '', notes: '' },
      { name: 'other', website: '', notes: '' },
    ],
    locations: [],
    categories: [{ name: 'Motors', order: 0, subcategories: [] }],
  };
}

async function zipOf(db: InventoryDb, edit?: (z: JSZip) => void): Promise<Uint8Array> {
  const z = await JSZip.loadAsync(await buildBackup(db, 'full', new Date(2026, 9, 28, 12, 0)));
  edit?.(z);
  return z.generateAsync({ type: 'uint8array' });
}

describe('a full backup with no items (finding 4)', () => {
  it('restores when it has list files, and the lists come back', async () => {
    const empty = newDb();
    await replaceAll(empty, emptyStart({ suppliers: data([]).suppliers, categories: data([]).categories }));
    await empty.locations.add({ key: 'shelf c1', name: 'Shelf C1', notes: '', order: 0 });
    const bytes = await zipOf(empty);

    const db = newDb();
    await replaceAll(db, data([['a1', jpeg(1)]]));
    const read = await readRestoreFile({ name: 'empty.zip', bytes }, await loadSnapshot(db));
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.plan.items).toEqual([]);
    await applyRestore(db, read.plan);
    const after = await loadSnapshot(db);
    expect(after.items).toEqual([]);
    expect(after.locations.map((l) => l.name)).toEqual(['Shelf C1']);
    expect(await db.photos.count()).toBe(0);
  });

  it('is still refused without list files, and so is an empty CSV', async () => {
    const db = newDb();
    await replaceAll(db, data([]));
    const snap = await loadSnapshot(db);
    const z = new JSZip();
    z.file('inventory.csv', 'id,name,category,unit,on_hand,desired\n');
    const r1 = await readRestoreFile({ name: 'x.zip', bytes: await z.generateAsync({ type: 'uint8array' }) }, snap);
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.problems[0]!.message).toMatch(/no items/);
    const r2 = await readRestoreFile({ name: 'x.csv', bytes: new TextEncoder().encode('id,name,category,unit,on_hand,desired,v1_supplier\n') }, snap);
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.problems[0]!.message).toMatch(/no items/);
  });

  it('any one list file is enough', async () => {
    const db = newDb();
    await replaceAll(db, data([]));
    const snap = await loadSnapshot(db);
    for (const [name, text] of [
      ['suppliers.csv', 'name,website,notes\nREV,,\n'],
      ['locations.csv', 'name,notes,order\nShelf C1,,0\n'],
      ['categories.csv', 'category,subcategory,order\nMotors,,0\n'],
    ]) {
      const z = new JSZip();
      z.file('inventory.csv', 'id,name,category,unit,on_hand,desired\n');
      z.file(name!, text!);
      const read = await readRestoreFile({ name: 'x.zip', bytes: await z.generateAsync({ type: 'uint8array' }) }, snap);
      expect(read.ok, name).toBe(true);
    }
  });

  it('is not mistaken for a count kit when the tablet has prices', async () => {
    const empty = newDb();
    await replaceAll(empty, emptyStart({ suppliers: data([]).suppliers, categories: data([]).categories }));
    const db = newDb();
    await replaceAll(db, data([]));
    const read = await readRestoreFile({ name: 'empty.zip', bytes: await zipOf(empty) }, await loadSnapshot(db));
    expect(read.ok).toBe(true);
  });
});

describe('photos missing from the ZIP (finding 5)', () => {
  it('are counted in the plan, and the tablet keeps its own photo for them', async () => {
    const source = newDb();
    await replaceAll(source, data([['a1', jpeg(1)], ['a2', jpeg(2)]]));
    const bytes = await zipOf(source, (z) => z.remove('photos/a2.jpg'));

    const db = newDb();
    await replaceAll(db, data([['a1', jpeg(9)], ['a2', jpeg(8)], ['a3', jpeg(7)]]));
    const read = await readRestoreFile({ name: 'b.zip', bytes }, await loadSnapshot(db));
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.plan.missingPhotos).toEqual(['a2']);
    expect(read.plan.photos.size).toBe(1);

    expect(await applyRestore(db, read.plan)).toBe(2);
    // a1 comes from the backup, a2 is the tablet's own, a3 has no photo in the backup and is gone.
    expect(await blobBytes((await db.photos.get('a1'))!.full)).toEqual([0xff, 0xd8, 1]);
    expect(await blobBytes((await db.photos.get('a2'))!.full)).toEqual([0xff, 0xd8, 8]);
    expect(await db.photos.get('a3')).toBeUndefined();
    const items = new Map((await loadSnapshot(db)).items.map((i) => [i.id, i.hasPhoto]));
    expect(Object.fromEntries(items)).toEqual({ a1: true, a2: true, a3: false });
  });

  it('a missing photo the tablet doesn’t have leaves that item without one', async () => {
    const source = newDb();
    await replaceAll(source, data([['a2', jpeg(2)]]));
    const bytes = await zipOf(source, (z) => z.remove('photos/a2.jpg'));
    const db = newDb();
    await replaceAll(db, data([]));
    const read = await readRestoreFile({ name: 'b.zip', bytes }, await loadSnapshot(db));
    if (!read.ok) throw new Error('expected a plan');
    expect(await applyRestore(db, read.plan)).toBe(0);
    expect(await db.photos.count()).toBe(0);
  });

  it('only keeps photos for items in the restore that the backup has no photo for', async () => {
    const db = newDb();
    await replaceAll(db, data([['a1', jpeg(9)], ['gone', jpeg(8)]]));
    // A plan naming an id that isn't restored, and one whose photo the backup does have.
    const input = { ...data([['a1', jpeg(1)]]), missingPhotos: ['gone', 'a1'] };
    expect(await replaceAll(db, input)).toBe(1);
    expect(await db.photos.toCollection().primaryKeys()).toEqual(['a1']);
    expect(await blobBytes((await db.photos.get('a1'))!.full)).toEqual([0xff, 0xd8, 1]);
  });

  it('a backup with every photo replaces the tablet’s photos as before', async () => {
    const source = newDb();
    await replaceAll(source, data([['a1', jpeg(1)]]));
    const db = newDb();
    await replaceAll(db, data([['a2', jpeg(8)]]));
    const read = await readRestoreFile({ name: 'b.zip', bytes: await zipOf(source) }, await loadSnapshot(db));
    if (!read.ok) throw new Error('expected a plan');
    expect(read.plan.missingPhotos).toEqual([]);
    await applyRestore(db, read.plan);
    expect(await db.photos.toCollection().primaryKeys()).toEqual(['a1']);
  });
});

describe('a backup saved only to Downloads (finding 7)', () => {
  const shareDeps = (outcome: 'share' | 'cancel' | 'none') => {
    const downloads: string[] = [];
    return {
      downloads,
      deps: {
        canShare: () => outcome !== 'none',
        share: () => (outcome === 'cancel' ? Promise.reject(new DOMException('', 'AbortError')) : Promise.resolve()),
        download: (f: File) => void downloads.push(f.name),
      },
    };
  };

  it('says the file is on this tablet only', () => {
    const msg = exportMessage('downloaded', 'inventory-backup-2026-10-28-1200.zip')!;
    expect(msg).toMatch(/on this tablet only/);
    expect(msg).toMatch(/lost with the tablet/);
    expect(exportMessage('shared', 'x.zip')).toBe('Shared x.zip.');
    expect(exportMessage('cancelled', 'x.zip')).toBeNull();
  });

  it('a share and a download reset the reminder; a cancelled share doesn’t', async () => {
    for (const [outcome, resets] of [
      ['share', true],
      ['none', true],
      ['cancel', false],
    ] as const) {
      const db = newDb();
      await replaceAll(db, data([]));
      const { deps, downloads } = shareDeps(outcome);
      const { result } = await exportBackup(db, 'data', deps);
      expect(result).toBe(outcome === 'share' ? 'shared' : outcome === 'none' ? 'downloaded' : 'cancelled');
      expect(downloads.length).toBe(outcome === 'none' ? 1 : 0);
      expect((await getSettings(db)).lastBackupAt !== null).toBe(resets);
    }
  });
});

describe('persistent storage at boot (finding 9)', () => {
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it('asks on launch and again on appinstalled, and announces a grant', async () => {
    const host = new EventTarget();
    const answers = [false, true];
    let asked = 0;
    let announced = 0;
    host.addEventListener(STORAGE_PERSISTED_EVENT, () => announced++);
    const stop = watchPersistentStorage(host, async () => answers[asked++] ?? true);
    await flush();
    expect([asked, announced]).toEqual([1, 0]);
    host.dispatchEvent(new Event('appinstalled'));
    await flush();
    expect([asked, announced]).toEqual([2, 1]);
    stop();
    host.dispatchEvent(new Event('appinstalled'));
    await flush();
    expect(asked).toBe(2);
  });

  it('null (no Storage API) announces nothing', async () => {
    const host = new EventTarget();
    let announced = 0;
    host.addEventListener(STORAGE_PERSISTED_EVENT, () => announced++);
    watchPersistentStorage(host, async () => null);
    await flush();
    expect(announced).toBe(0);
  });
});
