// Named order lists in the database (F27, §19): create, rename, duplicate, delete, lines,
// item delete, backup and both kinds of restore (§15 Q7d).
import 'fake-indexeddb/auto';
import JSZip from 'jszip';
import { afterEach, describe, expect, it } from 'vitest';
import { applyRestore, buildBackup } from '../src/data/backup';
import { InventoryDb } from '../src/data/db';
import { loadSnapshot, replaceAll } from '../src/data/inventory';
import { deleteItem } from '../src/data/items';
import {
  addManyToOrderList,
  addToOrderList,
  createOrderList,
  deleteOrderList,
  duplicateOrderList,
  editOrderList,
  listsWithItem,
  loadOrderLists,
  removeLine,
  setLineQuantity,
} from '../src/data/order-lists';
import { getSettings } from '../src/data/settings';
import { buildOrderList } from '../src/domain/order';
import { readRestoreFile } from '../src/io/restore';
import { item, vendor } from './helpers';

const dbs: InventoryDb[] = [];
const newDb = () => {
  const d = new InventoryDb(`ol-${Math.random()}`);
  dbs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dbs.splice(0)) d.close();
});

const lists = {
  suppliers: [
    { name: 'REV', website: '', notes: '' },
    { name: 'other', website: '', notes: '' },
  ],
  locations: [],
  categories: [{ name: 'Motors', order: 0, subcategories: [] }],
};

async function seeded(): Promise<InventoryDb> {
  const db = newDb();
  await replaceAll(db, {
    ...lists,
    items: [
      item({ id: 'a', name: 'NEO', desired: 4, spares: 1, onHand: 1 }),
      item({ id: 'b', name: 'Falcon', desired: 2, vendors: [vendor({ packSize: 5 }), null, null] }),
      item({ id: 'c', name: 'Bolt' }),
    ],
    photos: new Map(),
  });
  return db;
}

describe('creating and editing lists (F27, no PIN)', () => {
  it('creates, renames, duplicates and deletes', async () => {
    const db = await seeded();
    const wcp = await createOrderList(db, ' WCP order ', ' for Nov ', 100);
    expect(wcp).toMatchObject({ name: 'WCP order', notes: 'for Nov', created: 100, updated: 100, lines: [] });
    await expect(createOrderList(db, 'wcp ORDER', '')).rejects.toThrow('There’s already a list called “WCP order”.');
    await addToOrderList(db, wcp.id, 'a', 4, {}, 110);

    const renamed = await editOrderList(db, wcp.id, 'WCP Order', 'changed', 120);
    expect(renamed).toMatchObject({ id: wcp.id, name: 'WCP Order', notes: 'changed', created: 100, updated: 120 });

    const copy = await duplicateOrderList(db, wcp.id, undefined, 130);
    expect(copy).toMatchObject({ name: 'WCP Order (copy)', notes: 'changed', created: 130, lines: [{ itemId: 'a', quantity: 4 }] });
    expect(copy.id).not.toBe(wcp.id);
    // The copy is its own list: changing it leaves the original alone.
    await setLineQuantity(db, copy.id, 'a', 9);
    expect((await loadOrderLists(db)).find((l) => l.id === wcp.id)!.lines).toEqual([{ itemId: 'a', quantity: 4 }]);

    await deleteOrderList(db, wcp.id);
    expect((await loadOrderLists(db)).map((l) => l.name)).toEqual(['WCP Order (copy)']);
    expect((await getSettings(db)).lastChangeAt).not.toBeNull();
  });

  it('lists come back A–Z ignoring capitals', async () => {
    const db = await seeded();
    for (const n of ['zeta', 'Alpha', 'beta']) await createOrderList(db, n, '');
    expect((await loadOrderLists(db)).map((l) => l.name)).toEqual(['Alpha', 'beta', 'zeta']);
  });
});

describe('lines (F27)', () => {
  it('adding an item already on the list asks first: nothing changes until replace', async () => {
    const db = await seeded();
    const l = await createOrderList(db, 'L', '');
    expect(await addToOrderList(db, l.id, 'a', 4)).toEqual({ kind: 'added' });
    expect(await addToOrderList(db, l.id, 'a', 10)).toEqual({ kind: 'exists', quantity: 4 });
    expect((await loadOrderLists(db))[0]!.lines).toEqual([{ itemId: 'a', quantity: 4 }]);
    expect(await addToOrderList(db, l.id, 'a', 10, { replace: true })).toEqual({ kind: 'replaced', was: 4 });
    expect((await loadOrderLists(db))[0]!.lines).toEqual([{ itemId: 'a', quantity: 10 }]);
  });

  it('quantities are whole numbers ≥ 1; unknown items and lists are refused', async () => {
    const db = await seeded();
    const l = await createOrderList(db, 'L', '');
    await expect(addToOrderList(db, l.id, 'a', 0)).rejects.toThrow(RangeError);
    await expect(addToOrderList(db, l.id, 'a', 1.5)).rejects.toThrow(RangeError);
    await expect(addToOrderList(db, l.id, 'zzz', 1)).rejects.toThrow(/deleted/);
    await expect(addToOrderList(db, 'ol-none', 'a', 1)).rejects.toThrow(/deleted/);
    await addToOrderList(db, l.id, 'a', 1);
    await expect(setLineQuantity(db, l.id, 'a', 0)).rejects.toThrow(RangeError);
    await expect(setLineQuantity(db, l.id, 'b', 3)).rejects.toThrow(/removed/);
  });

  it('+/− and remove change only that line', async () => {
    const db = await seeded();
    const l = await createOrderList(db, 'L', '');
    await addToOrderList(db, l.id, 'a', 1);
    await addToOrderList(db, l.id, 'b', 5);
    await setLineQuantity(db, l.id, 'b', 10);
    await removeLine(db, l.id, 'a');
    expect((await loadOrderLists(db))[0]!.lines).toEqual([{ itemId: 'b', quantity: 10 }]);
  });

  it('lists never change on_hand, desired, spares or the automatic list', async () => {
    const db = await seeded();
    const before = await loadSnapshot(db);
    const l = await createOrderList(db, 'L', '');
    await addToOrderList(db, l.id, 'a', 7);
    await addToOrderList(db, l.id, 'c', 3);
    await setLineQuantity(db, l.id, 'a', 9);
    await duplicateOrderList(db, l.id);
    await removeLine(db, l.id, 'c');
    await deleteOrderList(db, l.id);
    const after = await loadSnapshot(db);
    expect(after.items).toEqual(before.items);
    expect(buildOrderList(after.items)).toEqual(buildOrderList(before.items));
  });
});

describe('deleting an item (F27, F8)', () => {
  it('takes it off every list and says how many lists it was on', async () => {
    const db = await seeded();
    const one = await createOrderList(db, 'One', '');
    const two = await createOrderList(db, 'Two', '');
    const three = await createOrderList(db, 'Three', '');
    await addToOrderList(db, one.id, 'a', 1);
    await addToOrderList(db, one.id, 'b', 5);
    await addToOrderList(db, two.id, 'a', 2);
    await addToOrderList(db, three.id, 'c', 1);
    expect(await listsWithItem(db, 'a')).toEqual(['One', 'Two']);
    expect(await deleteItem(db, 'a')).toBe(2);
    const after = Object.fromEntries((await loadOrderLists(db)).map((l) => [l.name, l.lines]));
    expect(after).toEqual({ One: [{ itemId: 'b', quantity: 5 }], Two: [], Three: [{ itemId: 'c', quantity: 1 }] });
    expect(await listsWithItem(db, 'a')).toEqual([]);
    expect(await deleteItem(db, 'c')).toBe(1);
    expect(await deleteItem(db, 'b')).toBe(1);
  });
});

describe('backup and restore (F15, F17, §15 Q7d)', () => {
  async function withLists() {
    const db = await seeded();
    const keep = await createOrderList(db, 'Keep me', 'n, "q"');
    await addToOrderList(db, keep.id, 'a', 3);
    await addToOrderList(db, keep.id, 'b', 10);
    await createOrderList(db, 'Empty', '');
    return db;
  }
  const file = async (name: string, blob: Blob) => ({ name, bytes: new Uint8Array(await blob.arrayBuffer()) });
  const plan = async (db: InventoryDb, f: { name: string; bytes: Uint8Array }) => {
    const r = await readRestoreFile(f, await loadSnapshot(db));
    if (!r.ok) throw new Error(JSON.stringify(r.problems));
    return r.plan;
  };
  const shape = async (db: InventoryDb) => (await loadOrderLists(db)).map((l) => ({ id: l.id, name: l.name, notes: l.notes, lines: l.lines }));

  it('a full backup round-trips the lists, including an empty one', async () => {
    const src = await withLists();
    const zip = await buildBackup(src, 'full', new Date(2026, 9, 23));
    const dst = newDb();
    await applyRestore(dst, await plan(dst, await file('b.zip', zip)));
    expect(await shape(dst)).toEqual(await shape(src));
  });

  it('a full restore replaces the tablet’s lists with the backup’s', async () => {
    const src = await withLists();
    const zip = await buildBackup(src, 'full', new Date(2026, 9, 23));
    const dst = await seeded();
    await createOrderList(dst, 'Only on the tablet', '');
    await applyRestore(dst, await plan(dst, await file('b.zip', zip)));
    expect((await loadOrderLists(dst)).map((l) => l.name)).toEqual(['Empty', 'Keep me']);
  });

  it('a ZIP without order-lists.csv has no named lists, so the tablet’s are removed', async () => {
    const src = await withLists();
    const zip = await JSZip.loadAsync(await (await buildBackup(src, 'full', new Date(2026, 9, 23))).arrayBuffer());
    zip.remove('order-lists.csv');
    const older = new Blob([await zip.generateAsync({ type: 'arraybuffer' })]);
    await applyRestore(src, await plan(src, await file('old.zip', older)));
    expect(await loadOrderLists(src)).toEqual([]);
  });

  it('a CSV-only restore keeps the lists and drops lines for items that are gone', async () => {
    const db = await withLists();
    // A data-only CSV without item b.
    const csvDb = newDb();
    await replaceAll(csvDb, { ...lists, items: [item({ id: 'a', name: 'NEO' }), item({ id: 'c', name: 'Bolt' })], photos: new Map() });
    const csv = await buildBackup(csvDb, 'data', new Date(2026, 9, 23));
    const p = await plan(db, await file('d.csv', csv));
    expect(p.orderLists).toBeNull();
    await applyRestore(db, p);
    expect((await shape(db)).map((l) => [l.name, l.lines])).toEqual([
      ['Empty', []],
      ['Keep me', [{ itemId: 'a', quantity: 3 }]],
    ]);
  });

  it('a backup’s list lines for items not in the backup are left out, with a warning', async () => {
    const src = await withLists();
    const zip = await JSZip.loadAsync(await (await buildBackup(src, 'full', new Date(2026, 9, 23))).arrayBuffer());
    const text = (await zip.file('order-lists.csv')!.async('string')) + 'ol-X,Hand edited,,st-9999,2\r\n';
    zip.file('order-lists.csv', text);
    const edited = new Blob([await zip.generateAsync({ type: 'arraybuffer' })]);
    const p = await plan(src, await file('e.zip', edited));
    expect(p.warnings.join(' ')).toMatch(/1 order-list line/);
    expect(p.orderLists!.find((l) => l.name === 'Hand edited')!.lines).toEqual([]);
  });

  it('a bad order-lists.csv stops the restore before anything changes', async () => {
    const src = await withLists();
    const zip = await JSZip.loadAsync(await (await buildBackup(src, 'full', new Date(2026, 9, 23))).arrayBuffer());
    zip.file('order-lists.csv', 'list_id,list_name,list_notes,item_id,quantity\r\nol-1,A,,a,0\r\n');
    const bad = new Uint8Array(await zip.generateAsync({ type: 'arraybuffer' }));
    const r = await readRestoreFile({ name: 'bad.zip', bytes: bad }, await loadSnapshot(src));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems[0]).toMatchObject({ file: 'order-lists.csv', row: 2 });
  });
});

describe('add many at once (F27, one transaction)', () => {
  it('adds to a new list, skipping items at the target', async () => {
    const db = await seeded();
    // a: desired 4 + spares 1, on hand 1 → desired only: 3. b: desired 2, packs of 5 → 5. c: desired 0 → skipped.
    const r = await addManyToOrderList(db, { newName: 'AndyMark' }, ['a', 'b', 'c'], 'desired', false, 50);
    expect([r.added, r.replaced, r.kept, r.skipped]).toEqual([2, 0, 0, 1]);
    expect(r.list).toMatchObject({ name: 'AndyMark', created: 50, lines: [{ itemId: 'a', quantity: 3 }, { itemId: 'b', quantity: 5 }] });
    expect((await loadOrderLists(db)).map((l) => l.name)).toEqual(['AndyMark']);
  });

  it('asks once for items already on the list: replace or keep', async () => {
    const db = await seeded();
    const l = await createOrderList(db, 'L', '');
    await addToOrderList(db, l.id, 'a', 9);
    const kept = await addManyToOrderList(db, { listId: l.id }, ['a', 'b'], 'spares', false);
    expect([kept.added, kept.kept, kept.replaced]).toEqual([1, 1, 0]);
    expect((await loadOrderLists(db))[0]!.lines).toEqual([{ itemId: 'a', quantity: 9 }, { itemId: 'b', quantity: 5 }]);
    const rep = await addManyToOrderList(db, { listId: l.id }, ['a', 'b'], 'spares', true);
    expect([rep.added, rep.kept, rep.replaced]).toEqual([0, 0, 2]);
    expect((await loadOrderLists(db))[0]!.lines).toEqual([{ itemId: 'a', quantity: 4 }, { itemId: 'b', quantity: 5 }]);
  });

  it('a clashing new name, or no items left, changes nothing; inventory never changes', async () => {
    const db = await seeded();
    const before = await loadSnapshot(db);
    await createOrderList(db, 'AndyMark', '');
    await expect(addManyToOrderList(db, { newName: 'andymark' }, ['a'], 'pack', false)).rejects.toThrow('There’s already a list called “AndyMark”.');
    await expect(addManyToOrderList(db, { newName: 'Other' }, ['gone'], 'pack', false)).rejects.toThrow(/none of those items/);
    expect((await loadOrderLists(db)).map((l) => [l.name, l.lines.length])).toEqual([['AndyMark', 0]]);
    await addManyToOrderList(db, { newName: 'Other' }, ['a', 'b', 'c'], 'pack', false);
    expect((await loadSnapshot(db)).items).toEqual(before.items);
  });
});
