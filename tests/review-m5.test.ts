import 'fake-indexeddb/auto';
import JSZip from 'jszip';
import { afterEach, describe, expect, it } from 'vitest';
import { buildBackup } from '../src/data/backup';
import { InventoryDb } from '../src/data/db';
import { loadSnapshot, replaceAll } from '../src/data/inventory';
import { applyPriceImport } from '../src/data/price-import';
import { SNOOZE_MS, backupDue, backupInFuture, showBackupBanner } from '../src/domain/backup-reminder';
import { readCsv } from '../src/io/csv';
import { planPriceImport } from '../src/io/price-import';
import { readRestoreFile } from '../src/io/restore';
import { readSeed } from '../src/io/seed';
import { item, seedBytes, vendor } from './helpers';

// Independent fresh-session review of M5 (docs/reviews/M5-independent.md). Tests named
// "open:" asserted behaviour that was reported and left as it was; M23 fixed findings 3–6, so
// every test here now guards a fix.

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

describe('M5 independent review', () => {
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

  it('finding 1: an OLD data-only export would revert vendor edits and bring back a deleted option, so the preview flags both', async () => {
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
    // Shown before the PIN: the price change, plus the part # and the new option flagged.
    expect(r.plan.detailChanges).toBe(2);
    expect(r.plan.preview).toEqual([
      {
        id: 'st-0001',
        name: 'Test item',
        options: [
          {
            slot: 1,
            adds: false,
            changes: [
              { field: 'part #', before: 'NEW-1', after: 'OLD-1' },
              { field: 'pack price', before: '$10.00', after: '$12.00' },
            ],
          },
          { slot: 2, adds: true, changes: expect.arrayContaining([{ field: 'supplier', before: '—', after: 'WCP' }, { field: 'part #', before: '—', after: 'W-1' }]) },
        ],
      },
    ]);
    // A mentor who imports anyway gets exactly what the preview listed.
    await applyPriceImport(db, r.plan);
    const it = (await loadSnapshot(db)).items[0]!;
    expect(it.vendors[0]!.packPriceCents).toBe(1200);
    expect(it.vendors[0]!.partNo).toBe('OLD-1');
    expect(it.vendors[1]).not.toBeNull();
  });

  it('finding 1: a price-only file shows no detail changes', async () => {
    const items = [item({ id: 'st-0001', vendors: [vendor({ packPriceCents: 1000, priceChecked: '2026-01-01' }), null, null] })];
    const r = planPriceImport('id,v1_pack_price,v1_price_checked\r\nst-0001,12.00,2026-11-02', 'p.csv', { items, suppliers });
    if (!r.ok) throw new Error(JSON.stringify(r.problems));
    expect(r.plan.detailChanges).toBe(0);
    expect(r.plan.preview[0]!.options[0]!.changes).toEqual([
      { field: 'pack price', before: '$10.00', after: '$12.00' },
      { field: 'price checked', before: '2026-01-01', after: '2026-11-02' },
    ]);
  });

  it('finding 2: a zero-padded slot header ("v01_pack_price") is an unknown column, not silently dropped', () => {
    const items = [item({ id: 'st-0001', vendors: [vendor({ packPriceCents: 1000 }), null, null] })];
    for (const h of ['v01_pack_price', 'v001_pack_price', 'v03_supplier']) {
      const r = planPriceImport(`id,${h}\r\nst-0001,99.00`, 'p.csv', { items, suppliers });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.problems[0]!.message).toContain(`column “${h}” isn’t recognized`);
    }
  });

  it('finding 5 (fixed in M23): blank lines before the header are skipped; data rows and header problems keep their real row numbers', () => {
    const items = [item({ id: 'st-0001', vendors: [vendor({ packPriceCents: 100 }), null, null] })];
    const ok = planPriceImport('\r\n\r\nid,v1_pack_price\r\nst-0001,9', 'p.csv', { items, suppliers });
    expect(ok.ok).toBe(true);
    const bad = planPriceImport('\r\nv1_pack_price\r\n9', 'p.csv', { items, suppliers });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.problems).toContainEqual(expect.objectContaining({ row: 2, message: 'missing column: id' }));
    const t = readCsv(' , \r\nid,id\r\n\r\nx,y', 't.csv');
    expect([t.headerRow, t.rows.map((r) => r.row), t.problems.map((p) => p.row)]).toEqual([2, [4], [2]]);
    expect(readCsv('id\r\nx', 't.csv').headerRow).toBe(1);
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

  it('finding 4 (fixed in M23): restored links follow the editor rule; others are left blank and named in a warning', async () => {
    const csv = 'id,name,category,unit,on_hand,desired,v1_supplier,v1_pack_size,v1_url,v2_supplier,v2_pack_size,v2_url\r\n' +
      'a1,A,Motors,each,1,1,REV,1,javascript:alert(1),WCP,1,www.wcproducts.com/x\r\n' +
      'a2,B,Motors,each,1,1,REV,1,https://www.revrobotics.com/y,,,';
    const read = await readRestoreFile({ name: 'x.csv', bytes: new TextEncoder().encode(csv) }, { items: [], suppliers, locations: [], categories: [] });
    if (!read.ok) throw new Error(JSON.stringify(read.problems));
    const urls = read.plan.items.map((i) => i.vendors.map((v) => v?.url ?? null));
    expect(urls).toEqual([['', 'https://www.wcproducts.com/x', null], ['https://www.revrobotics.com/y', null, null]]);
    expect(read.plan.warnings).toContain("Links that aren't web addresses were left blank: a1 option 1 (javascript:alert(1))");

    const z = new JSZip();
    z.file('inventory.csv', 'id,name,category,unit,on_hand,desired,v1_supplier,v1_pack_size\r\na1,A,Motors,each,1,1,REV,1\r\n');
    z.file('suppliers.csv', 'name,website,notes\r\nREV,revrobotics.com,\r\nWCP,mailto:x@y.z,\r\nother,,\r\n');
    const zr = await readRestoreFile({ name: 'x.zip', bytes: await z.generateAsync({ type: 'uint8array' }) }, { items: [], suppliers, locations: [], categories: [] });
    if (!zr.ok) throw new Error(JSON.stringify(zr.problems));
    expect(zr.plan.suppliers.map((x) => [x.name, x.website])).toEqual(expect.arrayContaining([['REV', 'https://revrobotics.com'], ['WCP', '']]));
    expect(zr.plan.warnings).toContain("Links that aren't web addresses were left blank: WCP website (mailto:x@y.z)");
  });

  it('finding 3 (fixed in M23): a Windows-1252 CSV inside a ZIP is read as Windows-1252, with a warning naming the file', async () => {
    const head = new TextEncoder().encode('id,name,category,unit,on_hand,desired,v1_supplier,v1_pack_size\r\nw1,Bolt ');
    const bytes = new Uint8Array([...head, 0xd7, ...new TextEncoder().encode(',Fasteners,each,1,1,REV,1\r\n')]);
    const z = new JSZip();
    z.file('inventory.csv', bytes);
    z.file('locations.csv', new Uint8Array([...new TextEncoder().encode('name,notes,order\r\nCaf'), 0xe9, ...new TextEncoder().encode(' shelf,,0\r\n')]));
    const read = await readRestoreFile({ name: 'x.zip', bytes: await z.generateAsync({ type: 'uint8array' }) }, { items: [], suppliers, locations: [], categories: [] });
    if (!read.ok) throw new Error(JSON.stringify(read.problems));
    expect(read.plan.items[0]!.name).toBe('Bolt ×');
    expect(read.plan.locations.map((l) => l.name)).toContain('Café shelf');
    expect(read.plan.warnings.filter((w) => w.includes('UTF-8'))).toEqual([
      'inventory.csv isn’t UTF-8, so it was read as a Windows (Excel “CSV”) file. Check names with symbols like × or ¾.',
      'locations.csv isn’t UTF-8, so it was read as a Windows (Excel “CSV”) file. Check names with symbols like × or ¾.',
    ]);
  });

  it('finding 6 (fixed in M23): a backup or a snooze dated in the future no longer keeps the reminder off', () => {
    const DAY = 86_400_000;
    const HOUR = 3_600_000;
    const now = Date.UTC(2026, 9, 18);
    const clock = { setupDoneAt: now - 400 * DAY, reminderDays: 7 };
    expect(backupDue({ ...clock, lastBackupAt: now + 365 * DAY }, now)).toBe(true);
    expect(backupInFuture(now + 365 * DAY, now)).toBe(true);
    // Up to an hour ahead is clock drift between devices, not a changed clock: a fresh backup.
    expect(backupDue({ ...clock, lastBackupAt: now + 30 * 60_000 }, now)).toBe(false);
    expect(backupInFuture(now + 30 * 60_000, now)).toBe(false);
    expect(backupInFuture(null, now)).toBe(false);
    const due = { ...clock, lastBackupAt: now - 10 * DAY };
    expect(showBackupBanner(due, now, now + 2 * HOUR)).toBe(true); // snoozed "in the future"
    expect(showBackupBanner(due, now, now + 60_000)).toBe(false); // a screen clock a minute behind
    expect(showBackupBanner(due, now, now - SNOOZE_MS + 1)).toBe(false);
    expect(showBackupBanner(due, now, now - SNOOZE_MS)).toBe(true);
  });
});
