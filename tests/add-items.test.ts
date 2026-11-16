import 'fake-indexeddb/auto';
import JSZip from 'jszip';
import { afterEach, describe, expect, it } from 'vitest';
import { applyAddItems, getAddUndo, undoAddItems } from '../src/data/add-items';
import { applyRestore } from '../src/data/backup';
import { InventoryDb, toOrderListRow } from '../src/data/db';
import { loadSnapshot, replaceAll, setOnHand } from '../src/data/inventory';
import { MAX_ADD_ZIP_ENTRIES, planAddItems, readAddFile, type AddPlan } from '../src/io/add-items';
import { buildBackup } from '../src/data/backup';
import { readBackupZip } from '../src/io/bundle';
import { planRestore } from '../src/io/restore';
import { item, seedBytes, vendor } from './helpers';

const dbs: InventoryDb[] = [];
afterEach(() => {
  for (const d of dbs.splice(0)) d.close();
});

const suppliers = [
  { name: 'REV', website: '', notes: '' },
  { name: 'WCP', website: '', notes: '' },
];
const categories = [{ name: 'Motors', order: 0, subcategories: ['Brushless'] }];
const existing = () => [
  item({ id: 'st-0001', name: 'NEO 2.0 Motor', category: 'Motors', onHand: 3, desired: 4, vendors: [vendor({ supplier: 'REV', partNo: 'REV-21-1650' }), null, null] }),
  item({ id: 'tm-7K3QX', name: '1/2 in. hex shaft', category: 'Motors', barcode: '0123456789012', vendors: [vendor({ supplier: 'WCP', partNo: 'WCP-0101' }), null, null] }),
];

async function setup() {
  const db = new InventoryDb(`add-${Math.random()}`);
  dbs.push(db);
  await replaceAll(db, { items: existing(), photos: new Map(), suppliers, locations: [], categories }, 5);
  return db;
}

const HEAD = 'name,category,subcategory,unit,barcode,notes,preferred_vendor,photo_file,v1_supplier,v1_part_no,v1_url,v1_pack_size,v1_pack_price,v1_price_checked';
async function restorePlan(backup: Uint8Array, current: Awaited<ReturnType<typeof loadSnapshot>>) {
  const b = await readBackupZip(backup);
  if (!b.bundle) throw new Error(JSON.stringify(b.problems));
  return planRestore(b.bundle, current, { name: 'backup.zip', size: backup.length });
}
const csv = (...lines: string[]) => [HEAD, ...lines].join('\r\n');
const bytes = (s: string) => new TextEncoder().encode(s);

async function read(text: string) {
  const r = await readAddFile(bytes(text), 'add.csv');
  if (!r.ok) throw new Error(JSON.stringify(r.problems));
  return r.file;
}
async function planOf(text: string, current = { items: existing(), suppliers, categories }): Promise<AddPlan> {
  return planAddItems(await read(text), current);
}

describe('reading the file (§23.1)', () => {
  it('reads a bare CSV by header name, with a BOM and quoted cells', async () => {
    const f = await read('﻿' + csv('"Hex bolt, 1/4 in.",Fasteners,Bolts,each,,"two\nlines",,,REV,REV-9,www.rev.com/x,10,"$12.50",11/02/2026'));
    expect(f.rows).toHaveLength(1);
    const it = f.rows[0]!.item;
    expect(it).toMatchObject({ name: 'Hex bolt, 1/4 in.', category: 'Fasteners', subcategory: 'Bolts', notes: 'two\nlines', source: 'team' });
    expect(it.vendors[0]).toEqual({ supplier: 'REV', partNo: 'REV-9', url: 'https://www.rev.com/x', packSize: 10, packPriceCents: 1250, priceChecked: '2026-11-02' });
  });

  it('ignores id, location, on_hand, desired and spares: new items start at 0, no location, never counted', async () => {
    const f = await read('id,name,category,unit,location,on_hand,desired,spares,last_counted,v1_supplier,v1_pack_size\r\nst-9,Widget,Motors,each,Shelf 3,7,8,2,2026-10-01,REV,1');
    expect(f.rows[0]!.item).toMatchObject({ onHand: 0, desired: 0, spares: 0, location: '', lastCounted: '', countedBy: '' });
    expect(f.ignoredColumns).toEqual(['id', 'location', 'on_hand', 'desired', 'spares', 'last_counted']);
  });

  it('refuses a file that is not a catalog', async () => {
    const r = await readAddFile(bytes('a,b\r\n1,2'), 'x.csv');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems[0]!.message).toMatch(/missing columns name, category, unit/);
  });

  it('refuses a ZIP with no inventory.csv, a count kit and a counts file', async () => {
    const zipOf = async (files: Record<string, string>) => {
      const z = new JSZip();
      for (const [k, v] of Object.entries(files)) z.file(k, v);
      return z.generateAsync({ type: 'uint8array' });
    };
    const none = await readAddFile(await zipOf({ 'readme.txt': 'x' }), 'a.zip');
    const kit = await readAddFile(await zipOf({ 'inventory.csv': csv(), 'kit.json': '{}' }), 'a.zip');
    const counts = await readAddFile(await zipOf({ 'counts.json': '{}' }), 'a.zip');
    expect([none, kit, counts].map((r) => r.ok)).toEqual([false, false, false]);
    expect((none as { problems: { message: string }[] }).problems[0]!.message).toMatch(/no inventory\.csv/);
    expect((kit as { problems: { message: string }[] }).problems[0]!.message).toMatch(/count kit/);
    expect((counts as { problems: { message: string }[] }).problems[0]!.message).toMatch(/counts file/);
  });

  it('refuses a ZIP with too many files, before reading any', async () => {
    const z = new JSZip();
    z.file('inventory.csv', csv());
    for (let i = 0; i < MAX_ADD_ZIP_ENTRIES; i++) z.file(`photos/${i}.jpg`, 'x');
    const r = await readAddFile(await z.generateAsync({ type: 'uint8array' }), 'big.zip');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems[0]!.message).toMatch(/2000/);
  });

  it('reads the starter catalog ZIP: categories, suppliers and photos', async () => {
    const r = await readAddFile(seedBytes(), 'seed.zip');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.file.rows.length + r.file.skipped.length).toBe(129);
    expect(r.file.skipped).toEqual([]);
    expect(r.file.categories?.map((c) => c.name)[0]).toBe('Electrical');
    expect(r.file.photos.size).toBe(128);
    expect(r.file.rows.every((x) => x.item.onHand === 0 && x.item.desired === 0 && x.item.id === 'new')).toBe(true);
  });
});

describe('skipped rows (§23.2 item 3)', () => {
  it('lists each reason with its row, and the good rows still import', async () => {
    const p = await planOf(
      csv(
        ',Motors,,each,,,,,REV,R-1,,1,1.00,', // missing name
        'No category,,,each,,,,,REV,R-2,,1,1.00,',
        'No unit,Motors,,,,,,,REV,R-3,,1,1.00,',
        'No vendor,Motors,,each,,,,,,,,,,',
        'Bad pack,Motors,,each,,,,,REV,R-4,,0,1.00,',
        'No pack,Motors,,each,,,,,REV,R-5,,,1.00,',
        'Bad price,Motors,,each,,,,,REV,R-6,,1,abc,',
        'Bad date,Motors,,each,,,,,REV,R-7,,1,1.00,yesterday',
        'Sci barcode,Motors,,each,1.23e+12,,,,REV,R-8,,1,1.00,',
        'Good,Motors,,each,,,,,REV,R-10,,1,1.00,2026-11-02',
      ),
    );
    expect(p.newItems.map((n) => n.item.name)).toEqual(['Good']);
    expect(p.skipped.map((s) => s.row)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(p.skipped.map((s) => s.message)).toEqual([
      expect.stringMatching(/name is missing/),
      expect.stringMatching(/category is missing/),
      expect.stringMatching(/unit is missing/),
      expect.stringMatching(/no vendor option/),
      expect.stringMatching(/pack size must be a whole number ≥ 1/),
      expect.stringMatching(/pack size is missing/),
      expect.stringMatching(/not a dollar amount/),
      expect.stringMatching(/must be a date like 2026-10-17/),
      expect.stringMatching(/scientific notation/),
    ]);
  });

  it('a file with no good rows adds nothing', async () => {
    const p = await planOf(csv('No unit,Motors,,,,,,,REV,R-3,,1,1.00,'));
    expect(p.newItems).toEqual([]);
    expect(p.skipped).toHaveLength(1);
  });
});

describe('already present (§23.2 item 2)', () => {
  it('the same supplier and part number, ignoring capitals and spaces, is present', async () => {
    const p = await planOf(csv('Totally different name,Motors,,each,,,,,rev,  rev-21-1650 ,,1,9.99,'));
    expect(p.newItems).toEqual([]);
    expect(p.present).toEqual([{ row: 2, name: 'Totally different name', reason: expect.stringContaining('same part number') }]);
  });

  it('the same name under another category or supplier is present', async () => {
    const p = await planOf(csv('1/2 IN.  hex   shaft,Mechanical,,each,,,,,AndyMark,AM-1,,1,9.99,'));
    expect(p.newItems).toEqual([]);
    expect(p.present[0]!.reason).toMatch(/same name as “1\/2 in\. hex shaft”/);
  });

  it('a part number held only by another supplier does not match', async () => {
    const p = await planOf(csv('New thing,Motors,,each,,,,,WCP,REV-21-1650,,1,9.99,'));
    expect(p.newItems.map((n) => n.item.name)).toEqual(['New thing']);
  });

  it('a repeat inside the file keeps the first row and skips the later one', async () => {
    const p = await planOf(csv('Thing,Motors,,each,,,,,REV,T-1,,1,1.00,', 'Other name,Motors,,each,,,,,REV,t-1,,1,2.00,', 'thing,Motors,,each,,,,,REV,T-9,,1,3.00,'));
    expect(p.newItems.map((n) => n.row)).toEqual([2]);
    expect(p.skipped.map((s) => [s.row, s.message])).toEqual([
      [3, expect.stringMatching(/repeats an earlier row/)],
      [4, expect.stringMatching(/repeats an earlier row/)],
    ]);
  });

  it('a row with no part number matches only by name', async () => {
    const p = await planOf(csv('A,Motors,,each,,,,,REV,,,1,1.00,', 'B,Motors,,each,,,,,REV,,,1,1.00,'));
    expect(p.newItems.map((n) => n.item.name)).toEqual(['A', 'B']);
  });
});

describe('lists the add creates (§23.2 item 4)', () => {
  it('reuses the tablet’s spelling for categories, subcategories and suppliers', async () => {
    const p = await planOf(csv('Thing,motors,BRUSHLESS,each,,,,,rev,T-1,,1,1.00,'));
    expect(p.newItems[0]!.item).toMatchObject({ category: 'Motors', subcategory: 'Brushless' });
    expect(p.newItems[0]!.item.vendors[0]!.supplier).toBe('REV');
    expect([p.newCategories, p.newSubcategories, p.newSuppliers]).toEqual([[], [], []]);
  });

  it('creates what is missing, in the file’s category order, with websites from suppliers.csv', async () => {
    const z = new JSZip();
    z.file('inventory.csv', csv('A,Zeta,Zs,each,,,,,Acme,A-1,,1,1.00,', 'B,Alpha,,each,,,,,Acme,B-1,,1,1.00,', 'C,Motors,New sub,each,,,,,ACME,C-1,,1,1.00,'));
    z.file('categories.csv', 'category,subcategory,order\r\nAlpha,,1\r\nZeta,Zs,2');
    z.file('suppliers.csv', 'name,website,notes\r\nacme,https://acme.example,Hi');
    const r = await readAddFile(await z.generateAsync({ type: 'uint8array' }), 'a.zip');
    if (!r.ok) throw new Error('read');
    const p = planAddItems(r.file, { items: existing(), suppliers, categories });
    expect(p.newCategories).toEqual([
      { name: 'Alpha', order: 1, subcategories: [] },
      { name: 'Zeta', order: 2, subcategories: ['Zs'] },
    ]);
    expect(p.newSubcategories).toEqual([{ category: 'Motors', name: 'New sub' }]);
    expect(p.newSuppliers).toEqual([{ name: 'Acme', website: 'https://acme.example', notes: 'Hi' }]);
    expect(p.newItems.find((n) => n.row === 4)!.item.vendors[0]!.supplier).toBe('Acme');
  });

  it('a barcode already on another item is left off, and counted', async () => {
    const p = await planOf(csv('Thing,Motors,,each,0123456789012,,,,REV,T-1,,1,1.00,'));
    expect(p.newItems[0]!.item.barcode).toBe('');
    expect(p.barcodesCleared).toBe(1);
  });

  it('preferred vendor: the file’s choice when that option exists, else the first option filled', async () => {
    const t = 'name,category,unit,preferred_vendor,v2_supplier,v2_pack_size,v3_supplier,v3_pack_size\r\n';
    const a = planAddItems(await read(t + 'A,Motors,each,3,REV,1,WCP,1'), { items: [], suppliers, categories });
    const b = planAddItems(await read(t + 'B,Motors,each,1,REV,1,WCP,1'), { items: [], suppliers, categories });
    expect([a.newItems[0]!.item.preferredVendor, b.newItems[0]!.item.preferredVendor]).toEqual([3, 2]);
  });
});

describe('adding (§23.3, §23.4)', () => {
  it('adds new items with count 0, new ids, source team; existing data is untouched', async () => {
    const db = await setup();
    await setOnHand(db, 'st-0001', 9, 50);
    const before = await loadSnapshot(db);
    const p = await planOf(csv('Thing,Motors,,each,,note,,,Acme,T-1,,2,5.00,2026-11-02', 'NEO 2.0 MOTOR,Motors,,each,,,,,REV,X,,1,1.00,'), { items: before.items, suppliers: before.suppliers, categories: before.categories });
    const res = await applyAddItems(db, p, 100);
    expect(res).toMatchObject({ added: 1, skippedLate: 0, suppliers: 1, categories: 0 });
    const after = await loadSnapshot(db);
    expect(after.items).toHaveLength(3);
    const added = after.items.find((i) => i.name === 'Thing')!;
    expect(added).toMatchObject({ source: 'team', onHand: 0, desired: 0, spares: 0, lastCounted: '', location: '' });
    expect(added.id).toMatch(/^tm-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{5}$/);
    // Everything that was there is exactly as it was.
    for (const old of before.items) expect(after.items.find((i) => i.id === old.id)).toEqual(old);
    expect(after.suppliers.map((s) => s.name).sort()).toEqual(['Acme', 'REV', 'WCP']);
    expect(after.locations).toEqual(before.locations);
  });

  it('stores photos from the ZIP and marks the item', async () => {
    const db = await setup();
    const z = new JSZip();
    z.file('inventory.csv', csv('Pic,Motors,,each,,,,photos/a.jpg,REV,P-1,,1,1.00,', 'Lost,Motors,,each,,,,photos/none.jpg,REV,P-2,,1,1.00,'));
    z.file('photos/a.jpg', new Uint8Array([1, 2, 3]));
    const r = await readAddFile(await z.generateAsync({ type: 'uint8array' }), 'a.zip');
    if (!r.ok) throw new Error('read');
    const snap = await loadSnapshot(db);
    const p = planAddItems(r.file, snap);
    expect(p.missingPhotos).toBe(1);
    const res = await applyAddItems(db, p, 100);
    expect(res).toMatchObject({ added: 2, photos: 1 });
    const items = (await loadSnapshot(db)).items;
    expect(items.find((i) => i.name === 'Pic')!.hasPhoto).toBe(true);
    expect(items.find((i) => i.name === 'Lost')!.hasPhoto).toBe(false);
    expect(await db.photos.count()).toBe(1);
  });

  it('skips an item that became present between the preview and the add', async () => {
    const db = await setup();
    const snap = await loadSnapshot(db);
    const p = planAddItems(await read(csv('Fresh,Motors,,each,,,,,REV,F-1,,1,1.00,')), snap);
    await db.items.put({ ...(await db.items.get('st-0001'))!, name: 'Fresh' });
    expect(await applyAddItems(db, p, 100)).toMatchObject({ added: 0, skippedLate: 1 });
    expect(await getAddUndo(db)).toBeNull();
  });

  it('a full backup and restore keeps the added items', async () => {
    const db = await setup();
    await applyAddItems(db, await planOf(csv('Thing,Motors,,each,,,,,REV,T-1,,1,1.00,')), 100);
    const backup = new Uint8Array(await (await buildBackup(db, 'full', new Date())).arrayBuffer());
    const db2 = new InventoryDb(`add-${Math.random()}`);
    dbs.push(db2);
    const r = await restorePlan(backup, await loadSnapshot(db2));
    if (!r.ok) throw new Error(JSON.stringify(r.problems));
    await applyRestore(db2, r.plan, 200);
    expect((await loadSnapshot(db2)).items.map((i) => i.name).sort()).toEqual(['1/2 in. hex shaft', 'NEO 2.0 Motor', 'Thing']);
  });
});

describe('Undo this import (§23.4)', () => {
  async function added(db: InventoryDb, text: string, now = 100) {
    const snap = await loadSnapshot(db);
    await applyAddItems(db, planAddItems(await read(text), snap), now);
    return (await loadSnapshot(db)).items;
  }

  it('removes the items and the lists the add created, and nothing else', async () => {
    const db = await setup();
    const before = await loadSnapshot(db);
    await added(db, csv('A,Newcat,Sub,each,,,,,Acme,A-1,,1,1.00,', 'B,Motors,Fresh sub,each,,,,,REV,B-1,,1,1.00,'));
    expect(await undoAddItems(db, 200)).toEqual({ removed: 2, kept: [] });
    const after = await loadSnapshot(db);
    expect(after).toEqual(before);
    expect(await getAddUndo(db)).toBeNull();
  });

  it('keeps and names an added item that was counted, edited or ordered since', async () => {
    const db = await setup();
    const items = await added(db, csv('Counted,Motors,,each,,,,,Acme,A-1,,1,1.00,', 'Ordered,Motors,,each,,,,,Acme,A-2,,1,1.00,', 'Untouched,Motors,,each,,,,,REV,A-3,,1,1.00,'));
    const id = (n: string) => items.find((i) => i.name === n)!.id;
    await setOnHand(db, id('Counted'), 4, 150);
    await db.orderLists.add(toOrderListRow({ id: 'L1', name: 'List', notes: '', lines: [{ itemId: id('Ordered'), qty: 1 }] } as never));
    const res = await undoAddItems(db, 200);
    expect(res.removed).toBe(1);
    expect(res.kept.sort()).toEqual(['Counted', 'Ordered']);
    const left = await loadSnapshot(db);
    expect(left.items.map((i) => i.name).sort()).toEqual(['1/2 in. hex shaft', 'Counted', 'NEO 2.0 Motor', 'Ordered']);
    // Acme is still used by the kept items, so it stays.
    expect(left.suppliers.map((s) => s.name)).toContain('Acme');
  });

  it('is one level: a second add replaces it, and a restore forgets it', async () => {
    const db = await setup();
    await added(db, csv('A,Motors,,each,,,,,REV,A-1,,1,1.00,'));
    const first = await getAddUndo(db);
    await added(db, csv('B,Motors,,each,,,,,REV,B-1,,1,1.00,'), 150);
    const second = await getAddUndo(db);
    expect(second!.items).toHaveLength(1);
    expect(second!.items[0]![0]).not.toBe(first!.items[0]![0]);
    const backup = new Uint8Array(await (await buildBackup(db, 'full', new Date())).arrayBuffer());
    const r = await restorePlan(backup, await loadSnapshot(db));
    if (!r.ok) throw new Error('plan');
    await applyRestore(db, r.plan, 300);
    expect(await getAddUndo(db)).toBeNull();
    await expect(undoAddItems(db)).rejects.toThrow(/no import to undo/);
  });
});
