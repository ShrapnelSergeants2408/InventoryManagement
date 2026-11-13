// Cycle counts and the count round in a new kit (SPEC §18.2, §19, v0.20).
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { getCountSince, setCountSince } from '../src/data/count';
import { InventoryDb, toHelperRow, toItemRow } from '../src/data/db';
import { buildKit } from '../src/data/helpers';
import { HelperDb, joinKit } from '../src/data/helper-db';
import { setSettings, getSettings } from '../src/data/settings';
import { countGroups } from '../src/domain/count';
import type { Helper } from '../src/domain/helpers';
import { dueCount, isDue } from '../src/domain/recount';
import { shopStatus, hasShopStatus } from '../src/domain/shop-status';
import { checkSettings } from '../src/domain/settings-limits';
import { readCountKit } from '../src/io/count-kit';
import { item } from './helpers';

const day = (d: string) => `${d}T10:00:00-06:00`;

describe('isDue', () => {
  it('is exact at the boundary: 90 days is fine, 91 is due', () => {
    expect(isDue({ lastCounted: day('2026-08-14') }, '2026-11-12', 90)).toBe(false);
    expect(isDue({ lastCounted: day('2026-08-13') }, '2026-11-12', 90)).toBe(true);
  });
  it('an item never counted is not due (it already shows NOT COUNTED)', () => {
    expect(isDue({ lastCounted: '' }, '2026-11-12', 90)).toBe(false);
  });
  it('counts a list', () => {
    expect(dueCount([{ lastCounted: day('2026-01-01') }, { lastCounted: '' }, { lastCounted: day('2026-11-01') }], '2026-11-12', 90)).toBe(1);
  });
});

describe('where it shows', () => {
  const items = [item({ id: 'A', category: 'Motors', lastCounted: day('2026-01-01') }), item({ id: 'B', category: 'Motors', lastCounted: day('2026-11-10') }), item({ id: 'C', category: 'Wire', lastCounted: '' })];
  const cats = [{ name: 'Motors', order: 0, subcategories: [] }, { name: 'Wire', order: 1, subcategories: [] }];
  it('count groups carry how many are due', () => {
    const g = countGroups(items, cats, [], 'category', false, '', { today: '2026-11-12', days: 90 });
    expect(g.map((x) => [x.name, x.due])).toEqual([['Motors', 1], ['Wire', 0]]);
    expect(countGroups(items, cats, [], 'category', false).map((x) => x.due)).toEqual([0, 0]);
  });
  it('the status strip shows when something is due, and says how many', () => {
    const s = shopStatus({ orders: [], pending: 0, items, onOrder: new Map(), today: '2026-11-12', staleDays: 90, overdueDays: 14, recountDays: 90 });
    expect([s.due, hasShopStatus(s)]).toEqual([1, true]);
    expect(hasShopStatus(shopStatus({ orders: [], pending: 0, items, onOrder: new Map(), today: '2026-11-12', staleDays: 90, overdueDays: 14, recountDays: 400 }))).toBe(false);
  });
  it('the setting is 7 to 365 days', () => {
    const d = { reminderDays: '7', staleDays: '90', unlockMinutes: '5', overdueDays: '14', recountDays: '90' };
    expect(checkSettings(d).ok).toBe(true);
    for (const bad of ['6', '366', '', '1.5']) expect(checkSettings({ ...d, recountDays: bad }).ok, bad).toBe(false);
  });
});

describe('a new kit carries the tablet’s round and recount age', () => {
  let n = 0;
  const open: Dexie[] = [];
  afterEach(async () => {
    for (const db of open.splice(0)) {
      db.close();
      await Dexie.delete(db.name);
    }
  });
  const maya: Helper = { id: 'hp-MAYA1', name: 'Maya', kind: 'category', groups: ['Motors'], allowNewItems: true, kits: [], lastImportAt: null, created: 1 };

  async function tablet() {
    const db = new InventoryDb(`m25-recount-${++n}`);
    open.push(db);
    await db.items.bulkAdd([toItemRow(item({ id: 'A', category: 'Motors', lastCounted: day('2026-11-10'), countedBy: 'Maya' }), 1)]);
    await db.categories.bulkAdd([{ name: 'Motors', order: 0, subcategories: [] }]);
    await db.helpers.add(toHelperRow(maya));
    return db;
  }

  it('the kit has count_since and recount_days, and the helper keeps them, so progress is not back at zero', async () => {
    const db = await tablet();
    await setCountSince(db, '2026-11-09');
    await setSettings(db, { recountDays: 45 });
    const built = await buildKit(db, 'hp-MAYA1', false);
    const read = await readCountKit(new Uint8Array(await built.blob.arrayBuffer()));
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect([read.read.kit.countSince, read.read.kit.recountDays]).toEqual(['2026-11-09', 45]);

    const phone = new HelperDb(`m25-recount-phone-${++n}`);
    open.push(phone);
    await joinKit(phone, read.read, 1000);
    expect(await getCountSince(phone as unknown as InventoryDb)).toBe('2026-11-09');
    expect((await getSettings(phone as unknown as InventoryDb)).recountDays).toBe(45);
  });

  it('a first-count tablet (no round) gives a blank date, and joining again replaces an older round', async () => {
    const db = await tablet();
    const built = await buildKit(db, 'hp-MAYA1', false);
    const read = await readCountKit(new Uint8Array(await built.blob.arrayBuffer()));
    if (!read.ok) throw new Error('kit');
    const phone = new HelperDb(`m25-recount-phone-${++n}`);
    open.push(phone);
    await phone.settings.put({ key: 'countSince', value: '2026-01-01' });
    await joinKit(phone, read.read, 1000);
    expect(await getCountSince(phone as unknown as InventoryDb)).toBe('');
    expect((await getSettings(phone as unknown as InventoryDb)).recountDays).toBe(90);
  });
});
