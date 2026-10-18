import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { InventoryDb } from '../src/data/db';
import { replaceAll } from '../src/data/inventory';
import { setBarcode } from '../src/data/items';
import { getNudge, setNudge } from '../src/data/labels';
import { loadLabelChoice, saveLabelChoice, type KeyValueStore } from '../src/data/prefs';
import { getSettings } from '../src/data/settings';
import { item } from './helpers';

let db: InventoryDb;
afterEach(() => db?.close());

async function setup() {
  db = new InventoryDb(`l-${Math.random()}`);
  await replaceAll(
    db,
    {
      suppliers: [
        { name: 'REV', website: '', notes: '' },
        { name: 'other', website: '', notes: '' },
      ],
      locations: [],
      categories: [{ name: 'Motors', order: 0, subcategories: [] }],
      items: [item({ id: 'a', name: 'Alpha' }), item({ id: 'b', name: 'Bravo', barcode: '722787604386' })],
      photos: new Map(),
    },
    1,
  );
}

describe('label nudge storage (§9: saved per layout)', () => {
  it('defaults to 0, is kept per layout, and is not an inventory change', async () => {
    await setup();
    expect(await getNudge(db, 'avery-5160')).toEqual({ top: 0, left: 0 });
    await setNudge(db, 'avery-5160', { top: 1.5, left: -0.5 });
    await setNudge(db, 'avery-5163', { top: -2, left: 0 });
    expect(await getNudge(db, 'avery-5160')).toEqual({ top: 1.5, left: -0.5 });
    expect(await getNudge(db, 'avery-5163')).toEqual({ top: -2, left: 0 });
    expect(await getNudge(db, 'plain')).toEqual({ top: 0, left: 0 });
    expect((await getSettings(db)).lastChangeAt).toBe(1);
  });

  it('cleans what it stores and what it reads', async () => {
    await setup();
    expect(await setNudge(db, 'avery-5160', { top: 12, left: 0.3 })).toEqual({ top: 10, left: 0.5 });
    await db.settings.put({ key: 'labelNudge.avery-22805', value: 'junk' });
    expect(await getNudge(db, 'avery-22805')).toEqual({ top: 0, left: 0 });
  });
});

describe('setBarcode (F21 attach; no PIN)', () => {
  it('attaches a cleaned code and records the change', async () => {
    await setup();
    const it2 = await setBarcode(db, 'a', ' 0 12345 67890 5 ', 9);
    expect(it2.barcode).toBe('012345678905');
    expect((await db.items.get('a'))!.barcode).toBe('012345678905');
    expect((await getSettings(db)).lastChangeAt).toBe(9);
  });

  it('refuses a code already on another item, including the EAN-13 form of its UPC-A', async () => {
    await setup();
    await expect(setBarcode(db, 'a', '722787604386', 9)).rejects.toThrow(/already on “Bravo”/);
    await expect(setBarcode(db, 'a', '0722787604386', 9)).rejects.toThrow(/already on “Bravo”/);
    expect((await db.items.get('a'))!.barcode).toBe('');
    expect((await getSettings(db)).lastChangeAt).toBe(1);
  });

  it('may replace an item’s own barcode', async () => {
    await setup();
    expect((await setBarcode(db, 'b', '0722787604386', 9)).barcode).toBe('0722787604386');
    expect((await setBarcode(db, 'b', '5012345678900', 10)).barcode).toBe('5012345678900');
  });

  it('refuses empty codes, team labels and unknown items', async () => {
    await setup();
    await expect(setBarcode(db, 'a', '  ', 9)).rejects.toThrow(/empty/);
    await expect(setBarcode(db, 'a', '2408:st-0001', 9)).rejects.toThrow(/team QR label/);
    await expect(setBarcode(db, 'zz', '123', 9)).rejects.toThrow(/no item/);
  });
});

describe('last label layout (localStorage)', () => {
  it('round-trips, and survives junk', () => {
    const m = new Map<string, string>();
    const store: KeyValueStore = { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
    expect(loadLabelChoice(store)).toEqual({ layoutId: null, plainQr: null });
    saveLabelChoice({ layoutId: 'plain', plainQr: 1.5 }, store);
    expect(loadLabelChoice(store)).toEqual({ layoutId: 'plain', plainQr: 1.5 });
    m.set('frc2408.labels.layout', '{bad');
    expect(loadLabelChoice(store)).toEqual({ layoutId: null, plainQr: null });
  });
});
