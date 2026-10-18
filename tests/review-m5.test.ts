import 'fake-indexeddb/auto';
import JSZip from 'jszip';
import { afterEach, describe, expect, it } from 'vitest';
import { buildBackup } from '../src/data/backup';
import { InventoryDb } from '../src/data/db';
import { loadSnapshot, replaceAll } from '../src/data/inventory';
import { applyPriceImport } from '../src/data/price-import';
import { backupDue } from '../src/domain/backup-reminder';
import { planPriceImport } from '../src/io/price-import';
import { readRestoreFile } from '../src/io/restore';
import { readSeed } from '../src/io/seed';
import { item, seedBytes, vendor } from './helpers';

const dbs: InventoryDb[] = [];
afterEach(() => {
  for (const d of dbs.splice(0)) d.close();
});
const newDb = () => {
  const d = new InventoryDb(`rv-${Math.random()}`);
  dbs.push(d);
  return d;
};
const suppliers = [
  { name: 'REV', website: '', notes: '' },
  { name: 'WCP', website: '', notes: '' },
  { name: 'other', website: '', notes: '' },
];

describe('review M5', () => {
  it('round trip of odd ids / notes / names through full ZIP', async () => {
    const long = 'x'.repeat(50_000) + '\n' + '"q"';
    const items = [
      item({ id: 'a/b', name: '=HYPERLINK("http://e")', notes: 'tab\tinside\rlone CR\n+1 -2 @x', vendors: [vendor({ partNo: '0012', url: 'https://x.com/a,b' }), null, null] }),
      item({ id: 'x y#é', name: 'Ünï 🤖', notes: long, barcode: '0001', vendors: [vendor({ packPriceCents: 0 }), null, vendor({ supplier: 'WCP', packPriceCents: null })], preferredVendor: 3 }),
      item({ id: 'p.png', name: 'n', vendors: [vendor(), null, null] }),
    ];
    const src = newDb();
    await replaceAll(src, {
      items,
      photos: new Map([
        ['a/b', new Blob([new Uint8Array([1, 2])], { type: 'image/jpeg' })],
        ['p.png', new Blob([new Uint8Array([3])], { type: 'image/png' })],
      ]),
      suppliers,
      locations: [],
      categories: [],
    });
    const before = await loadSnapshot(src);
    const zip = await buildBackup(src, 'full', new Date());
    const dst = newDb();
    const read = await readRestoreFile({ name: 'z.zip', bytes: new Uint8Array(await zip.arrayBuffer()) }, await loadSnapshot(dst));
    if (!read.ok) throw new Error(JSON.stringify(read.problems));
    await replaceAll(dst, read.plan, 1);
    const after = await loadSnapshot(dst);
    expect(after.items).toEqual(before.items);
    expect(await dst.photos.count()).toBe(2);
  });

  it('FINDING: §10 workflow — re-importing an OLD data-only export reverts vendor edits and resurrects a deleted vendor option', async () => {
    const db = newDb();
    await replaceAll(db, {
      items: [item({ id: 'st-0001', vendors: [vendor({ supplier: 'REV', partNo: 'OLD-1', packPriceCents: 1000 }), vendor({ supplier: 'WCP', partNo: 'W-1' }), null] })],
      photos: new Map(),
      suppliers,
      locations: [],
      categories: [],
    });
    const exported = await (await buildBackup(db, 'data', new Date())).text();
    // After the export, a mentor fixes the part number and removes vendor option 2.
    const row = (await db.items.get('st-0001'))!;
    await db.items.put({ ...row, vendors: [{ ...row.vendors[0]!, partNo: 'NEW-1' }, null, null] });
    // Claude only changes the price in the exported file; it's imported as-is otherwise.
    const r = planPriceImport(exported.replace('10.00', '12.00'), 'p.csv', await loadSnapshot(db));
    if (!r.ok) throw new Error(JSON.stringify(r.problems));
    await applyPriceImport(db, r.plan);
    const it = (await loadSnapshot(db)).items[0]!;
    expect(it.vendors[0]!.packPriceCents).toBe(1200);
    // These document the data loss:
    expect(it.vendors[0]!.partNo).toBe('OLD-1'); // mentor's fix reverted
    expect(it.vendors[1]).not.toBeNull(); // deleted option is back
  });

  it('FINDING: a "v01_pack_price" header is accepted but its values are silently dropped', () => {
    const items = [item({ id: 'st-0001', vendors: [vendor({ packPriceCents: 1000 }), null, null] })];
    const r = planPriceImport('id,v01_pack_price\r\nst-0001,99.00', 'p.csv', { items, suppliers });
    expect(r.ok).toBe(true); // no "unknown column" error
    if (r.ok) expect(r.plan.items).toEqual([]); // nothing changes, no message why
  });

  it('FINDING: a blank first line makes the real header row 2 but the error says row 1 "missing column"', () => {
    const items = [item({ id: 'st-0001' })];
    const r = planPriceImport('\r\nid,v1_pack_price\r\nst-0001,9', 'p.csv', { items, suppliers });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems).toContainEqual(expect.objectContaining({ row: 1, message: 'missing column: id' }));
  });

  it('seed exported as data-only CSV re-imports as a price file with no errors', async () => {
    const seed = await readSeed(seedBytes());
    if (!seed.ok) throw new Error('seed');
    const db = newDb();
    await replaceAll(db, seed.data);
    const text = await (await buildBackup(db, 'data', new Date())).text();
    const r = planPriceImport(text, 'p.csv', await loadSnapshot(db));
    if (!r.ok) throw new Error(JSON.stringify(r.problems.slice(0, 5)));
    expect(r.plan.optionsChanged).toBe(0);
  });

  it('FINDING: restore accepts a vendor url "javascript:alert(1)" and a website with no scheme check (price import / editor would reject)', async () => {
    const csv = 'id,name,category,unit,on_hand,desired,v1_supplier,v1_pack_size,v1_url\r\na1,A,Motors,each,1,1,REV,1,javascript:alert(1)';
    const read = await readRestoreFile({ name: 'x.csv', bytes: new TextEncoder().encode(csv) }, { items: [], suppliers, locations: [], categories: [] });
    expect(read.ok).toBe(true);
    if (read.ok) expect(read.plan.items[0]!.vendors[0]!.url).toBe('javascript:alert(1)');
  });

  it('FINDING: Windows-1252 inventory.csv inside a ZIP is decoded as UTF-8 silently (mojibake, no warning)', async () => {
    const head = new TextEncoder().encode('id,name,category,unit,on_hand,desired,v1_supplier,v1_pack_size\r\nw1,Bolt ');
    const bytes = new Uint8Array([...head, 0xd7, ...new TextEncoder().encode(',Fasteners,each,1,1,REV,1\r\n')]);
    const z = new JSZip();
    z.file('inventory.csv', bytes);
    const read = await readRestoreFile({ name: 'x.zip', bytes: await z.generateAsync({ type: 'uint8array' }) }, { items: [], suppliers, locations: [], categories: [] });
    if (!read.ok) throw new Error(JSON.stringify(read.problems));
    expect(read.plan.items[0]!.name).toBe('Bolt �');
    expect(read.plan.warnings).toEqual([]);
  });

  it('FINDING: clock moved backwards — a backup stamped in the future suppresses the reminder', () => {
    const DAY = 86_400_000;
    const now = Date.UTC(2026, 9, 18);
    expect(backupDue({ lastBackupAt: now + 365 * DAY, setupDoneAt: now - 400 * DAY, reminderDays: 7 }, now)).toBe(false);
  });
});
