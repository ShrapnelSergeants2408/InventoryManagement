import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { getCountSince, saveCount, setCountSince } from '../src/data/count';
import { InventoryDb } from '../src/data/db';
import { getItem, loadSnapshot, replaceAll } from '../src/data/inventory';
import { getRecentLocations } from '../src/data/items';
import { DEFAULT_COUNT_OPTIONS, loadCountOptions, loadCountPause, saveCountOptions, saveCountPause, type KeyValueStore } from '../src/data/prefs';
import { countGroups, firstToCount, orderTotalCents, overallProgress } from '../src/domain/count';
import { readSeed } from '../src/io/seed';
import { item, seedBytes } from './helpers';

let db: InventoryDb;
afterEach(() => db?.close());

async function setup() {
  db = new InventoryDb(`c-${Math.random()}`);
  await replaceAll(
    db,
    {
      suppliers: [{ name: 'REV', website: '', notes: '' }],
      locations: [
        { name: 'Bin A', notes: '', order: 0 },
        { name: 'Shelf B', notes: '', order: 1 },
      ],
      categories: [{ name: 'Motors', order: 0, subcategories: [] }],
      items: [
        item({ id: 'a', desired: 2, onHand: 9, location: 'Shelf B' }),
        item({ id: 'b', desired: 2 }),
        item({ id: 'c', desired: 2 }),
        item({ id: 'd', desired: 2 }),
      ],
      photos: new Map(),
    },
    1,
  );
}

describe('saveCount (F24)', () => {
  it('sets on_hand and last_counted together, keeping the location when none was picked', async () => {
    await setup();
    const saved = await saveCount(db, 'a', 3, undefined, '2026-10-24', 50);
    expect(saved).toMatchObject({ onHand: 3, lastCounted: '2026-10-24', location: 'Shelf B' });
    expect(await getItem(db, 'a')).toMatchObject({ onHand: 3, lastCounted: '2026-10-24', location: 'Shelf B' });
    expect((await db.settings.get('lastChangeAt'))?.value).toBe(50);
  });

  it('a counted 0 is a count: last_counted is set', async () => {
    await setup();
    await saveCount(db, 'b', 0, undefined, '2026-10-24');
    expect(await getItem(db, 'b')).toMatchObject({ onHand: 0, lastCounted: '2026-10-24' });
  });

  it('files the item to a picked location, spelled as in the list, and remembers it as recent', async () => {
    await setup();
    await saveCount(db, 'b', 1, 'bin a', '2026-10-24');
    expect((await getItem(db, 'b'))?.location).toBe('Bin A');
    expect(await getRecentLocations(db)).toEqual(['Bin A']);
  });

  it("'' moves the item to No location", async () => {
    await setup();
    await saveCount(db, 'a', 1, '', '2026-10-24');
    expect((await getItem(db, 'a'))?.location).toBe('');
    expect(await getRecentLocations(db)).toEqual([]);
  });

  it('a location not in the list is refused and nothing changes', async () => {
    await setup();
    await expect(saveCount(db, 'b', 1, 'Nowhere', '2026-10-24')).rejects.toThrow(/Location list/);
    expect(await getItem(db, 'b')).toMatchObject({ onHand: 0, lastCounted: '', location: '' });
  });

  it.each([-1, 1.5, Number.NaN])('refuses %s', async (n) => {
    await setup();
    await expect(saveCount(db, 'b', n)).rejects.toThrow(RangeError);
  });

  it('refuses an unknown item', async () => {
    await setup();
    await expect(saveCount(db, 'zz', 1)).rejects.toThrow(/no item/);
  });

  it('resume: after two saves the group says Continue and opens at the third item', async () => {
    await setup();
    await saveCount(db, 'a', 2, undefined, '2026-10-24');
    await saveCount(db, 'b', 2, undefined, '2026-10-24');
    const snap = await loadSnapshot(db);
    const [g] = countGroups(snap.items, snap.categories, snap.locations, 'category', false);
    expect(g!.action).toBe('continue');
    expect(g!.items[firstToCount(g!.items)]!.id).toBe('c');
    expect(overallProgress(snap.items)).toEqual({ counted: 2, total: 4 });
  });
});

describe('count rounds (SPEC v0.6 F24)', () => {
  it('no round until one is started; start, change, clear', async () => {
    await setup();
    expect(await getCountSince(db)).toBe('');
    await setCountSince(db, '2026-10-24');
    expect(await getCountSince(db)).toBe('2026-10-24');
    await setCountSince(db, '');
    expect(await getCountSince(db)).toBe('');
  });

  it('refuses something that is not a date, and keeps the round', async () => {
    await setup();
    await setCountSince(db, '2026-10-24');
    await expect(setCountSince(db, 'Oct 24')).rejects.toThrow(RangeError);
    expect(await getCountSince(db)).toBe('2026-10-24');
  });

  it('a stored value that is not a date reads as no round', async () => {
    await setup();
    await db.settings.put({ key: 'countSince', value: 20261024 });
    expect(await getCountSince(db)).toBe('');
  });

  it('starting a round erases nothing', async () => {
    await setup();
    await saveCount(db, 'a', 5, undefined, '2026-10-01');
    await setCountSince(db, '2026-10-24');
    expect(await getItem(db, 'a')).toMatchObject({ onHand: 5, lastCounted: '2026-10-01' });
    const snap = await loadSnapshot(db);
    expect(overallProgress(snap.items, await getCountSince(db))).toEqual({ counted: 0, total: 4 });
    await saveCount(db, 'a', 6, undefined, '2026-10-24');
    expect(overallProgress((await loadSnapshot(db)).items, '2026-10-24')).toEqual({ counted: 1, total: 4 });
  });
});

describe('count-in on the starter catalog', () => {
  it('nothing counted, $8,413.66; counting an item to its desired + spares lowers the total', async () => {
    const seed = await readSeed(seedBytes());
    if (!seed.ok) throw new Error('seed');
    db = new InventoryDb(`c-${Math.random()}`);
    await replaceAll(db, seed.data, 1);
    let snap = await loadSnapshot(db);
    expect(overallProgress(snap.items)).toEqual({ counted: 0, total: 129 });
    expect(orderTotalCents(snap.items)).toBe(841366);
    // No locations in the starter catalog: by location everything is in "No location".
    expect(countGroups(snap.items, snap.categories, snap.locations, 'location', false).map((g) => [g.name, g.items.length])).toEqual([['No location', 129]]);
    const [first] = countGroups(snap.items, snap.categories, snap.locations, 'category', false);
    const it0 = first!.items[0]!;
    await saveCount(db, it0.id, it0.desired + it0.spares, undefined, '2026-10-24');
    snap = await loadSnapshot(db);
    expect(orderTotalCents(snap.items)).toBeLessThan(841366);
    expect(overallProgress(snap.items).counted).toBe(1);
  });
});

describe('count-in preferences', () => {
  const memory = (): KeyValueStore => {
    const m = new Map<string, string>();
    return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
  };

  it('defaults: by category, ask for location on, skip desired 0 off', () => {
    expect(loadCountOptions(memory())).toEqual({ mode: 'category', askLocation: true, skipZero: false });
    expect(DEFAULT_COUNT_OPTIONS.askLocation).toBe(true);
  });

  it('round-trips and ignores bad values', () => {
    const s = memory();
    saveCountOptions({ mode: 'location', askLocation: false, skipZero: true }, s);
    expect(loadCountOptions(s)).toEqual({ mode: 'location', askLocation: false, skipZero: true });
    s.setItem('frc2408.count.options', JSON.stringify({ mode: 'sideways', askLocation: 'yes' }));
    expect(loadCountOptions(s)).toEqual(DEFAULT_COUNT_OPTIONS);
  });

  it('pause point round-trips, clears, and rejects junk', () => {
    const s = memory();
    expect(loadCountPause(s)).toBeNull();
    saveCountPause({ mode: 'location', group: 'Bin A', itemId: 'st-0001' }, s);
    expect(loadCountPause(s)).toEqual({ mode: 'location', group: 'Bin A', itemId: 'st-0001' });
    saveCountPause(null, s);
    expect(loadCountPause(s)).toBeNull();
    s.setItem('frc2408.count.paused', JSON.stringify({ mode: 'scan', group: 'x', itemId: 'y' }));
    expect(loadCountPause(s)).toBeNull();
  });

  it('a blocked store falls back to the defaults', () => {
    const broken: KeyValueStore = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(loadCountOptions(broken)).toEqual(DEFAULT_COUNT_OPTIONS);
    expect(() => saveCountPause({ mode: 'category', group: 'g', itemId: 'i' }, broken)).not.toThrow();
  });
});
