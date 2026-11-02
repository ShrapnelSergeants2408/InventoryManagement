import 'fake-indexeddb/auto';
import JSZip from 'jszip';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyRestore, buildBackup, recordBackup } from '../src/data/backup';
import { InventoryDb } from '../src/data/db';
import { loadSnapshot, replaceAll, setQuantity, type ReplaceAllInput } from '../src/data/inventory';
import { getSettings } from '../src/data/settings';
import { backupFileName, dateFromFileName } from '../src/io/backup';
import { readRestoreFile, looksLikeZip, type RestorePlan } from '../src/io/restore';
import { item } from './helpers';

const dbs: InventoryDb[] = [];
afterEach(() => {
  for (const d of dbs.splice(0)) d.close();
});
const newDb = () => {
  const d = new InventoryDb(`br-${Math.random()}`);
  dbs.push(d);
  return d;
};

const bytes = (...b: number[]) => new Blob([new Uint8Array(b)], { type: 'image/jpeg' });
const blobBytes = async (b: Blob) => [...new Uint8Array(await b.arrayBuffer())];
const fileOf = async (name: string, blob: Blob) => ({ name, bytes: new Uint8Array(await blob.arrayBuffer()) });

const TRICKY_NOTES = 'Goes on the "big" mantel, left side.\nLine two, with a comma\r\nLine three: 6 × ¾″ hooks — ünïcödé 🎄';

function phoneData(): ReplaceAllInput {
  return {
    items: [
      item({
        id: 'it-SNOWMAN2',
        name: 'Snowman lights, "outdoor"',
        category: 'Lights',
        location: 'Attic shelf B',
        quantity: 3,
        notes: TRICKY_NOTES,
        barcode: '012345678905',
      }),
      item({ id: 'it-ORNAMENT', name: 'Glass ornaments 6 × ¾', category: 'Decorations', subcategory: 'Ornaments & hooks', location: '', quantity: 40 }),
      item({ id: 'it-DRILL222', name: 'Cordless drill', category: 'Tools', subcategory: 'Power', location: 'Garage pegboard', quantity: 1 }),
    ],
    photos: new Map([
      ['it-SNOWMAN2', bytes(0xff, 0xd8, 0xff, 0x00, 0x01, 0x02, 0x0a, 0x0d, 0xff, 0xd9)],
      ['it-DRILL222', new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])], { type: 'image/png' })],
    ]),
    locations: [
      { name: 'Garage pegboard', notes: 'left of the door, "top"', order: 0 },
      { name: 'Attic shelf B', notes: '', order: 1 },
      { name: 'Empty shelf', notes: '', order: 2 },
    ],
    categories: [
      { name: 'Lights', order: 0, subcategories: [] },
      { name: 'Empty category', order: 1, subcategories: [] },
      { name: 'Decorations', order: 2, subcategories: ['Garland', 'Empty sub', 'Ornaments & hooks'] },
      { name: 'Tools', order: 3, subcategories: ['Power'] },
    ],
  };
}

async function planFor(db: InventoryDb, file: { name: string; bytes: Uint8Array }): Promise<RestorePlan> {
  const read = await readRestoreFile(file, await loadSnapshot(db));
  if (!read.ok) throw new Error(JSON.stringify(read.problems));
  return read.plan;
}

async function applyPlan(db: InventoryDb, plan: RestorePlan, now = 1_000) {
  return applyRestore(db, plan, now);
}

describe('backup file names (§7)', () => {
  it('carry a local timestamp', () => {
    expect(backupFileName('full', new Date(2026, 10, 2, 10, 35))).toBe('home-inventory-backup-2026-11-02-1035.zip');
    expect(backupFileName('data', new Date(2026, 0, 5, 7, 4))).toBe('home-inventory-backup-2026-01-05-0704.csv');
  });
  it('are read back for the restore comparison', () => {
    expect(dateFromFileName('home-inventory-backup-2026-10-10-1535.zip')).toEqual(new Date(2026, 9, 10, 15, 35));
    expect(dateFromFileName('something-2026-10-17.zip')).toEqual(new Date(2026, 9, 17));
    expect(dateFromFileName('home-inventory-backup-2026-10-10-1535 (1).zip')).toEqual(new Date(2026, 9, 10, 15, 35));
    expect(dateFromFileName('backup.zip')).toBeNull();
    expect(dateFromFileName('x-2026-02-30.zip')).toBeNull();
    expect(dateFromFileName('x-2026-02-03-1075.zip')).toBeNull();
    expect(dateFromFileName('x-2026-02-03-2410.zip')).toBeNull();
  });
});

describe('full backup ZIP (F18, §7)', () => {
  it('contains the CSVs, a manifest and the photos', async () => {
    const db = newDb();
    await replaceAll(db, phoneData());
    const blob = await buildBackup(db, 'full', new Date(2026, 10, 2, 9, 30));
    expect(blob.type).toBe('application/zip');
    const zip = await JSZip.loadAsync(new Uint8Array(await blob.arrayBuffer()));
    expect(Object.keys(zip.files).sort()).toEqual(['categories.csv', 'inventory.csv', 'locations.csv', 'manifest.json', 'photos/', 'photos/it-DRILL222.png', 'photos/it-SNOWMAN2.jpg'].sort());
    const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'));
    expect(manifest).toMatchObject({ app: 'Hiebert Home Inventory', itemCount: 3, photoCount: 2, savedAt: new Date(2026, 10, 2, 9, 30).toISOString() });
    const csv = await zip.file('inventory.csv')!.async('string');
    expect(csv).toContain('photos/it-SNOWMAN2.jpg');
    expect(csv).toContain('photos/it-DRILL222.png');
  });

  it('round-trips with no data loss: items, tricky notes, lists, order, photos byte for byte', async () => {
    const src = newDb();
    const data = phoneData();
    await replaceAll(src, data);
    const before = await loadSnapshot(src);
    const blob = await buildBackup(src, 'full', new Date(2026, 10, 2, 9, 30));

    const dst = newDb();
    await replaceAll(dst, { items: [item({ id: 'old-1' })], photos: new Map([['old-1', bytes(1)]]), locations: [], categories: [] });
    const plan = await planFor(dst, await fileOf('anything.zip', blob));
    expect(plan.kind).toBe('zip');
    expect(plan.savedAtSource).toBe('manifest');
    expect(plan.warnings).toEqual([]);
    expect(await applyPlan(dst, plan)).toBe(2);

    const after = await loadSnapshot(dst);
    expect(after.items).toEqual(before.items);
    expect(after.items.find((i) => i.id === 'it-SNOWMAN2')!.notes).toBe(TRICKY_NOTES);
    expect(after.locations).toEqual(before.locations);
    expect(after.categories).toEqual(before.categories);
    expect(await dst.photos.count()).toBe(2);
    for (const [id, blob] of data.photos) {
      const row = await dst.photos.get(id);
      expect(await blobBytes(row!.full)).toEqual(await blobBytes(blob));
      expect(row!.full.type).toBe(blob.type);
    }
    expect(await dst.photos.get('old-1')).toBeUndefined();
  });

  it('a second round trip gives the same files', async () => {
    const a = newDb();
    await replaceAll(a, phoneData());
    const at = new Date(2026, 10, 2, 9, 30);
    const first = await buildBackup(a, 'full', at);
    const b = newDb();
    await applyPlan(b, await planFor(b, await fileOf('x.zip', first)));
    const second = await buildBackup(b, 'full', at);
    const files = async (blob: Blob) => {
      const z = await JSZip.loadAsync(new Uint8Array(await blob.arrayBuffer()));
      const out: Record<string, number[]> = {};
      for (const f of Object.values(z.files)) if (!f.dir) out[f.name] = [...(await f.async('uint8array'))];
      return out;
    };
    expect(await files(second)).toEqual(await files(first));
  });
});

describe('data-only CSV backup and restore (F18)', () => {
  it('a data-only backup is the inventory CSV', async () => {
    const db = newDb();
    await replaceAll(db, phoneData());
    const blob = await buildBackup(db, 'data', new Date());
    expect(blob.type).toBe('text/csv');
    const raw = new Uint8Array(await blob.arrayBuffer());
    expect([...raw.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // UTF-8 BOM, so Excel reads × and ¾
    expect(new TextDecoder().decode(raw).startsWith('id,name,category,subcategory,location,quantity')).toBe(true);
    expect(looksLikeZip(raw)).toBe(false);
  });

  it('round-trips items exactly and keeps photos for matching ids; others are deleted', async () => {
    const src = newDb();
    await replaceAll(src, phoneData());
    const before = await loadSnapshot(src);
    const csv = await buildBackup(src, 'data', new Date());

    // The phone now: it-SNOWMAN2 (photo) and it-GONE0001 (photo) — it-GONE0001 isn't in the backup.
    const dst = newDb();
    const d = phoneData();
    await replaceAll(dst, { ...d, items: [d.items[0]!, item({ id: 'it-GONE0001', category: 'Lights' })], photos: new Map([['it-SNOWMAN2', bytes(9, 9, 9)], ['it-GONE0001', bytes(7)]]) });
    const plan = await planFor(dst, await fileOf('home-inventory-backup-2026-10-10-1535.csv', csv));
    expect(plan.kind).toBe('csv');
    expect(plan.savedAt).toEqual(new Date(2026, 9, 10, 15, 35));
    expect(await applyPlan(dst, plan)).toBe(1);

    const after = await loadSnapshot(dst);
    const strip = (items: typeof before.items) => items.map((i) => ({ ...i, hasPhoto: false }));
    expect(strip(after.items)).toEqual(strip(before.items));
    expect(after.items.find((i) => i.id === 'it-SNOWMAN2')!.hasPhoto).toBe(true);
    expect(after.items.find((i) => i.id === 'it-DRILL222')!.hasPhoto).toBe(false);
    expect(await blobBytes((await dst.photos.get('it-SNOWMAN2'))!.full)).toEqual([9, 9, 9]);
    expect(await dst.photos.get('it-GONE0001')).toBeUndefined();
    expect(await dst.photos.count()).toBe(1);
  });

  it("keeps the phone's lists and adds missing location and category names at the end", async () => {
    const db = newDb();
    const d = phoneData();
    await replaceAll(db, { ...d, items: [d.items[1]!], photos: new Map(), locations: [{ name: 'Attic shelf B', notes: 'kept', order: 0 }] });
    const csv = ['id,name,category,quantity,location', 'a1,A,Lights,1,attic shelf b', 'a2,B,New cat,1,Basement Z', 'a3,C,Lights,1,'].join('\n');
    const plan = await planFor(db, { name: 'hand.csv', bytes: new TextEncoder().encode(csv) });
    expect(plan.addedLocations).toEqual(['Basement Z']);
    await applyPlan(db, plan);
    const snap = await loadSnapshot(db);
    expect(snap.locations).toEqual([{ name: 'Attic shelf B', notes: 'kept', order: 0 }, { name: 'Basement Z', notes: '', order: 1 }]);
    expect(snap.categories.map((c) => c.name)).toEqual(['Lights', 'Empty category', 'Decorations', 'Tools', 'New cat']);
  });

  it("hand-edited capitals take the lists' spelling, so rename and remove still find the item", async () => {
    const db = newDb();
    const d = phoneData();
    await replaceAll(db, { ...d, items: [d.items[1]!], photos: new Map(), locations: [{ name: 'Attic shelf B', notes: '', order: 0 }] });
    const csv = ['id,name,category,subcategory,quantity,location', 'a1,A,lights,,1,attic SHELF b', 'a2,B,DECORATIONS,garland,1,'].join('\n');
    await applyPlan(db, await planFor(db, { name: 'hand.csv', bytes: new TextEncoder().encode(csv) }));
    const snap = await loadSnapshot(db);
    expect(snap.items.map((i) => [i.id, i.category, i.subcategory, i.location])).toEqual([
      ['a1', 'Lights', '', 'Attic shelf B'],
      ['a2', 'Decorations', 'Garland', ''],
    ]);
    expect(snap.categories.map((c) => c.name)).toEqual(['Lights', 'Empty category', 'Decorations', 'Tools']);
    expect(snap.locations.map((l) => l.name)).toEqual(['Attic shelf B']);
  });

  it("a ZIP without categories.csv keeps the phone's categories, adding only what the items use", async () => {
    const src = newDb();
    const d = phoneData();
    await replaceAll(src, { ...d, photos: new Map() });
    const zip = await JSZip.loadAsync(new Uint8Array(await (await buildBackup(src, 'full', new Date())).arrayBuffer()));
    zip.remove('categories.csv');
    const older = await zip.generateAsync({ type: 'uint8array' });

    const dst = newDb();
    const phoneCats = [
      { name: 'Decorations', order: 0, subcategories: ['Wreaths', 'Garland'] },
      { name: 'Kept empty', order: 1, subcategories: ['Empty sub'] },
    ];
    await replaceAll(dst, { ...d, items: [], photos: new Map(), categories: phoneCats });
    await applyPlan(dst, await planFor(dst, { name: 'older.zip', bytes: older }));
    const cats = (await loadSnapshot(dst)).categories;
    expect(cats.slice(0, 2).map((c) => [c.name, c.subcategories.slice(0, 2)])).toEqual([
      ['Decorations', ['Wreaths', 'Garland']],
      ['Kept empty', ['Empty sub']],
    ]);
    expect(cats.map((c) => c.name)).toEqual(expect.arrayContaining(['Lights', 'Tools']));
  });
});

describe('restore never half-applies (F18)', () => {
  it('a file with a bad row is rejected with row numbers and nothing changes', async () => {
    const db = newDb();
    await replaceAll(db, phoneData(), 5);
    const before = await loadSnapshot(db);
    const csv = ['id,name,category,quantity', 'a1,A,Lights,1', 'a2,B,Lights,-1', 'a3,C,Lights,2.5'].join('\n');
    const read = await readRestoreFile({ name: 'bad.csv', bytes: new TextEncoder().encode(csv) }, before);
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.problems.map((p) => p.row)).toEqual([3, 4]);
    expect(await loadSnapshot(db)).toEqual(before);
  });

  it('garbage, an empty CSV and a ZIP without inventory.csv are rejected', async () => {
    const db = newDb();
    const snap = await loadSnapshot(db);
    const r1 = await readRestoreFile({ name: 'x.zip', bytes: new Uint8Array([0x50, 0x4b, 3, 4, 0, 0, 0]) }, snap);
    expect(r1.ok).toBe(false);
    const r2 = await readRestoreFile({ name: 'x.csv', bytes: new TextEncoder().encode('id,name,category,quantity\n') }, snap);
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.problems[0]!.message).toMatch(/no items/);
    const z = new JSZip();
    z.file('readme.txt', 'hi');
    const r3 = await readRestoreFile({ name: 'x.zip', bytes: await z.generateAsync({ type: 'uint8array' }) }, snap);
    expect(r3.ok).toBe(false);
    if (!r3.ok) expect(r3.problems[0]!.message).toMatch(/inventory\.csv/);
  });

  it('a failure inside the transaction leaves the phone unchanged', async () => {
    const src = newDb();
    await replaceAll(src, { ...phoneData(), items: [item({ id: 'it-NEWONE22', category: 'Lights' })], photos: new Map() });
    const zip = await buildBackup(src, 'full', new Date());

    const db = newDb();
    await replaceAll(db, phoneData(), 5);
    const before = await loadSnapshot(db);
    const photosBefore = await db.photos.count();
    const plan = await planFor(db, await fileOf('x.zip', zip));
    const spy = vi.spyOn(db.categories, 'bulkAdd').mockRejectedValueOnce(new Error('disk full'));
    await expect(applyPlan(db, plan)).rejects.toThrow('disk full');
    spy.mockRestore();
    expect(await loadSnapshot(db)).toEqual(before);
    expect(await db.photos.count()).toBe(photosBefore);
    expect((await getSettings(db)).lastChangeAt).toBe(5);
  });

  it('restore never touches settings such as the backup clock', async () => {
    const src = newDb();
    await replaceAll(src, phoneData());
    const zip = await buildBackup(src, 'full', new Date());

    const db = newDb();
    await replaceAll(db, phoneData());
    await db.settings.bulkPut([{ key: 'reminderDays', value: 3 }]);
    await recordBackup(db, 42);
    await applyPlan(db, await planFor(db, await fileOf('x.zip', zip)), 777);
    expect(await getSettings(db)).toMatchObject({ reminderDays: 3, lastBackupAt: 42, lastChangeAt: 777 });
    await setQuantity(db, 'it-DRILL222', 2);
    expect((await loadSnapshot(db)).items.find((i) => i.id === 'it-DRILL222')!.quantity).toBe(2);
  });
});

describe('CSV files saved by Excel as plain "CSV" (Windows-1252)', () => {
  it('are read correctly, with a warning', async () => {
    // "Hooks 6 × ¾" in Windows-1252: × = 0xD7, ¾ = 0xBE.
    const head = new TextEncoder().encode('id,name,category,quantity\nw1,Hooks 6 ');
    const raw = new Uint8Array([...head, 0xd7, 0x20, 0xbe, ...new TextEncoder().encode(',Decorations,1\n')]);
    const read = await readRestoreFile({ name: 'excel.csv', bytes: raw }, await loadSnapshot(newDb()));
    if (!read.ok) throw new Error(JSON.stringify(read.problems));
    expect(read.plan.items[0]!.name).toBe('Hooks 6 × ¾');
    expect(read.plan.warnings[0]).toMatch(/isn’t UTF-8/);
  });
});
