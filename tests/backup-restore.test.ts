import 'fake-indexeddb/auto';
import JSZip from 'jszip';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildBackup, recordBackup } from '../src/data/backup';
import { InventoryDb } from '../src/data/db';
import { loadSnapshot, replaceAll, setOnHand, type ReplaceAllInput } from '../src/data/inventory';
import { getSettings } from '../src/data/settings';
import { centsToPlain } from '../src/domain/money';
import { buildOrderList } from '../src/domain/order';
import { backupFileName, dateFromFileName } from '../src/io/backup';
import { readRestoreFile, looksLikeZip, type RestorePlan } from '../src/io/restore';
import { readSeed } from '../src/io/seed';
import { SPEC_CATEGORIES, item, seedBytes, vendor } from './helpers';

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

const TRICKY_NOTES = 'Use with "Thrifty" swerve, ask a mentor first.\nLine two, with a comma\r\nLine three: 10-32 × ¾″ — ünïcödé 🤖';

function tabletData(): ReplaceAllInput {
  return {
    items: [
      item({
        id: 'st-0001',
        name: 'NEO 2.0, "brushless"',
        category: 'Motors',
        location: 'Bin F3',
        onHand: 3,
        desired: 4,
        spares: 2,
        notes: TRICKY_NOTES,
        source: 'starter',
        lastCounted: '2026-10-24',
        barcode: '012345678905',
        preferredVendor: 2,
        vendors: [
          vendor({ supplier: 'REV', partNo: 'REV-21-1652', url: 'https://www.revrobotics.com/rev-21-1652/', packSize: 1, packPriceCents: 4999, priceChecked: '2026-10-17' }),
          vendor({ supplier: 'WCP', partNo: 'WCP-0001', url: '', packSize: 2, packPriceCents: null, priceChecked: '' }),
          vendor({ supplier: 'Shop, "Local"', partNo: '', url: '', packSize: 50, packPriceCents: 0, priceChecked: '2025-01-02' }),
        ],
      }),
      item({ id: 'tm-7K3QX', name: 'Bolt 10-32 × ¾', category: 'Fasteners', subcategory: 'Bolts & Screws', location: '', onHand: 0, desired: 0, vendors: [vendor({ supplier: 'other' }), null, null] }),
      item({ id: 'tm-ABCDE', name: 'Plain', category: 'Fasteners', subcategory: 'Nuts', location: 'Pit cart', notes: '', vendors: [vendor({ supplier: 'REV', packPriceCents: 12345678 }), null, null] }),
    ],
    photos: new Map([
      ['st-0001', bytes(0xff, 0xd8, 0xff, 0x00, 0x01, 0x02, 0x0a, 0x0d, 0xff, 0xd9)],
      ['tm-ABCDE', new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])], { type: 'image/png' })],
    ]),
    suppliers: [
      { name: 'REV', website: 'https://www.revrobotics.com', notes: 'account # in the binder, "red" one' },
      { name: 'WCP', website: '', notes: 'line 1\nline 2' },
      { name: 'Shop, "Local"', website: '', notes: '' },
      { name: 'Never used', website: 'https://example.com', notes: 'kept by a full backup' },
      { name: 'other', website: '', notes: '' },
    ],
    locations: [
      { name: 'Pit cart', notes: 'blue tote, "top"', order: 0 },
      { name: 'Bin F3', notes: '', order: 1 },
      { name: 'Empty shelf', notes: '', order: 2 },
    ],
    categories: [
      { name: 'Motors', order: 0, subcategories: [] },
      { name: 'Empty category', order: 1, subcategories: [] },
      { name: 'Fasteners', order: 2, subcategories: ['Nuts', 'Empty sub', 'Bolts & Screws'] },
    ],
  };
}

async function planFor(db: InventoryDb, file: { name: string; bytes: Uint8Array }): Promise<RestorePlan> {
  const read = await readRestoreFile(file, await loadSnapshot(db));
  if (!read.ok) throw new Error(JSON.stringify(read.problems));
  return read.plan;
}

async function applyPlan(db: InventoryDb, plan: RestorePlan, now = 1_000) {
  return replaceAll(db, plan, now, { keepPhotos: plan.kind === 'csv' });
}

describe('backup file names (§7)', () => {
  it('carry a local timestamp', () => {
    const d = new Date(2026, 9, 17, 10, 35);
    expect(backupFileName('full', d)).toBe('inventory-backup-2026-10-17-1035.zip');
    expect(backupFileName('data', new Date(2026, 0, 5, 7, 4))).toBe('inventory-backup-2026-01-05-0704.csv');
  });
  it('are read back for the restore comparison (Q8)', () => {
    expect(dateFromFileName('inventory-backup-2026-10-10-1535.zip')).toEqual(new Date(2026, 9, 10, 15, 35));
    expect(dateFromFileName('frc2408-starter-catalog-2026-10-17.zip')).toEqual(new Date(2026, 9, 17));
    expect(dateFromFileName('inventory-backup-2026-10-10-1535 (1).zip')).toEqual(new Date(2026, 9, 10, 15, 35));
    expect(dateFromFileName('backup.zip')).toBeNull();
    expect(dateFromFileName('x-2026-02-30.zip')).toBeNull();
    expect(dateFromFileName('x-2026-02-03-1075.zip')).toBeNull();
    expect(dateFromFileName('x-2026-02-03-2410.zip')).toBeNull();
  });
});

describe('full backup ZIP (F15, §7)', () => {
  it('contains the CSVs, a manifest and the photos', async () => {
    const db = newDb();
    await replaceAll(db, tabletData());
    const blob = await buildBackup(db, 'full', new Date(2026, 9, 18, 9, 30));
    expect(blob.type).toBe('application/zip');
    const zip = await JSZip.loadAsync(new Uint8Array(await blob.arrayBuffer()));
    expect(Object.keys(zip.files).sort()).toEqual(
      ['categories.csv', 'inventory.csv', 'locations.csv', 'manifest.json', 'photos/', 'photos/st-0001.jpg', 'photos/tm-ABCDE.png', 'suppliers.csv'].sort(),
    );
    const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'));
    expect(manifest).toMatchObject({ itemCount: 3, photoCount: 2, savedAt: new Date(2026, 9, 18, 9, 30).toISOString() });
    const csv = await zip.file('inventory.csv')!.async('string');
    expect(csv).toContain('photos/st-0001.jpg');
    expect(csv).toContain('photos/tm-ABCDE.png');
    expect(csv).not.toContain('PIN');
  });

  it('round-trips with no data loss: items, vendors, tricky notes, lists, order, photos byte for byte', async () => {
    const src = newDb();
    const data = tabletData();
    await replaceAll(src, data);
    const before = await loadSnapshot(src);
    const blob = await buildBackup(src, 'full', new Date(2026, 9, 18, 9, 30));

    const dst = newDb();
    await replaceAll(dst, { items: [item({ id: 'old-1' })], photos: new Map([['old-1', bytes(1)]]), suppliers: [{ name: 'REV', website: '', notes: '' }, { name: 'other', website: '', notes: '' }], locations: [], categories: [] });
    const plan = await planFor(dst, await fileOf('anything.zip', blob));
    expect(plan.kind).toBe('zip');
    expect(plan.savedAtSource).toBe('manifest');
    expect(plan.warnings).toEqual([]);
    expect(await applyPlan(dst, plan)).toBe(2);

    const after = await loadSnapshot(dst);
    expect(after.items).toEqual(before.items);
    expect(after.items.find((i) => i.id === 'st-0001')!.notes).toBe(TRICKY_NOTES);
    expect(after.suppliers.map((s) => s.name).sort()).toEqual(before.suppliers.map((s) => s.name).sort());
    expect(after.suppliers).toEqual(expect.arrayContaining(before.suppliers));
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
    await replaceAll(a, tabletData());
    const at = new Date(2026, 9, 18, 9, 30);
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

  it('the starter catalog restores to the same 129 items and $8,413.66', async () => {
    const db = newDb();
    await replaceAll(db, tabletData());
    const plan = await planFor(db, { name: 'frc2408-starter-catalog-2026-10-21.zip', bytes: seedBytes() });
    expect(plan.items).toHaveLength(129);
    expect(plan.photos.size).toBe(128);
    expect(plan.savedAtSource).toBe('file name');
    await applyPlan(db, plan);
    const snap = await loadSnapshot(db);
    expect(snap.items).toHaveLength(129);
    expect(await db.photos.count()).toBe(128);
    expect(centsToPlain(buildOrderList(snap.items).grandTotalCents)).toBe('8413.66');
    // The seed has no locations.csv, so the tablet's locations are kept (Q5). It has a
    // categories.csv (seed layout, §7), so its §11 list replaces the tablet's.
    expect(snap.locations.map((l) => l.name)).toEqual(['Pit cart', 'Bin F3', 'Empty shelf']);
    expect(snap.categories.map((c) => c.name)).toEqual(SPEC_CATEGORIES);
    expect(snap.suppliers.map((s) => s.name)).toContain('other');
  });
});

describe('data-only CSV backup and restore (F15, F17, Q5)', () => {
  it('a data-only backup is the inventory CSV', async () => {
    const db = newDb();
    await replaceAll(db, tabletData());
    const blob = await buildBackup(db, 'data', new Date());
    expect(blob.type).toBe('text/csv');
    const raw = new Uint8Array(await blob.arrayBuffer());
    expect([...raw.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // UTF-8 BOM, so Excel reads × and ¾
    expect(new TextDecoder().decode(raw).startsWith('id,name,category')).toBe(true);
    expect(looksLikeZip(new Uint8Array(await blob.arrayBuffer()))).toBe(false);
  });

  it('round-trips items exactly and keeps photos for matching ids; others are deleted', async () => {
    const src = newDb();
    await replaceAll(src, tabletData());
    const before = await loadSnapshot(src);
    const csv = await buildBackup(src, 'data', new Date());

    // The tablet now: st-0001 (photo) and tm-GONE1 (photo) — tm-GONE1 isn't in the backup.
    const dst = newDb();
    const d = tabletData();
    await replaceAll(dst, {
      ...d,
      items: [d.items[0]!, item({ id: 'tm-GONE1' })],
      photos: new Map([['st-0001', bytes(9, 9, 9)], ['tm-GONE1', bytes(7)]]),
    });
    const plan = await planFor(dst, await fileOf('inventory-backup-2026-10-10-1535.csv', csv));
    expect(plan.kind).toBe('csv');
    expect(plan.savedAt).toEqual(new Date(2026, 9, 10, 15, 35));
    expect(await applyPlan(dst, plan)).toBe(1);

    const after = await loadSnapshot(dst);
    const strip = (items: typeof before.items) => items.map((i) => ({ ...i, hasPhoto: false }));
    expect(strip(after.items)).toEqual(strip(before.items));
    expect(after.items.find((i) => i.id === 'st-0001')!.hasPhoto).toBe(true);
    expect(after.items.find((i) => i.id === 'tm-ABCDE')!.hasPhoto).toBe(false);
    expect(await blobBytes((await dst.photos.get('st-0001'))!.full)).toEqual([9, 9, 9]);
    expect(await dst.photos.get('tm-GONE1')).toBeUndefined();
    expect(await dst.photos.count()).toBe(1);
  });

  it("keeps the tablet's lists and adds missing supplier and location names at the end", async () => {
    const db = newDb();
    const d = tabletData();
    await replaceAll(db, { ...d, items: [d.items[1]!], photos: new Map(), suppliers: [{ name: 'other', website: 'x', notes: 'kept' }, { name: 'REV', website: 'https://rev', notes: 'kept' }], locations: [{ name: 'Bin F3', notes: 'kept', order: 0 }] });
    const csv = [
      'id,name,category,unit,on_hand,desired,location,v1_supplier,v1_pack_size',
      'a1,A,Motors,each,1,1,bin f3,rev,1',
      'a2,B,New cat,each,1,1,Shelf Z,Brand New,1',
      'a3,C,Motors,each,1,1,,Brand New,1',
    ].join('\n');
    const plan = await planFor(db, { name: 'hand.csv', bytes: new TextEncoder().encode(csv) });
    expect(plan.addedSuppliers).toEqual(['Brand New']);
    expect(plan.addedLocations).toEqual(['Shelf Z']);
    await applyPlan(db, plan);
    const snap = await loadSnapshot(db);
    expect(snap.suppliers).toEqual(expect.arrayContaining([{ name: 'other', website: 'x', notes: 'kept' }, { name: 'REV', website: 'https://rev', notes: 'kept' }, { name: 'Brand New', website: '', notes: '' }]));
    expect(snap.suppliers).toHaveLength(3);
    expect(snap.locations).toEqual([{ name: 'Bin F3', notes: 'kept', order: 0 }, { name: 'Shelf Z', notes: '', order: 1 }]);
    expect(snap.categories.map((c) => c.name)).toEqual(['Motors', 'Empty category', 'Fasteners', 'New cat']);
  });

  it("hand-edited capitals take the lists' spelling, so rename and remove still find the item (Stage 5 finding 2, probe P1)", async () => {
    const db = newDb();
    const d = tabletData();
    await replaceAll(db, { ...d, items: [d.items[1]!], photos: new Map(), locations: [{ name: 'Bin F3', notes: '', order: 0 }] });
    const csv = ['id,name,category,subcategory,unit,on_hand,desired,location,v1_supplier,v1_pack_size', 'a1,A,motors,,each,1,1,bin f3,REV,1', 'a2,B,FASTENERS,nuts,each,1,1,,REV,1'].join('\n');
    await applyPlan(db, await planFor(db, { name: 'hand.csv', bytes: new TextEncoder().encode(csv) }));
    const snap = await loadSnapshot(db);
    expect(snap.items.map((i) => [i.id, i.category, i.subcategory, i.location])).toEqual([
      ['a1', 'Motors', '', 'Bin F3'],
      ['a2', 'Fasteners', 'Nuts', ''],
    ]);
    // No second "motors" category, and Fasteners keeps one Nuts.
    expect(snap.categories.map((c) => c.name)).toEqual(['Motors', 'Empty category', 'Fasteners']);
    expect(snap.categories.find((c) => c.name === 'Fasteners')!.subcategories.filter((s) => s.toLowerCase() === 'nuts')).toEqual(['Nuts']);
    expect(snap.locations.map((l) => l.name)).toEqual(['Bin F3']);
  });

  it('a full ZIP replaces the lists, and `other` always comes back', async () => {
    const src = newDb();
    const d = tabletData();
    await replaceAll(src, { ...d, items: [d.items[1]!], photos: new Map() });
    // Make a ZIP whose suppliers.csv lacks `other` (hand-edited).
    const zipBlob = await buildBackup(src, 'full', new Date());
    const zip = await JSZip.loadAsync(new Uint8Array(await zipBlob.arrayBuffer()));
    zip.file('suppliers.csv', 'name,website,notes\nREV,,\n');
    const edited = await zip.generateAsync({ type: 'uint8array' });

    const dst = newDb();
    await replaceAll(dst, d);
    const plan = await planFor(dst, { name: 'edited.zip', bytes: edited });
    await applyPlan(dst, plan);
    const names = (await loadSnapshot(dst)).suppliers.map((s) => s.name).sort();
    expect(names).toEqual(['other', 'REV'].sort());
  });
});

describe('restore never half-applies (F17)', () => {
  it('a file with a bad row is rejected with row numbers and nothing changes', async () => {
    const db = newDb();
    await replaceAll(db, tabletData(), 5);
    const before = await loadSnapshot(db);
    const csv = ['id,name,category,unit,on_hand,desired,v1_supplier,v1_pack_size', 'a1,A,Motors,each,1,1,REV,1', 'a2,B,Motors,each,-1,1,REV,1', 'a3,C,Motors,each,1,1,REV,2.5'].join('\n');
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
    const r2 = await readRestoreFile({ name: 'x.csv', bytes: new TextEncoder().encode('id,name,category,unit,on_hand,desired\n') }, snap);
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.problems[0]!.message).toMatch(/no items/);
    const z = new JSZip();
    z.file('readme.txt', 'hi');
    const r3 = await readRestoreFile({ name: 'x.zip', bytes: await z.generateAsync({ type: 'uint8array' }) }, snap);
    expect(r3.ok).toBe(false);
    if (!r3.ok) expect(r3.problems[0]!.message).toMatch(/inventory\.csv/);
  });

  it('a failure inside the transaction leaves the tablet unchanged', async () => {
    const db = newDb();
    await replaceAll(db, tabletData(), 5);
    const before = await loadSnapshot(db);
    const photosBefore = await db.photos.count();
    const plan = await planFor(db, { name: 'seed.zip', bytes: seedBytes() });
    const spy = vi.spyOn(db.categories, 'bulkAdd').mockRejectedValueOnce(new Error('disk full'));
    await expect(applyPlan(db, plan)).rejects.toThrow('disk full');
    spy.mockRestore();
    expect(await loadSnapshot(db)).toEqual(before);
    expect(await db.photos.count()).toBe(photosBefore);
    expect((await getSettings(db)).lastChangeAt).toBe(5);
  });

  it('restore never touches settings such as the PIN or the backup clock', async () => {
    const db = newDb();
    await replaceAll(db, tabletData());
    await db.settings.bulkPut([{ key: 'pinHash', value: 'abc' }, { key: 'reminderDays', value: 3 }]);
    await recordBackup(db, 42);
    await applyPlan(db, await planFor(db, { name: 'seed.zip', bytes: seedBytes() }), 777);
    expect((await db.settings.get('pinHash'))!.value).toBe('abc');
    const s = await getSettings(db);
    expect(s).toMatchObject({ reminderDays: 3, lastBackupAt: 42, lastChangeAt: 777 });
  });
});

describe('starter catalog through restore matches the first-launch load', () => {
  it('same items as readSeed', async () => {
    const seed = await readSeed(seedBytes());
    if (!seed.ok) throw new Error('seed');
    const db = newDb();
    const plan = await planFor(db, { name: 'seed.zip', bytes: seedBytes() });
    expect(plan.items).toEqual(seed.data.items);
    await applyPlan(db, plan);
    await setOnHand(db, 'st-0001', 2);
    expect((await loadSnapshot(db)).items.find((i) => i.id === 'st-0001')!.onHand).toBe(2);
  });
});

describe('CSV files saved by Excel as plain "CSV" (Windows-1252)', () => {
  it('are read correctly, with a warning', async () => {
    // "Bolt 10-32 × ¾" in Windows-1252: × = 0xD7, ¾ = 0xBE.
    const head = new TextEncoder().encode('id,name,category,unit,on_hand,desired,v1_supplier,v1_pack_size\nw1,Bolt 10-32 ');
    const bytes = new Uint8Array([...head, 0xd7, 0x20, 0xbe, ...new TextEncoder().encode(',Fasteners,each,1,1,REV,1\n')]);
    const read = await readRestoreFile({ name: 'excel.csv', bytes }, await loadSnapshot(newDb()));
    if (!read.ok) throw new Error(JSON.stringify(read.problems));
    expect(read.plan.items[0]!.name).toBe('Bolt 10-32 × ¾');
    expect(read.plan.warnings[0]).toMatch(/isn’t UTF-8/);
  });
});
