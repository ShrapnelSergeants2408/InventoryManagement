import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { buildBackup } from '../src/data/backup';
import { InventoryDb } from '../src/data/db';
import { loadSnapshot, replaceAll, setOnHand } from '../src/data/inventory';
import { applyPriceImport } from '../src/data/price-import';
import { getSettings } from '../src/data/settings';
import { planPriceImport, type PricePlan } from '../src/io/price-import';
import { item, vendor } from './helpers';

const dbs: InventoryDb[] = [];
afterEach(() => {
  for (const d of dbs.splice(0)) d.close();
});

const suppliers = [
  { name: 'REV', website: '', notes: '' },
  { name: 'WCP', website: '', notes: '' },
  { name: 'other', website: '', notes: '' },
];
const items = () => [
  item({
    id: 'st-0001',
    onHand: 3,
    desired: 4,
    spares: 1,
    lastCounted: '2026-10-20',
    preferredVendor: 1,
    vendors: [vendor({ supplier: 'REV', partNo: 'REV-1', packSize: 1, packPriceCents: 1000, priceChecked: '2026-01-01' }), vendor({ supplier: 'WCP', partNo: 'W-1', packSize: 10, packPriceCents: 500 }), null],
  }),
  item({ id: 'st-0002', vendors: [vendor({ supplier: 'WCP', packPriceCents: null, priceChecked: '' }), null, null] }),
  item({ id: 'tm-7K3QX', vendors: [vendor({ supplier: 'other' }), null, null] }),
];

async function setup() {
  const db = new InventoryDb(`pi-${Math.random()}`);
  dbs.push(db);
  await replaceAll(db, { items: items(), photos: new Map(), suppliers, locations: [], categories: [{ name: 'Motors', order: 0, subcategories: [] }] }, 5);
  return db;
}

function plan(text: string, current = { items: items(), suppliers }): PricePlan {
  const r = planPriceImport(text, 'prices.csv', current);
  if (!r.ok) throw new Error(JSON.stringify(r.problems));
  return r.plan;
}
function problems(text: string) {
  const r = planPriceImport(text, 'prices.csv', { items: items(), suppliers });
  if (r.ok) throw new Error('expected problems');
  return r.problems;
}
const csv = (...lines: string[]) => lines.join('\r\n');

describe('price-update import: what the file may contain (F18, Q4)', () => {
  it('updates price, pack size, link and date for matching ids', () => {
    const p = plan(csv('id,v1_pack_price,v1_price_checked,v1_pack_size,v1_url', 'st-0001,$12.99,11/02/2026,2,www.revrobotics.com/x'));
    expect(p.items).toEqual([
      { row: 2, id: 'st-0001', updates: [{ slot: 1, adds: false, set: { packPriceCents: 1299, priceChecked: '2026-11-02', packSize: 2, url: 'https://www.revrobotics.com/x' } }] },
    ]);
    expect(p).toMatchObject({ optionsChanged: 1, optionsAdded: 0, optionsUnchanged: 0, notFound: [], newSuppliers: [], rowCount: 1 });
  });

  it('a blank cell leaves the field as it is', () => {
    const p = plan(csv('id,v1_pack_price,v1_price_checked,v2_pack_price', 'st-0001,,2026-11-02,'));
    expect(p.items[0]!.updates).toEqual([{ slot: 1, adds: false, set: { priceChecked: '2026-11-02' } }]);
  });

  it('a data-only backup works as the input: inventory columns are ignored and listed', async () => {
    const db = await setup();
    const text = await (await buildBackup(db, 'data', new Date())).text();
    const edited = text.replace('2026-01-01', '2026-11-02');
    const p = plan(edited);
    expect(p.ignoredColumns).toEqual(expect.arrayContaining(['name', 'on_hand', 'desired', 'spares', 'last_counted', 'preferred_vendor', 'notes']));
    expect(p.optionsChanged).toBe(1);
    expect(p.optionsUnchanged).toBe(3);
    expect(p.items).toEqual([{ row: 2, id: 'st-0001', updates: [{ slot: 1, adds: false, set: expect.objectContaining({ priceChecked: '2026-11-02' }) }] }]);
  });

  it('ids not on the tablet are listed and skipped, not errors', () => {
    const p = plan(csv('id,v1_pack_price', 'st-0200,1', 'st-0001,11', 'st-0201,2'));
    expect(p.notFound).toEqual(['st-0200', 'st-0201']);
    expect(p.items.map((i) => i.id)).toEqual(['st-0001']);
  });

  it('ids match ignoring capitals', () => {
    expect(plan(csv('id,v1_pack_price', 'TM-7k3qx,3.50')).items[0]!.id).toBe('tm-7K3QX');
  });

  it('unknown supplier names are added once, as spelled first; known ones keep the list spelling', () => {
    const p = plan(csv('id,v1_supplier,v2_supplier', 'st-0001,rev,FIRST Storefront', 'st-0002,first storefront,'));
    expect(p.newSuppliers).toEqual(['FIRST Storefront']);
    // "rev" is REV already, so that option doesn't change.
    expect(p.items[0]!.updates).toEqual([{ slot: 2, adds: false, set: { supplier: 'FIRST Storefront' } }]);
    expect(p.items[1]!.updates).toEqual([{ slot: 1, adds: false, set: { supplier: 'FIRST Storefront' } }]);
    expect(p.optionsUnchanged).toBe(1);
    const q = plan(csv('id,v1_supplier', 'st-0002,rev'));
    expect(q.items[0]!.updates).toEqual([{ slot: 1, adds: false, set: { supplier: 'REV' } }]);
  });

  it('a supplier named only on a not-found row is not added', () => {
    expect(plan(csv('id,v1_supplier', 'st-9999,Brand New')).newSuppliers).toEqual([]);
  });

  it('a row can fill an empty slot when it has supplier and pack size', () => {
    const p = plan(csv('id,v3_supplier,v3_pack_size,v3_pack_price,v3_part_no', 'st-0001,WCP,4,9.99,WCP-9'));
    expect(p.items[0]!.updates).toEqual([{ slot: 3, adds: true, set: { supplier: 'WCP', packSize: 4, packPriceCents: 999, partNo: 'WCP-9' } }]);
    expect(p.optionsAdded).toBe(1);
  });

  it('values that already match count as unchanged', () => {
    const p = plan(csv('id,v1_pack_price,v1_supplier', 'st-0001,10.00,REV'));
    expect(p.items).toEqual([]);
    expect(p.optionsUnchanged).toBe(1);
  });
});

describe('price-update import: the whole file is checked first (F18)', () => {
  it('lists every bad row by number with its id', () => {
    const ps = problems(csv('id,v1_pack_size,v1_pack_price,v1_price_checked,v1_url', 'st-0001,2.5,,,', 'st-0002,1,12.999,,', 'tm-7K3QX,1,,13/45/2026,', 'st-0001,1,,,', ',1,,,', 'st-0002,1,,,javascript:alert(1)'));
    expect(ps.map((p) => [p.row, p.id])).toEqual([
      [2, 'st-0001'],
      [3, 'st-0002'],
      [4, 'tm-7K3QX'],
      [5, 'st-0001'],
      [6, undefined],
      [7, 'st-0002'],
    ]);
    expect(ps[0]!.message).toBe('v1_pack_size "2.5" must be a whole number ≥ 1');
    expect(ps[1]!.message).toMatch(/more than 2 decimal places/);
    expect(ps[3]!.message).toMatch(/used again \(first on row 2\)/);
  });

  it('rejects unknown columns, a v4_ column and a missing id column', () => {
    expect(problems(csv('id,v4_pack_price', 'st-0001,1'))[0]!.message).toMatch(/at most 3 vendor options/);
    expect(problems(csv('id,price', 'st-0001,1'))[0]!.message).toMatch(/“price” isn’t recognized/);
    expect(problems(csv('item,v1_pack_price', 'st-0001,1')).map((p) => p.message)).toEqual([expect.stringMatching(/“item” isn’t recognized/), 'missing column: id']);
    expect(problems(csv('id,name', 'st-0001,x'))[0]!.message).toMatch(/no vendor columns/);
  });

  it('a new slot without supplier or pack size is an error', () => {
    expect(problems(csv('id,v2_pack_price', 'st-0002,5'))[0]!.message).toMatch(/vendor option 2 is empty.*v2_supplier and v2_pack_size/);
  });

  it('negative pack sizes and prices are rejected', () => {
    expect(problems(csv('id,v1_pack_size', 'st-0001,0'))[0]!.message).toMatch(/≥ 1/);
    expect(problems(csv('id,v1_pack_price', 'st-0001,-3'))[0]!.message).toMatch(/dollar amount/);
  });
});

describe('applying a price import (F18)', () => {
  it('changes only vendor fields; counts, desired, spares, last counted and preferred vendor stay', async () => {
    const db = await setup();
    const p = plan(csv('id,v1_pack_price,v1_price_checked,v2_supplier,preferred_vendor,on_hand', 'st-0001,12.99,2026-11-02,New Co,2,99'));
    await applyPriceImport(db, p, 50);
    const it = (await loadSnapshot(db)).items.find((i) => i.id === 'st-0001')!;
    expect(it).toMatchObject({ onHand: 3, desired: 4, spares: 1, lastCounted: '2026-10-20', preferredVendor: 1 });
    expect(it.vendors[0]).toMatchObject({ packPriceCents: 1299, priceChecked: '2026-11-02', supplier: 'REV', partNo: 'REV-1' });
    expect(it.vendors[1]).toMatchObject({ supplier: 'New Co', partNo: 'W-1', packSize: 10 });
    const snap = await loadSnapshot(db);
    expect(snap.suppliers.map((s) => s.name)).toContain('New Co');
    expect((await getSettings(db)).lastChangeAt).toBe(50);
  });

  it('counts recorded after the file was checked are not overwritten (§10)', async () => {
    const db = await setup();
    const p = plan(csv('id,v1_pack_price', 'st-0001,20'));
    await setOnHand(db, 'st-0001', 17);
    await applyPriceImport(db, p);
    const it = (await loadSnapshot(db)).items.find((i) => i.id === 'st-0001')!;
    expect(it.onHand).toBe(17);
    expect(it.vendors[0]!.packPriceCents).toBe(2000);
  });

  it('if an item was deleted in between, nothing is saved', async () => {
    const db = await setup();
    const p = plan(csv('id,v1_pack_price,v1_supplier', 'st-0001,20,', 'st-0002,30,Brand New'));
    await db.items.delete('st-0002');
    const before = await loadSnapshot(db);
    await expect(applyPriceImport(db, p)).rejects.toThrow(/st-0002 was removed/);
    expect(await loadSnapshot(db)).toEqual(before);
  });

  it('a file with one bad row changes nothing (planning stops before saving)', async () => {
    const db = await setup();
    const before = await loadSnapshot(db);
    const r = planPriceImport(csv('id,v1_pack_price', 'st-0001,20', 'st-0002,abc'), 'p.csv', before);
    expect(r.ok).toBe(false);
    expect(await loadSnapshot(db)).toEqual(before);
  });
});
