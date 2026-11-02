// Full backup and restore (SPEC v2.0 F18, §7): every record and photo round-trips with nothing
// lost, an H1 (0.1.1) backup still restores, and a restore never half-applies.
import 'fake-indexeddb/auto';
import JSZip from 'jszip';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyRestore, buildBackup, recordBackup } from '../src/data/backup';
import { InventoryDb } from '../src/data/db';
import { loadSnapshot, replaceAll, type ReplaceAllInput } from '../src/data/inventory';
import { photosOf } from '../src/data/photos';
import { getSettings } from '../src/data/settings';
import { DEFAULT_SEASONS } from '../src/domain/places';
import { backupFileName, buildDataCsv, dateFromFileName } from '../src/io/backup';
import { readRestoreFile, looksLikeZip, type RestorePlan } from '../src/io/restore';
import { area, bin, dataset, item, season, spot } from './helpers';

const dbs: InventoryDb[] = [];
afterEach(() => {
  for (const d of dbs.splice(0)) d.close();
});
const newDb = () => {
  const d = new InventoryDb(`br-${Math.random()}`);
  dbs.push(d);
  return d;
};

const jpeg = (...b: number[]) => new Blob([new Uint8Array(b)], { type: 'image/jpeg' });
const blobBytes = async (b: Blob) => [...new Uint8Array(await b.arrayBuffer())];
const fileOf = async (name: string, blob: Blob) => ({ name, bytes: new Uint8Array(await blob.arrayBuffer()) });
const zipBytes = (z: JSZip) => z.generateAsync({ type: 'uint8array' });

const TRICKY = 'Goes on the "big" mantel, left side.\nLine two, with a comma\r\nLine three: 6 × ¾″ hooks — ünïcödé 🎄';

/** A household using every field: areas, spots, bins, seasons, tags, records, photos on four kinds of owner. */
function phoneData(): ReplaceAllInput {
  const areas = [area({ id: 'ar-ATTIC001', name: 'Attic', letter: 'A', order: 0, notes: 'pull-down "ladder"' }), area({ id: 'ar-GARAGE01', name: 'Garage', letter: 'G', order: 1 }), area({ id: 'ar-EMPTY001', name: 'Basement', letter: 'B', order: 2 })];
  const spots = [
    spot({ id: 'sp-SHELFB01', areaId: 'ar-ATTIC001', name: 'Shelf B', order: 0, notes: TRICKY }),
    spot({ id: 'sp-PEGBRD01', areaId: 'ar-GARAGE01', name: 'Pegboard', order: 0 }),
    spot({ id: 'sp-BENCH001', areaId: 'ar-GARAGE01', name: 'Bench', order: 1 }),
  ];
  const seasons = [season({ id: 'se-HALLOW01', name: 'Halloween', order: 0, color: 'orange', setupNotes: 'Porch: skeleton left' }), season({ id: 'se-XMAS0001', name: 'Christmas', order: 1, color: 'red' })];
  const bins = [
    bin({ id: 'bn-XMAS0004', code: 'A-04', name: 'Christmas 4: lights & garland', spotId: 'sp-SHELFB01', seasonId: 'se-XMAS0001', tags: ['Fragile', 'Heavy'], state: 'out', notes: 'lid cracked', labelPrintedAt: Date.UTC(2026, 10, 1, 15, 30), labelContents: 'Snowman lights ×3\nGarland ×2' }),
    bin({ id: 'bn-LOOSE001', code: 'G-12', name: 'Tote with no spot', spotId: '' }),
  ];
  const items = [
    item({ id: 'it-SNOWMAN2', name: 'Snowman lights, "outdoor"', category: 'Lights', binId: 'bn-XMAS0004', quantity: 3, notes: TRICKY, barcode: '012345678905', tags: ['Outdoor'], condition: 'needs repair', conditionNote: 'left strand dead', value: 2499, purchaseDate: '2023-11-24', warrantyUntil: '2025-11-24' }),
    item({ id: 'it-ORNAMENT', name: 'Glass ornaments 6 × ¾', category: 'Decorations', subcategory: 'Ornaments & hooks', binId: 'bn-XMAS0004', quantity: 40, approx: true, status: 'out', outWhere: 'Mantel', outSince: Date.UTC(2026, 11, 1, 18, 0) }),
    item({ id: 'it-DRILL222', name: 'Cordless drill', category: 'Tools', subcategory: 'Power', spotId: 'sp-PEGBRD01', status: 'lent', lentTo: 'Mike', lentOn: '2026-10-30', value: 12900, model: 'DCD771', serial: 'S/N 0042', keepAtLeast: 1 }),
    item({ id: 'it-NOHOME01', name: 'Mystery cable', category: 'Decorations', seasonId: 'se-HALLOW01', quantity: 0, condition: 'toss' }),
  ];
  const photos = [
    { id: 'ph-SNOW0001', ownerType: 'item' as const, ownerId: 'it-SNOWMAN2', kind: 'photo' as const, caption: 'Box, "front"', order: 0 },
    { id: 'ph-SNOW0002', ownerType: 'item' as const, ownerId: 'it-SNOWMAN2', kind: 'photo' as const, caption: '', order: 1 },
    { id: 'ph-DRILL001', ownerType: 'item' as const, ownerId: 'it-DRILL222', kind: 'photo' as const, caption: '', order: 0 },
    { id: 'ph-BIN00001', ownerType: 'bin' as const, ownerId: 'bn-XMAS0004', kind: 'photo' as const, caption: 'Inside', order: 0 },
    { id: 'ph-PEG00001', ownerType: 'spot' as const, ownerId: 'sp-PEGBRD01', kind: 'photo' as const, caption: '', order: 0 },
    { id: 'ph-SETUP001', ownerType: 'season' as const, ownerId: 'se-HALLOW01', kind: 'setup' as const, caption: 'Porch', order: 0 },
  ];
  const images = new Map<string, Blob>([
    ['ph-SNOW0001', jpeg(0xff, 0xd8, 0xff, 0x00, 0x01, 0x02, 0x0a, 0x0d, 0xff, 0xd9)],
    ['ph-SNOW0002', jpeg(0xff, 0xd8, 2)],
    ['ph-DRILL001', new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])], { type: 'image/png' })],
    ['ph-BIN00001', jpeg(0xff, 0xd8, 4)],
    ['ph-PEG00001', jpeg(0xff, 0xd8, 5)],
    ['ph-SETUP001', jpeg(0xff, 0xd8, 6)],
  ]);
  const categories = [
    { name: 'Lights', order: 0, subcategories: [] },
    { name: 'Empty category', order: 1, subcategories: [] },
    { name: 'Decorations', order: 2, subcategories: ['Garland', 'Empty sub', 'Ornaments & hooks'] },
    { name: 'Tools', order: 3, subcategories: ['Power'] },
  ];
  const tags = [{ name: 'Fragile', order: 0 }, { name: 'Outdoor', order: 1 }, { name: 'Heavy', order: 2 }, { name: 'Unused tag', order: 3 }];
  return { items, areas, spots, bins, seasons, tags, categories, photos, images };
}

async function planFor(db: InventoryDb, file: { name: string; bytes: Uint8Array }): Promise<RestorePlan> {
  const read = await readRestoreFile(file, await loadSnapshot(db));
  if (!read.ok) throw new Error(JSON.stringify(read.problems));
  return read.plan;
}

/** Everything restorable on a phone, photos as bytes, in a stable order. */
async function everything(db: InventoryDb) {
  const s = await loadSnapshot(db);
  const pics = await db.pictures.toArray();
  const photos = await Promise.all(
    pics.sort((a, b) => a.id.localeCompare(b.id)).map(async (p) => ({ id: p.id, ownerType: p.ownerType, ownerId: p.ownerId, kind: p.kind, caption: p.caption, order: p.order, type: p.full.type, bytes: await blobBytes(p.full) })),
  );
  const byId = <T extends { id: string }>(l: T[]) => [...l].sort((a, b) => a.id.localeCompare(b.id));
  return { ...s, items: byId(s.items), bins: byId(s.bins), photos };
}

describe('backup file names (§7)', () => {
  it('carry a local timestamp', () => {
    expect(backupFileName('full', new Date(2026, 10, 2, 9, 5))).toBe('home-inventory-backup-2026-11-02-0905.zip');
    expect(backupFileName('data', new Date(2026, 10, 2, 9, 5))).toBe('home-inventory-backup-2026-11-02-0905.csv');
  });
  it('are read back for the restore comparison', () => {
    expect(dateFromFileName('home-inventory-backup-2026-11-02-0905.zip')).toEqual(new Date(2026, 10, 2, 9, 5));
    expect(dateFromFileName('home-inventory-backup-2026-11-02.zip')).toEqual(new Date(2026, 10, 2));
    expect(dateFromFileName('backup.zip')).toBeNull();
  });
});

describe('full backup ZIP (F18, §7)', () => {
  it('has the §7 files, a manifest with counts, and photos/<photo id>', async () => {
    const db = newDb();
    await replaceAll(db, phoneData());
    const zip = await JSZip.loadAsync(await buildBackup(db, 'full', new Date(2026, 10, 2, 12, 0)));
    const names = Object.keys(zip.files).filter((n) => !zip.files[n]!.dir).sort();
    expect(names).toEqual(
      ['areas.csv', 'bins.csv', 'categories.csv', 'files.csv', 'items.csv', 'manifest.json', 'photos/ph-BIN00001.jpg', 'photos/ph-DRILL001.png', 'photos/ph-PEG00001.jpg', 'photos/ph-SETUP001.jpg', 'photos/ph-SNOW0001.jpg', 'photos/ph-SNOW0002.jpg', 'seasons.csv', 'spots.csv', 'tags.csv'].sort(),
    );
    const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'));
    expect(manifest).toMatchObject({ app: 'Hiebert Home Inventory', appVersion: '0.1.2', itemCount: 4, photoCount: 6, areaCount: 3, spotCount: 3, binCount: 2, seasonCount: 2 });
    const items = await zip.file('items.csv')!.async('string');
    expect(items.split('\r\n')[0]).toBe('﻿id,name,category,subcategory,bin_id,spot_id,quantity,approx,season_id,tags,status,out_where,out_since,lent_to,lent_on,condition,condition_note,barcode,notes,value,purchase_date,model,serial,warranty_until,keep_at_least');
    expect(items).toContain('it-DRILL222,Cordless drill,Tools,Power,,sp-PEGBRD01,0,,,,lent,,,Mike,2026-10-30,ok,,,,129.00,,DCD771,S/N 0042,,1');
    expect(await zip.file('bins.csv')!.async('string')).toContain('bn-XMAS0004,A-04,Christmas 4: lights & garland,sp-SHELFB01,se-XMAS0001,Fragile; Heavy,out,lid cracked,2026-11-01T15:30:00.000Z');
  });

  it('round-trips with nothing lost: every field, tricky text, list order, photos byte for byte with captions and order', async () => {
    const src = newDb();
    await replaceAll(src, phoneData(), 5);
    const before = await everything(src);
    const dst = newDb();
    const plan = await planFor(dst, await fileOf('b.zip', await buildBackup(src, 'full', new Date(2026, 10, 2, 12, 0))));
    expect(plan.format).toBe('h2');
    expect(plan.warnings).toEqual([]);
    expect(await applyRestore(dst, plan, 9)).toBe(6);
    const after = await everything(dst);
    expect(after).toEqual(before);
    expect(after.items.find((i) => i.id === 'it-SNOWMAN2')).toMatchObject({ notes: TRICKY, value: 2499, hasPhoto: true });
    expect(after.tags.map((t) => t.name)).toEqual(['Fragile', 'Outdoor', 'Heavy', 'Unused tag']);
    expect((await photosOf(dst, 'it-SNOWMAN2')).map((p) => p.caption)).toEqual(['Box, "front"', '']);
  });

  it('a second round trip gives the same files', async () => {
    const a = newDb();
    await replaceAll(a, phoneData());
    const when = new Date(2026, 10, 2, 12, 0);
    const first = await JSZip.loadAsync(await buildBackup(a, 'full', when));
    const b = newDb();
    await applyRestore(b, await planFor(b, await fileOf('a.zip', await buildBackup(a, 'full', when))));
    const second = await JSZip.loadAsync(await buildBackup(b, 'full', when));
    for (const name of Object.keys(first.files).filter((n) => !first.files[n]!.dir)) expect(await second.file(name)!.async('uint8array')).toEqual(await first.file(name)!.async('uint8array'));
  });

  it('files inside one top-level folder (a re-zipped backup) still restore', async () => {
    const src = newDb();
    await replaceAll(src, phoneData());
    const orig = await JSZip.loadAsync(await buildBackup(src, 'full', new Date()));
    const z = new JSZip();
    for (const [name, f] of Object.entries(orig.files)) if (!f.dir) z.file(`backup folder/${name}`, await f.async('uint8array'));
    const dst = newDb();
    await applyRestore(dst, await planFor(dst, { name: 'x.zip', bytes: await zipBytes(z) }));
    expect(await dst.pictures.count()).toBe(6);
  });
});

describe('data-only CSV (§7)', () => {
  it('is items.csv with the readable path and season first, and isn’t restorable', async () => {
    const db = newDb();
    await replaceAll(db, phoneData());
    const csv = buildDataCsv(await loadSnapshot(db));
    const lines = csv.split('\r\n');
    expect(lines[0]!.startsWith('﻿path,season,id,name,')).toBe(true);
    expect(csv).toContain('Attic › Shelf B › A-04 Christmas 4: lights & garland,Christmas,it-ORNAMENT,');
    expect(csv).toContain('Garage › Pegboard,,it-DRILL222,');
    expect(csv).toContain('No home yet,Halloween,it-NOHOME01,');
    const read = await readRestoreFile({ name: 'home-inventory-backup.csv', bytes: new TextEncoder().encode(csv) }, await loadSnapshot(db));
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.problems[0]!.message).toMatch(/only a full-backup ZIP can be restored/);
  });
});

describe('an H1 (0.1.1) backup still restores', () => {
  async function h1Zip(): Promise<Uint8Array> {
    const z = new JSZip();
    z.file('inventory.csv', '﻿id,name,category,subcategory,location,quantity,barcode,notes,photo_file\r\nit-AAAAAAAA,Snowman lights,decorations,Indoor,attic shelf b,3,012345678905,"left, ""dim""",photos/it-AAAAAAAA.jpg\r\nit-BBBBBBBB,Rake,Yard,,Shed,2,,,\r\nit-CCCCCCCC,Wreath,Decorations,,,1,,,photos/it-CCCCCCCC.jpg\r\n');
    z.file('locations.csv', 'name,notes,order\r\nGarage shelf,by the door,1\r\nAttic shelf B,,0\r\n');
    z.file('categories.csv', 'category,subcategory,order\r\nDecorations,Indoor,0\r\n');
    z.file('manifest.json', JSON.stringify({ app: 'Hiebert Home Inventory', appVersion: '0.1.1', savedAt: '2026-11-02T18:00:00.000Z', itemCount: 3, photoCount: 1 }));
    z.file('photos/it-AAAAAAAA.jpg', new Uint8Array([9, 8, 7]));
    return zipBytes(z);
  }

  it('locations become spots in Unsorted; items keep them; photos come along; default seasons added', async () => {
    const db = newDb();
    const plan = await planFor(db, { name: 'home-inventory-backup-2026-11-02-1200.zip', bytes: await h1Zip() });
    expect(plan.format).toBe('h1');
    expect(plan.warnings).toContain('This is a backup from version 0.1.1: its locations become spots in an “Unsorted” area.');
    expect(plan.savedAt).toEqual(new Date('2026-11-02T18:00:00.000Z'));
    await applyRestore(db, plan);
    const s = await loadSnapshot(db);
    expect(s.areas.map((a) => [a.name, a.letter])).toEqual([['Unsorted', 'U']]);
    expect(s.spots.map((x) => x.name)).toEqual(['Attic shelf B', 'Garage shelf', 'Shed']);
    const lights = s.items.find((i) => i.id === 'it-AAAAAAAA')!;
    expect(lights).toMatchObject({ category: 'Decorations', subcategory: 'Indoor', quantity: 3, barcode: '012345678905', notes: 'left, "dim"', spotId: s.spots[0]!.id, hasPhoto: true });
    expect(s.items.find((i) => i.id === 'it-BBBBBBBB')!.spotId).toBe(s.spots[2]!.id);
    expect(s.categories.map((c) => c.name)).toEqual(['Decorations', 'Yard']);
    expect(s.seasons.map((x) => x.name)).toEqual(DEFAULT_SEASONS.map((x) => x.name));
    const pics = await photosOf(db, 'it-AAAAAAAA');
    expect(pics.map((p) => p.id)).toEqual([expect.stringMatching(/^ph-/)]);
    expect(await blobBytes(pics[0]!.full)).toEqual([9, 8, 7]);
    // Its photo file is missing from the ZIP: the item comes back without one.
    expect(s.items.find((i) => i.id === 'it-CCCCCCCC')!.hasPhoto).toBe(false);
    expect(await db.pictures.count()).toBe(1);
  });
});

describe('restore keeps lists the backup lacks, and completes them (§7)', () => {
  it('a ZIP without categories.csv or tags.csv keeps the phone’s, adding only what the records use', async () => {
    const src = newDb();
    await replaceAll(src, phoneData());
    const orig = await JSZip.loadAsync(await buildBackup(src, 'full', new Date()));
    orig.remove('categories.csv');
    orig.remove('tags.csv');
    const dst = newDb();
    await replaceAll(dst, dataset({ categories: [{ name: 'Tools', order: 0, subcategories: ['Hand'] }], tags: [{ name: 'Kids', order: 0 }] }));
    const plan = await planFor(dst, { name: 'x.zip', bytes: await zipBytes(orig) });
    expect(plan.data.categories.map((c) => [c.name, c.subcategories])).toEqual([
      ['Tools', ['Hand', 'Power']],
      ['Decorations', ['Ornaments & hooks']],
      ['Lights', []],
    ]);
    // Added in the order the items (stored by id) first use them.
    expect(plan.addedCategories).toEqual(['Tools › Power', 'Decorations', 'Decorations › Ornaments & hooks', 'Lights']);
    expect(plan.data.tags.map((t) => t.name)).toEqual(['Kids', 'Fragile', 'Heavy', 'Outdoor']);
    expect(plan.addedTags).toEqual(['Fragile', 'Heavy', 'Outdoor']);
  });

  it('hand-edited capitals take the list’s spelling', async () => {
    const src = newDb();
    await replaceAll(src, phoneData());
    const z = await JSZip.loadAsync(await buildBackup(src, 'full', new Date()));
    z.file('items.csv', (await z.file('items.csv')!.async('string')).replace('it-DRILL222,Cordless drill,Tools,Power', 'it-DRILL222,Cordless drill,TOOLS,power'));
    const plan = await planFor(newDb(), { name: 'x.zip', bytes: await zipBytes(z) });
    expect(plan.data.items.find((i) => i.id === 'it-DRILL222')).toMatchObject({ category: 'Tools', subcategory: 'Power' });
  });
});

describe('restore never half-applies (F18)', () => {
  it('a file with bad rows is refused with row numbers; nothing changes', async () => {
    const src = newDb();
    await replaceAll(src, phoneData());
    const z = await JSZip.loadAsync(await buildBackup(src, 'full', new Date()));
    const csv = await z.file('items.csv')!.async('string');
    z.file('items.csv', csv.replace(',lent,', ',borrowed,').replace(',129.00,', ',12.345,'));
    const read = await readRestoreFile({ name: 'x.zip', bytes: await zipBytes(z) }, await loadSnapshot(src));
    expect(read.ok).toBe(false);
    if (!read.ok) {
      expect(read.problems).toEqual([
        { file: 'items.csv', row: 2, message: 'status "borrowed" must be one of: stored, out, lent' },
        { file: 'items.csv', row: 2, message: 'value "12.345" has more than 2 decimal places' },
      ]);
    }
  });

  it('records that don’t fit together are refused, naming the problem', async () => {
    const src = newDb();
    await replaceAll(src, phoneData());
    const z = await JSZip.loadAsync(await buildBackup(src, 'full', new Date()));
    z.file('bins.csv', (await z.file('bins.csv')!.async('string')).replace('G-12', 'A-04'));
    z.file('spots.csv', (await z.file('spots.csv')!.async('string')).replace('sp-BENCH001,ar-GARAGE01', 'sp-BENCH001,ar-NOWHERE1'));
    const read = await readRestoreFile({ name: 'x.zip', bytes: await zipBytes(z) }, await loadSnapshot(src));
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.problems.map((p) => p.message)).toEqual(['bin code A-04 is used by two bins ("Christmas 4: lights & garland" and "Tote with no spot")', 'spot "Bench" is in area ar-NOWHERE1, which isn\'t there']);
  });

  it('garbage, a ZIP without items.csv, and an empty backup are refused', async () => {
    const db = newDb();
    const snap = await loadSnapshot(db);
    const garbage = await readRestoreFile({ name: 'x.zip', bytes: new Uint8Array([0x50, 0x4b, 3, 4, 1, 2, 3]) }, snap);
    expect(garbage.ok || garbage.problems[0]!.message).toMatch(/isn't a readable ZIP/);
    const z = new JSZip();
    z.file('notes.txt', 'hello');
    const noItems = await readRestoreFile({ name: 'x.zip', bytes: await zipBytes(z) }, snap);
    expect(noItems.ok || noItems.problems[0]!.message).toMatch(/no items.csv/);
    const empty = new JSZip();
    empty.file('items.csv', 'id,name,category,quantity\r\n');
    const e = await readRestoreFile({ name: 'x.zip', bytes: await zipBytes(empty) }, snap);
    expect(e.ok || e.problems[0]!.message).toMatch(/would empty this phone/);
    expect(looksLikeZip(new TextEncoder().encode('id,name'))).toBe(false);
  });

  it('a failure inside the transaction leaves the phone unchanged', async () => {
    const src = newDb();
    await replaceAll(src, phoneData());
    const plan = await planFor(newDb(), await fileOf('x.zip', await buildBackup(src, 'full', new Date())));
    const dst = newDb();
    await replaceAll(dst, dataset({ areas: [area({ id: 'ar-KEEP0001', name: 'Keep' })], items: [item({ id: 'keep' })] }));
    const before = await everything(dst);
    const spy = vi.spyOn(dst.pictures, 'bulkAdd').mockRejectedValueOnce(new Error('disk full'));
    await expect(applyRestore(dst, plan)).rejects.toThrow('disk full');
    spy.mockRestore();
    expect(await everything(dst)).toEqual(before);
  });

  it('restore never touches settings such as the backup clock', async () => {
    const src = newDb();
    await replaceAll(src, phoneData());
    const dst = newDb();
    await recordBackup(dst, 1234);
    await applyRestore(dst, await planFor(dst, await fileOf('x.zip', await buildBackup(src, 'full', new Date()))), 99);
    const s = await getSettings(dst);
    expect(s.lastBackupAt).toBe(1234);
    expect(s.lastChangeAt).toBe(99);
  });
});
