import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { InventoryDb } from '../src/data/db';
import { adjustOnHand, getItem, loadSnapshot, replaceAll, setOnHand } from '../src/data/inventory';
import { DEFAULT_SETTINGS, getSettings, setSettings } from '../src/data/settings';
import { item, vendor } from './helpers';

const lists = {
  suppliers: [
    { name: 'REV', website: '', notes: '' },
    { name: 'other', website: '', notes: '' },
  ],
  locations: [{ name: 'Bin 1', notes: '', order: 0 }],
  categories: [{ name: 'Motors', order: 0, subcategories: [] }],
};

let db: InventoryDb;
const fresh = () => (db = new InventoryDb(`t-${Math.random()}`));
afterEach(() => db?.close());

describe('replaceAll', () => {
  it('stores items with derived supplier keys and photo flags', async () => {
    fresh();
    const photo = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' });
    await replaceAll(db, { ...lists, items: [item({ id: 'a', vendors: [vendor({ supplier: 'REV' }), vendor({ supplier: 'other' }), null] }), item({ id: 'b' })], photos: new Map([['a', photo]]) });
    const row = await db.items.get('a');
    expect(row!.supplierKeys).toEqual(['rev', 'other']);
    expect(row!.hasPhoto).toBe(true);
    expect((await db.items.get('b'))!.hasPhoto).toBe(false);
    expect(await db.items.where('supplierKeys').equals('rev').count()).toBe(2);
  });

  it('is all-or-nothing: an invalid item leaves the existing data untouched', async () => {
    fresh();
    await replaceAll(db, { ...lists, items: [item({ id: 'keep' })], photos: new Map() });
    const bad = { ...lists, items: [item({ id: 'new1' }), item({ id: 'new2', vendors: [vendor({ supplier: 'Unknown' }), null, null] })], photos: new Map() };
    await expect(replaceAll(db, bad)).rejects.toThrow(/new2/);
    const snap = await loadSnapshot(db);
    expect(snap.items.map((i) => i.id)).toEqual(['keep']);
  });

  it('rolls back if the database write itself fails part-way', async () => {
    fresh();
    await replaceAll(db, { ...lists, items: [item({ id: 'keep' })], photos: new Map() });
    // Two locations with the same key make bulkAdd fail after items were already written in the transaction.
    const dupLocations = [{ name: 'X', notes: '', order: 0 }, { name: 'x', notes: '', order: 1 }];
    await expect(replaceAll(db, { ...lists, locations: dupLocations, items: [item({ id: 'other-item' })], photos: new Map() })).rejects.toThrow();
    expect((await loadSnapshot(db)).items.map((i) => i.id)).toEqual(['keep']);
  });

  it('does not touch settings other than lastChangeAt', async () => {
    fresh();
    await setSettings(db, { reminderDays: 3 });
    await replaceAll(db, { ...lists, items: [], photos: new Map() }, 1234);
    const s = await getSettings(db);
    expect(s.reminderDays).toBe(3);
    expect(s.lastChangeAt).toBe(1234);
  });
});

describe('setOnHand (F3 quick adjust)', () => {
  it('changes on hand only and never sets last_counted (Q7)', async () => {
    fresh();
    await replaceAll(db, { ...lists, items: [item({ id: 'a', lastCounted: '' })], photos: new Map() });
    await setOnHand(db, 'a', 5);
    expect(await getItem(db, 'a')).toMatchObject({ onHand: 5, lastCounted: '' });
  });
  it('rejects negative or fractional values and unknown ids', async () => {
    fresh();
    await replaceAll(db, { ...lists, items: [item({ id: 'a' })], photos: new Map() });
    await expect(setOnHand(db, 'a', -1)).rejects.toThrow(RangeError);
    await expect(setOnHand(db, 'a', 1.5)).rejects.toThrow(RangeError);
    await expect(setOnHand(db, 'zzz', 1)).rejects.toThrow(/no item/);
  });
});

describe('adjustOnHand (F3 quick adjust ±)', () => {
  it('steps up and down and never goes below 0', async () => {
    fresh();
    await replaceAll(db, { ...lists, items: [item({ id: 'a', onHand: 1 })], photos: new Map() });
    expect(await adjustOnHand(db, 'a', -1)).toBe(0);
    expect(await adjustOnHand(db, 'a', -1)).toBe(0);
    expect(await adjustOnHand(db, 'a', 1)).toBe(1);
    expect(await getItem(db, 'a')).toMatchObject({ onHand: 1, lastCounted: '' });
  });
  it('fast repeated taps are never lost', async () => {
    fresh();
    await replaceAll(db, { ...lists, items: [item({ id: 'a', onHand: 0 })], photos: new Map() });
    await Promise.all(Array.from({ length: 10 }, () => adjustOnHand(db, 'a', 1)));
    expect((await getItem(db, 'a'))!.onHand).toBe(10);
  });
  it('records the change time only when the number changes', async () => {
    fresh();
    await replaceAll(db, { ...lists, items: [item({ id: 'a', onHand: 0 })], photos: new Map() }, 100);
    await adjustOnHand(db, 'a', -1, 200);
    expect((await getSettings(db)).lastChangeAt).toBe(100);
    await adjustOnHand(db, 'a', 1, 300);
    expect((await getSettings(db)).lastChangeAt).toBe(300);
  });
  it('rejects fractional steps and unknown ids', async () => {
    fresh();
    await replaceAll(db, { ...lists, items: [item({ id: 'a' })], photos: new Map() });
    await expect(adjustOnHand(db, 'a', 0.5)).rejects.toThrow(RangeError);
    await expect(adjustOnHand(db, 'zzz', 1)).rejects.toThrow(/no item/);
  });
});

describe('settings', () => {
  it('defaults match SPEC §6 / F14 / F16', async () => {
    fresh();
    const s = await getSettings(db);
    expect(s).toEqual(DEFAULT_SETTINGS);
    expect([s.reminderDays, s.staleDays, s.unlockMinutes]).toEqual([7, 90, 5]);
  });
});
