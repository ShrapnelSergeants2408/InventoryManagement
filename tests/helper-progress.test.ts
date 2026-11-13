// Per-helper progress and Send all kits (SPEC §18.1, v0.20).
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { InventoryDb, toHelperRow, toItemRow } from '../src/data/db';
import { buildKit, recordKits } from '../src/data/helpers';
import type { Helper } from '../src/domain/helpers';
import { helperProgress } from '../src/domain/helper-progress';
import { shareFilesOrDownload } from '../src/io/share';
import { item } from './helpers';

const KIT_AT = '2026-11-10T15:00:00-06:00';
const at = (hm: string) => `2026-11-10T${hm}:00-06:00`;
const maya = (over: Partial<Helper> = {}): Helper => ({ id: 'hp-MAYA1', name: 'Maya', kind: 'category', groups: ['Electrical'], allowNewItems: true, kits: [{ id: 'kit-ONE00001', createdAt: KIT_AT }], lastImportAt: null, created: 1, ...over });

describe('helperProgress', () => {
  const items = [
    item({ id: 'A', category: 'Electrical', lastCounted: at('15:10'), countedBy: 'Maya' }),
    item({ id: 'B', category: 'Electrical', lastCounted: at('14:00'), countedBy: 'Maya' }), // before the kit
    item({ id: 'C', category: 'Electrical', lastCounted: at('15:20'), countedBy: 'Sam' }), // someone else
    item({ id: 'D', category: 'Electrical', lastCounted: '', countedBy: '' }),
    item({ id: 'E', category: 'Motors', lastCounted: at('15:30'), countedBy: 'Maya' }), // outside her groups
    item({ id: 'F', category: 'Electrical', lastCounted: at('15:40'), countedBy: 'maya' }), // names ignore capitals
  ];

  it('counts her items counted by her since her last kit', () => {
    expect(helperProgress(maya(), items)).toEqual({ total: 5, counted: 2 });
  });

  it('is null until a kit was sent, and starts over with a new kit', () => {
    expect(helperProgress(maya({ kits: [] }), items)).toBe(null);
    expect(helperProgress(maya({ kits: [{ id: 'k1', createdAt: KIT_AT }, { id: 'k2', createdAt: at('15:35') }] }), items)).toEqual({ total: 5, counted: 1 });
  });

  it('works for location helpers, with items that have no location in "No location"', () => {
    const rows = [item({ id: 'A', location: 'Bin A', lastCounted: at('15:10'), countedBy: 'Maya' }), item({ id: 'B', location: '', lastCounted: at('15:11'), countedBy: 'Maya' }), item({ id: 'C', location: 'Bin B' })];
    expect(helperProgress(maya({ kind: 'location', groups: ['Bin A', 'No location'] }), rows)).toEqual({ total: 2, counted: 2 });
  });
});

describe('shareFilesOrDownload', () => {
  const files = [new File(['a'], 'a.zip'), new File(['b'], 'b.zip')];
  it('shares all the files in one sheet', async () => {
    const shared: ShareData[] = [];
    const r = await shareFilesOrDownload(files, 'Kits', { canShare: () => true, share: async (d) => void shared.push(d), download: () => expect.fail('no download') });
    expect([r, shared.length, shared[0]!.files!.map((f) => f.name)]).toEqual(['shared', 1, ['a.zip', 'b.zip']]);
  });
  it('downloads each file when the browser cannot share them', async () => {
    const got: string[] = [];
    const r = await shareFilesOrDownload(files, 'Kits', { download: (f) => void got.push(f.name) });
    expect([r, got]).toEqual(['downloaded', ['a.zip', 'b.zip']]);
  });
  it('closing the sheet is cancelled and downloads nothing', async () => {
    const r = await shareFilesOrDownload(files, 'Kits', {
      canShare: () => true,
      share: async () => {
        throw new DOMException('closed', 'AbortError');
      },
      download: () => expect.fail('no download'),
    });
    expect(r).toBe('cancelled');
  });
});

describe('Send all kits (data)', () => {
  let n = 0;
  const open: Dexie[] = [];
  afterEach(async () => {
    for (const db of open.splice(0)) {
      db.close();
      await Dexie.delete(db.name);
    }
  });
  async function tablet(): Promise<InventoryDb> {
    const db = new InventoryDb(`m25-send-${++n}`);
    open.push(db);
    await db.items.bulkAdd([toItemRow(item({ id: 'A', category: 'Electrical' }), 1)]);
    await db.categories.bulkAdd([{ name: 'Electrical', order: 0, subcategories: [] }, { name: 'Motors', order: 1, subcategories: [] }]);
    await db.helpers.bulkAdd([toHelperRow(maya({ kits: [] })), toHelperRow(maya({ id: 'hp-SAM01', name: 'Sam', groups: ['Motors'], kits: [] }))]);
    return db;
  }

  it('builds a kit for each helper, with its own kit id, and records them together', async () => {
    const db = await tablet();
    const now = new Date(2026, 10, 12, 10, 0);
    const kits = [await buildKit(db, 'hp-MAYA1', false, now), await buildKit(db, 'hp-SAM01', false, now)];
    expect(kits[0]!.kitId).not.toBe(kits[1]!.kitId);
    await recordKits(db, [{ helperId: 'hp-MAYA1', ...kits[0]! }, { helperId: 'hp-SAM01', ...kits[1]! }]);
    expect((await db.helpers.get('hp-MAYA1'))!.kits.map((k) => k.id)).toEqual([kits[0]!.kitId]);
    expect((await db.helpers.get('hp-SAM01'))!.kits.map((k) => k.id)).toEqual([kits[1]!.kitId]);
  });

  it('records none when one helper was removed meanwhile', async () => {
    const db = await tablet();
    const k = await buildKit(db, 'hp-MAYA1', false);
    await expect(recordKits(db, [{ helperId: 'hp-MAYA1', ...k }, { helperId: 'hp-GONE1', kitId: 'kit-X', createdAt: KIT_AT }])).rejects.toThrow(/removed/);
    expect((await db.helpers.get('hp-MAYA1'))!.kits).toEqual([]);
  });

  it('a helper whose group is gone cannot be built, so Send all can stop before sharing', async () => {
    const db = await tablet();
    await db.helpers.put(toHelperRow(maya({ id: 'hp-SAM01', name: 'Sam', groups: ['Gone'], kits: [] })));
    await expect(buildKit(db, 'hp-SAM01', false)).rejects.toThrow(/Edit this helper first/);
  });
});
