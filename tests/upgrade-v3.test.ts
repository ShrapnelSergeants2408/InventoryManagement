// The first 0.1.3 build (deployed 2026-11-03, merged before the area-code change) stored schema v3
// with one-letter area `letter`s. Schema v4 turns them into codes from the names and renames the
// bins to match (SPEC v3.0 §3, decision log 2026-11-03: area codes).
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';
import { InventoryDb, checkSchema } from '../src/data/db';
import { loadSnapshot } from '../src/data/inventory';
import { checkData } from '../src/domain/integrity';
import { lettersToCodes } from '../src/domain/parts';

/** A database exactly as the first 0.1.3 build declared and filled it (versions 1–3, letters). */
async function makeV3Letters(name: string): Promise<void> {
  const old = new Dexie(name);
  old.version(1).stores({ items: 'id, category, location, barcode', photos: 'itemId', locations: 'key, order', categories: 'name, order', settings: 'key' });
  old.version(2).stores({ items: 'id, category, binId, spotId, seasonId, barcode', areas: 'id, order', spots: 'id, areaId', bins: 'id, code, spotId, seasonId', seasons: 'id, order', tags: 'key, order', pictures: 'id, ownerId', photos: null, locations: null });
  old.version(3).stores({ items: 'id, part, category, binId, spotId, seasonId, barcode', areas: 'id, part, order', bins: 'id, part, code, spotId, seasonId', categoryList: '[part+name], part', tagList: '[part+key], part', categories: null, tags: null });
  await old.open();
  await old.table('areas').bulkAdd([
    { id: 'ar-STORE001', part: 'holiday', name: 'Storage room', letter: 'S', order: 0, notes: '' },
    { id: 'ar-GARAGE01', part: 'household', name: 'Garage', letter: 'G', order: 0, notes: '' },
    { id: 'ar-STORE002', part: 'household', name: 'Storage closet', letter: 'T', order: 1, notes: 'hall' },
  ]);
  await old.table('spots').bulkAdd([
    { id: 'sp-RACK0001', areaId: 'ar-STORE001', name: 'Rack 1', order: 0, notes: '' },
    { id: 'sp-PEG00001', areaId: 'ar-GARAGE01', name: 'Pegboard', order: 0, notes: '' },
  ]);
  const bin = { seasonId: '', tags: [], state: 'stored', notes: '' };
  await old.table('bins').bulkAdd([
    { ...bin, id: 'bn-S0100001', part: 'holiday', code: 'S-01', name: 'Christmas lights', spotId: 'sp-RACK0001', labelPrintedAt: 5, labelContents: 'Lights ×3' },
    { ...bin, id: 'bn-G0300001', part: 'household', code: 'G-03', name: 'Cords', spotId: 'sp-PEG00001', labelPrintedAt: null, labelContents: null },
    { ...bin, id: 'bn-ODD00001', part: 'household', code: 'Q-09', name: 'Odd code', spotId: '', labelPrintedAt: 6, labelContents: '' },
  ]);
  await old.table('categoryList').add({ part: 'household', name: 'Other', order: 0, subcategories: [] });
  await old.table('settings').bulkAdd([
    { key: 'schemaVersion', value: 3 },
    { key: 'setupDoneAt', value: 1 },
  ]);
  old.close();
}

describe('upgrade from the first 0.1.3 build (schema v3 letters → v4 codes)', () => {
  it('areas get codes from their names; their bins are renamed and count as not printed', async () => {
    const name = `v3-${Math.random()}`;
    await makeV3Letters(name);
    const db = new InventoryDb(name);
    await db.open();
    expect(await checkSchema(db)).toBe('ok');
    const s = await loadSnapshot(db);
    // Household first, in walk order: GARAGE, STORAGE; then Holiday's Storage room gets the next.
    expect(s.areas.map((a) => [a.name, a.code, 'letter' in a])).toEqual([
      ['Garage', 'GARAGE', false],
      ['Storage closet', 'STORAGE', false],
      ['Storage room', 'STORAGER', false],
    ]);
    expect(s.bins.map((b) => [b.id, b.code, b.labelPrintedAt])).toEqual(
      expect.arrayContaining([
        ['bn-S0100001', 'STORAGER-01', null],
        ['bn-G0300001', 'GARAGE-03', null],
        // A code no area letter makes stays, with its label.
        ['bn-ODD00001', 'Q-09', 6],
      ]),
    );
    expect(checkData({ ...s, photos: [] })).toEqual([]);
    db.close();
  });

  it('a phone that already has codes is left alone', async () => {
    const out = lettersToCodes([], [{ code: 'ATTIC-04', labelPrintedAt: 1, labelContents: 'x' }]);
    expect(out.bins[0]).toEqual({ code: 'ATTIC-04', labelPrintedAt: 1, labelContents: 'x' });
    // Opening twice runs the step once: the second open finds codes and changes nothing.
    const name = `v3-${Math.random()}`;
    await makeV3Letters(name);
    const db = new InventoryDb(name);
    await db.open();
    const first = await loadSnapshot(db);
    db.close();
    const again = new InventoryDb(name);
    await again.open();
    expect(await loadSnapshot(again)).toEqual(first);
    again.close();
  });
});

describe('a backup from the first 0.1.3 build (areas.csv with letter)', () => {
  it('restores with codes from the names and renamed bins, as its phones upgrade', async () => {
    const { default: JSZip } = await import('jszip');
    const { readRestoreFile } = await import('../src/io/restore');
    const z = new JSZip();
    z.file('areas.csv', 'id,part,name,letter,order,notes\r\nar-GARAGE01,household,Garage,G,0,\r\n');
    z.file('spots.csv', 'id,area_id,name,order,notes\r\nsp-PEG00001,ar-GARAGE01,Pegboard,0,\r\n');
    z.file('bins.csv', 'id,part,code,name,spot_id,season_id,tags,state,notes,label_printed_at,label_contents\r\nbn-G0300001,household,G-03,Cords,sp-PEG00001,,,stored,,2026-11-03T18:00:00.000Z,Drill ×1\r\n');
    z.file('items.csv', 'id,part,name,category,quantity\r\nit-DRILL001,household,Drill,Other,1\r\n');
    z.file('categories.csv', 'part,category,subcategory,order\r\nhousehold,Other,,0\r\n');
    const read = await readRestoreFile({ name: 'b.zip', bytes: await z.generateAsync({ type: 'uint8array' }) }, { categories: [], tags: [] });
    if (!read.ok) throw new Error(JSON.stringify(read.problems));
    expect(read.plan.format).toBe('v3');
    expect(read.plan.data.areas.map((a) => a.code)).toEqual(['GARAGE']);
    expect(read.plan.data.bins.map((b) => [b.code, b.labelPrintedAt])).toEqual([['GARAGE-03', null]]);
    expect(read.plan.warnings.some((w) => w.includes('first 0.1.3 build'))).toBe(true);
  });
});
