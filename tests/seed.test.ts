import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { InventoryDb } from '../src/data/db';
import { loadSnapshot, replaceAll } from '../src/data/inventory';
import { buildOrderList } from '../src/domain/order';
import { centsToPlain } from '../src/domain/money';
import { readSeed } from '../src/io/seed';
import { seedBytes } from './helpers';

// SPEC §11 categories in their finalized order.
const SPEC_CATEGORIES = [
  'Structure', 'Fasteners', 'Motion', 'Drivetrain', 'Motors', 'Motor Controllers', 'Power & Electrical',
  'Wiring & Connectors', 'Control System & Sensors', 'Pneumatics', 'Tools & Consumables', 'Pit & Safety',
];

describe('starter catalog (SPEC §12, F22)', async () => {
  const seed = await readSeed(seedBytes());
  if (!seed.ok) throw new Error(JSON.stringify(seed.problems));
  const { data } = seed;

  it('reads without problems or warnings', () => {
    expect(seed.warnings).toEqual([]);
  });

  it('has 129 items, 168 vendor options, 128 photos and 9 suppliers', () => {
    expect(data.items).toHaveLength(129);
    expect(data.items.flatMap((i) => i.vendors.filter(Boolean))).toHaveLength(168);
    expect(data.photos.size).toBe(128);
    expect(data.suppliers).toHaveLength(9);
    expect(data.suppliers.map((s) => s.name)).toContain('other');
  });

  it('every item starts at on hand 0 and spares 0, uncounted, with no location', () => {
    expect(data.items.every((i) => i.onHand === 0 && i.spares === 0)).toBe(true);
    expect(data.items.every((i) => i.lastCounted === '' && i.location === '')).toBe(true);
    expect(data.locations).toEqual([]);
  });

  it('SystemCore (st-0099) is the one item without a photo', () => {
    expect(data.items.filter((i) => !i.hasPhoto).map((i) => i.id)).toEqual(['st-0099']);
    expect(data.photos.get('st-0001')!.type).toBe('image/jpeg');
  });

  it('categories are rebuilt in the §11 order', () => {
    expect(data.categories.map((c) => c.name)).toEqual(SPEC_CATEGORIES);
    expect(data.categories.find((c) => c.name === 'Motion')!.subcategories).toEqual([
      'Shafts & Spacers', 'Bearings', 'Collars', 'Sprockets & Chain', 'Pulleys & Belts',
    ]);
  });

  it('with on hand 0 the order list totals exactly $8,413.66 over 124 priced lines', () => {
    const order = buildOrderList(data.items);
    expect(centsToPlain(order.grandTotalCents)).toBe('8413.66');
    expect(order.lineCount).toBe(124);
    expect(order.pricedLineCount).toBe(124);
    expect(order.noPriceCount).toBe(0);
  });

  it('loads into IndexedDB and reads back the same numbers', async () => {
    const db = new InventoryDb(`seed-${Math.random()}`);
    await replaceAll(db, data);
    const snap = await loadSnapshot(db);
    expect(snap.items).toHaveLength(129);
    expect(await db.photos.count()).toBe(128);
    expect(snap.suppliers).toHaveLength(9);
    expect(snap.categories.map((c) => c.name)).toEqual(SPEC_CATEGORIES);
    expect(centsToPlain(buildOrderList(snap.items).grandTotalCents)).toBe('8413.66');
    const photo = await db.photos.get('st-0063');
    expect((await photo!.full.arrayBuffer()).byteLength).toBe((await data.photos.get('st-0063')!.arrayBuffer()).byteLength);
    db.close();
  });
});
