import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { InventoryDb } from '../src/data/db';
import { DB_NAME, InventoryDb as Db, SCHEMA_KEY, SCHEMA_VERSION, checkSchema } from '../src/data/db';
import { adjustQuantity, getItem, loadSnapshot, replaceAll, setQuantity } from '../src/data/inventory';
import { DEFAULT_SETTINGS, getSettings, setSettings } from '../src/data/settings';
import { item } from './helpers';

const lists = {
  locations: [{ name: 'Bin 1', notes: '', order: 0 }],
  categories: [{ name: 'Decorations', order: 0, subcategories: [] }],
};

let db: InventoryDb;
const fresh = () => (db = new InventoryDb(`t-${Math.random()}`));
afterEach(() => db?.close());

describe('replaceAll', () => {
  it('stores items with their photo flags and save time', async () => {
    fresh();
    const photo = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' });
    await replaceAll(db, { ...lists, items: [item({ id: 'a' }), item({ id: 'b' })], photos: new Map([['a', photo]]) }, 77);
    const row = await db.items.get('a');
    expect(row!.hasPhoto).toBe(true);
    expect(row!.updatedAt).toBe(77);
    expect((await db.items.get('b'))!.hasPhoto).toBe(false);
  });

  it('is all-or-nothing: an invalid item leaves the existing data untouched', async () => {
    fresh();
    await replaceAll(db, { ...lists, items: [item({ id: 'keep' })], photos: new Map() });
    const bad = { ...lists, items: [item({ id: 'new1' }), item({ id: 'new2', quantity: -1 })], photos: new Map() };
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

describe('setQuantity (the stepper’s typed value)', () => {
  it('changes the quantity only', async () => {
    fresh();
    await replaceAll(db, { ...lists, items: [item({ id: 'a', notes: 'n' })], photos: new Map() });
    await setQuantity(db, 'a', 5);
    expect(await getItem(db, 'a')).toEqual(item({ id: 'a', notes: 'n', quantity: 5 }));
  });
  it('rejects negative or fractional values and unknown ids', async () => {
    fresh();
    await replaceAll(db, { ...lists, items: [item({ id: 'a' })], photos: new Map() });
    await expect(setQuantity(db, 'a', -1)).rejects.toThrow(RangeError);
    await expect(setQuantity(db, 'a', 1.5)).rejects.toThrow(RangeError);
    await expect(setQuantity(db, 'zzz', 1)).rejects.toThrow(/no item/);
  });
});

describe('adjustQuantity (stepper ±)', () => {
  it('steps up and down and never goes below 0', async () => {
    fresh();
    await replaceAll(db, { ...lists, items: [item({ id: 'a', quantity: 1 })], photos: new Map() });
    expect(await adjustQuantity(db, 'a', -1)).toBe(0);
    expect(await adjustQuantity(db, 'a', -1)).toBe(0);
    expect(await adjustQuantity(db, 'a', 1)).toBe(1);
    expect(await getItem(db, 'a')).toMatchObject({ quantity: 1 });
  });
  it('fast repeated taps are never lost', async () => {
    fresh();
    await replaceAll(db, { ...lists, items: [item({ id: 'a', quantity: 0 })], photos: new Map() });
    await Promise.all(Array.from({ length: 10 }, () => adjustQuantity(db, 'a', 1)));
    expect((await getItem(db, 'a'))!.quantity).toBe(10);
  });
  it('records the change time only when the number changes', async () => {
    fresh();
    await replaceAll(db, { ...lists, items: [item({ id: 'a', quantity: 0 })], photos: new Map() }, 100);
    await adjustQuantity(db, 'a', -1, 200);
    expect((await getSettings(db)).lastChangeAt).toBe(100);
    await adjustQuantity(db, 'a', 1, 300);
    expect((await getSettings(db)).lastChangeAt).toBe(300);
  });
  it('rejects fractional steps and unknown ids', async () => {
    fresh();
    await replaceAll(db, { ...lists, items: [item({ id: 'a' })], photos: new Map() });
    await expect(adjustQuantity(db, 'a', 0.5)).rejects.toThrow(RangeError);
    await expect(adjustQuantity(db, 'zzz', 1)).rejects.toThrow(/no item/);
  });
});

describe('settings', () => {
  it('defaults match SPEC v2.0 F18: a monthly backup reminder', async () => {
    fresh();
    const s = await getSettings(db);
    expect(s).toEqual(DEFAULT_SETTINGS);
    expect(s.reminderDays).toBe(30);
  });
});

describe('schema (SPEC v2.0 §2, D1)', () => {
  it('a new database, home-inventory, at schema v1', async () => {
    expect(DB_NAME).toBe('home-inventory');
    expect(SCHEMA_VERSION).toBe(1);
    fresh();
    await db.open();
    expect(await checkSchema(db)).toBe('ok');
    expect((await db.settings.get(SCHEMA_KEY))?.value).toBe(1);
  });

  it('an older copy of the app refuses a newer database without writing to it', async () => {
    fresh();
    await db.open();
    await db.settings.put({ key: SCHEMA_KEY, value: SCHEMA_VERSION + 1 });
    expect(await checkSchema(db)).toBe('outdated');
    expect((await db.settings.get(SCHEMA_KEY))?.value).toBe(SCHEMA_VERSION + 1);
  });

  it('opens under its own name by default', () => {
    const d = new Db();
    expect(d.name).toBe('home-inventory');
    d.close();
  });
});
