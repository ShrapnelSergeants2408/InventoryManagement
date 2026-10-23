// The real Tab S8 backup through the upgrade (stage6-plan §3 step 2). The file holds team data,
// so it isn't in the repo: set TABLET_BACKUP to its path. Without it, this file is skipped.
//   TABLET_BACKUP="D:\backups\inventory-backup-2026-10-23-1200.zip" npx vitest run tests/tablet-backup.test.ts
import 'fake-indexeddb/auto';
import { existsSync, readFileSync } from 'node:fs';
import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { applyRestore, buildBackup } from '../src/data/backup';
import { InventoryDb, checkSchema, toItemRow, toLocationRow, toSupplierRow } from '../src/data/db';
import { loadSnapshot } from '../src/data/inventory';
import { loadOrderLists } from '../src/data/order-lists';
import { buildOrderList } from '../src/domain/order';
import { readRestoreFile } from '../src/io/restore';

const PATH = process.env.TABLET_BACKUP ?? '';
const run = PATH !== '' && existsSync(PATH);

const opened: Dexie[] = [];
afterEach(() => {
  for (const d of opened.splice(0)) d.close();
});

describe.runIf(run)('the Tab S8 backup through the v1 → v2 upgrade', () => {
  it('upgrades with the same items, photos and order total, and round-trips after', async () => {
    const bytes = new Uint8Array(readFileSync(PATH));
    const empty = { items: [], suppliers: [], locations: [], categories: [] };
    const read = await readRestoreFile({ name: PATH.split(/[\\/]/).pop()!, bytes }, empty);
    if (!read.ok) throw new Error(JSON.stringify(read.problems));
    const plan = read.plan;
    const total = buildOrderList(plan.items).grandTotalCents;

    // Written the way a v1 tablet holds it.
    const name = `tab-${Math.random()}`;
    const v1 = new Dexie(name);
    v1.version(1).stores({ items: 'id, category, location, barcode, *supplierKeys, lastCounted', photos: 'itemId', suppliers: 'key, name', locations: 'key, order', categories: 'name, order', settings: 'key' });
    await v1.transaction('rw', v1.tables, async () => {
      await v1.table('items').bulkAdd(plan.items.map((i) => toItemRow({ ...i, hasPhoto: plan.photos.has(i.id) }, 1)));
      await v1.table('photos').bulkAdd([...plan.photos].map(([itemId, full]) => ({ itemId, full, thumb: null, updatedAt: 1 })));
      await v1.table('suppliers').bulkAdd(plan.suppliers.map(toSupplierRow));
      await v1.table('locations').bulkAdd(plan.locations.map(toLocationRow));
      await v1.table('categories').bulkAdd(plan.categories);
    });
    v1.close();

    const db = new InventoryDb(name);
    opened.push(db);
    await db.open();
    expect(await checkSchema(db)).toBe('ok');
    const snap = await loadSnapshot(db);
    expect(snap.items).toHaveLength(plan.items.length);
    expect(await db.photos.count()).toBe(plan.photos.size);
    expect(snap.categories).toEqual(plan.categories);
    expect(buildOrderList(snap.items).grandTotalCents).toBe(total);
    expect(await loadOrderLists(db)).toEqual([]);
    console.log(`Tablet backup: ${plan.items.length} items, ${plan.photos.size} photos, order total ${(total / 100).toFixed(2)}`);

    // export → restore after the upgrade.
    const zip = await buildBackup(db, 'full', new Date());
    const dst = new InventoryDb(`${name}-rt`);
    opened.push(dst);
    const back = await readRestoreFile({ name: 'rt.zip', bytes: new Uint8Array(await zip.arrayBuffer()) }, await loadSnapshot(dst));
    if (!back.ok) throw new Error(JSON.stringify(back.problems));
    await applyRestore(dst, back.plan);
    expect((await loadSnapshot(dst)).items).toEqual(snap.items);
    expect(await dst.photos.count()).toBe(plan.photos.size);
  });
});
