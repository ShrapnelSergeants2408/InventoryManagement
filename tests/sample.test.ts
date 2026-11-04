import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { InventoryDb } from '../src/data/db';
import { loadSnapshot, replaceAll } from '../src/data/inventory';
import { sampleStart } from '../src/data/sample';
import { isSetUp, startInventory } from '../src/data/setup';
import { checkData } from '../src/domain/integrity';
import { isLooseSpot } from '../src/domain/places';

const dbs: InventoryDb[] = [];
afterEach(() => {
  for (const d of dbs.splice(0)) d.close();
});
const newDb = () => {
  const d = new InventoryDb(`sample-${Math.random()}`);
  dbs.push(d);
  return d;
};

describe('sample data for testing (Dan, 2026-11-04)', () => {
  it('passes the same checks as a restored backup, in both parts', () => {
    const d = sampleStart();
    expect(checkData(d)).toEqual([]);
    for (const part of ['household', 'holiday'] as const) {
      expect(d.items.filter((i) => i.part === part).length).toBeGreaterThan(20);
      expect(d.bins.filter((b) => b.part === part).length).toBeGreaterThan(3);
    }
    expect(new Set(d.bins.map((b) => b.code)).size).toBe(d.bins.length);
    expect(d.spots.some(isLooseSpot)).toBe(true);
    expect(d.displays.length).toBeGreaterThan(0);
    expect(d.items.some((i) => i.status === 'out' && i.outDisplayId)).toBe(true);
    expect(d.items.some((i) => i.status === 'lent' && i.lentTo)).toBe(true);
  });

  it('starts a new phone, and replaces a phone already set up', async () => {
    const db = newDb();
    await startInventory(db, sampleStart(), 1000);
    expect(await isSetUp(db)).toBe(true);
    const first = await loadSnapshot(db);
    await replaceAll(db, sampleStart(), 2000);
    const again = await loadSnapshot(db);
    expect(again.items.length).toBe(first.items.length);
    expect(again.items.map((i) => i.id)).not.toEqual(first.items.map((i) => i.id));
  });
});
