// Helper devices on the main tablet (SPEC §3 "Helper", §18.1) and the count kit (§18.2);
// stage6-plan M16a tests: helper rules (unique name, one kind of group, the name lock) and
// kit contents (kit.json fields and format version, prices blank, the photos switch).
import 'fake-indexeddb/auto';
import JSZip from 'jszip';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InventoryDb, toItemRow, toLocationRow, toSupplierRow } from '../src/data/db';
import { addHelper, buildKit, editHelper, loadHelpers, recordKit, removeHelper } from '../src/data/helpers';
import { applyRestore } from '../src/data/backup';
import { loadSnapshot } from '../src/data/inventory';
import { startInventory } from '../src/data/setup';
import { renameCategory, updateLocation } from '../src/data/lists';
import {
  assignedHelpers,
  checkHelper,
  coverage,
  groupChoices,
  helperNameProblem,
  missingGroups,
  nameLocked,
  newHelperId,
  newKitId,
  renameGroup,
  sharedGroups,
  type Helper,
  type HelperDraft,
} from '../src/domain/helpers';
import { NO_LOCATION } from '../src/domain/lists';
import { APP_VERSION } from '../src/io/backup';
import { KIT_FILE, KIT_FORMAT, KIT_FORMAT_VERSION, buildCountKit, kitFileName, withoutPrices } from '../src/io/count-kit';
import { parseInventoryCsv, serializeInventoryCsv } from '../src/io/inventory-csv';
import { parseCategoriesCsv, parseLocationsCsv, parseSuppliersCsv } from '../src/io/lists-csv';
import { readRestoreFile } from '../src/io/restore';
import { item, vendor } from './helpers';

afterEach(() => vi.useRealTimers());

const categories = [
  { name: 'Electrical', order: 0, subcategories: ['Motors'] },
  { name: 'Fasteners', order: 1, subcategories: [] },
  { name: 'Tools', order: 2, subcategories: [] },
];
const locations = [
  { name: 'Shelf B', notes: '', order: 1 },
  { name: 'Bin A', notes: 'blue tote', order: 0 },
];

const helper = (over: Partial<Helper> = {}): Helper => ({
  id: 'hp-AAAAA',
  name: 'Tablet 2 · Alex & Jordan',
  kind: 'category',
  groups: ['Electrical'],
  allowNewItems: true,
  kits: [],
  lastImportAt: null,
  created: 1,
  ...over,
});
const draft = (over: Partial<HelperDraft> = {}): HelperDraft => ({ name: 'Maya’s phone', kind: 'category', groups: ['Fasteners'], allowNewItems: true, ...over });

describe('groups a helper can count (§18.1)', () => {
  it('categories in list order; locations in walk order then “No location”, only once there are locations', () => {
    expect(groupChoices('category', [...categories].reverse(), locations)).toEqual(['Electrical', 'Fasteners', 'Tools']);
    expect(groupChoices('location', categories, locations)).toEqual(['Bin A', 'Shelf B', NO_LOCATION]);
    expect(groupChoices('location', categories, [])).toEqual([]);
  });
});

describe('helper rules', () => {
  it('names are required, at most 40 characters, and unique ignoring capitals', () => {
    const others = [helper()];
    expect(helperNameProblem('  ', others)).toMatch(/Give the helper a name/);
    expect(helperNameProblem('x'.repeat(41), others)).toMatch(/40 characters/);
    expect(helperNameProblem('x'.repeat(40), others)).toBeNull();
    expect(helperNameProblem(' tablet 2 · ALEX & jordan ', others)).toMatch(/already a helper called “Tablet 2 · Alex & Jordan”/);
    // Its own name is fine when editing.
    expect(helperNameProblem('TABLET 2 · alex & jordan', others, 'hp-AAAAA')).toBeNull();
  });

  it('groups: at least one, one kind, from the list (taking its spelling and order)', () => {
    const choices = groupChoices('category', categories, locations);
    const ok = checkHelper(draft({ name: ' Maya ', groups: ['tools', 'ELECTRICAL'] }), [], choices);
    expect(ok).toEqual({ ok: true, draft: { name: 'Maya', kind: 'category', groups: ['Electrical', 'Tools'], allowNewItems: true } });
    expect(checkHelper(draft({ groups: [] }), [], choices)).toMatchObject({ ok: false, errors: { groups: 'Choose at least one category to count.' } });
    // A location name among categories isn't a category: one kind per helper.
    expect(checkHelper(draft({ groups: ['Fasteners', 'Bin A'] }), [], choices)).toMatchObject({ ok: false, errors: { groups: expect.stringMatching(/aren’t in the list/) } });
    const locs = groupChoices('location', categories, locations);
    expect(checkHelper(draft({ kind: 'location', groups: ['Electrical'] }), [], locs)).toMatchObject({ ok: false, errors: { groups: expect.any(String) } });
    expect(checkHelper(draft({ kind: 'location', groups: ['no location', 'Bin A'] }), [], locs)).toMatchObject({ ok: true, draft: { groups: ['Bin A', NO_LOCATION] } });
  });

  it('the name is locked once a kit was sent; everything else can still change', () => {
    const sent = helper({ kits: [{ id: 'kit-1', createdAt: '2026-10-24T18:00:00-05:00' }] });
    expect(nameLocked(helper())).toBe(false);
    expect(nameLocked(sent)).toBe(true);
    const choices = groupChoices('category', categories, locations);
    expect(checkHelper({ ...draft(), name: 'New name' }, [sent], choices, sent)).toMatchObject({ ok: false, errors: { name: expect.stringMatching(/can’t change after a kit was sent/) } });
    expect(checkHelper({ ...draft(), name: 'tablet 2 · alex & jordan' }, [sent], choices, sent)).toMatchObject({ ok: false });
    expect(checkHelper({ name: ` ${sent.name} `, kind: 'category', groups: ['Tools'], allowNewItems: false }, [sent], choices, sent)).toMatchObject({ ok: true, draft: { name: sent.name, groups: ['Tools'], allowNewItems: false } });
    // Before a kit, renaming is fine.
    expect(checkHelper({ ...draft(), name: 'New name' }, [helper()], choices, helper())).toMatchObject({ ok: true });
  });

  it('warns when another helper of the same kind already has a group', () => {
    const others = [helper(), helper({ id: 'hp-BBBBB', name: 'Maya', groups: ['Electrical', 'Fasteners'] }), helper({ id: 'hp-CCCCC', name: 'Loc', kind: 'location', groups: ['Fasteners'] })];
    expect(sharedGroups(draft({ groups: ['Electrical', 'Fasteners', 'Tools'] }), others)).toEqual([
      { group: 'Electrical', helpers: ['Tablet 2 · Alex & Jordan', 'Maya'] },
      { group: 'Fasteners', helpers: ['Maya'] },
    ]);
    // Editing a helper doesn't warn about itself.
    expect(sharedGroups({ ...draft(), groups: ['Electrical'] }, others, 'hp-AAAAA')).toEqual([{ group: 'Electrical', helpers: ['Maya'] }]);
  });

  it('coverage lists every group with its helpers; unassigned ones have none', () => {
    const hs = [helper({ name: 'Zed', groups: ['Electrical'] }), helper({ id: 'b', name: 'amy', groups: ['electrical', 'Tools'] }), helper({ id: 'c', name: 'Loc', kind: 'location', groups: ['Bin A'] })];
    expect(coverage(hs, 'category', groupChoices('category', categories, locations))).toEqual([
      { group: 'Electrical', helpers: ['amy', 'Zed'] },
      { group: 'Fasteners', helpers: [] },
      { group: 'Tools', helpers: ['amy'] },
    ]);
    expect(coverage(hs, 'location', groupChoices('location', categories, locations))).toEqual([
      { group: 'Bin A', helpers: ['Loc'] },
      { group: 'Shelf B', helpers: [] },
      { group: NO_LOCATION, helpers: [] },
    ]);
    expect(assignedHelpers(hs, 'category')).toEqual(new Map([['electrical', ['Zed', 'amy']], ['tools', ['amy']]]));
    // A location that happens to share a category's name belongs to its own kind only.
    const sameName = [helper({ id: 'd', name: 'Shelf', kind: 'location', groups: ['Fasteners'] })];
    expect(coverage(sameName, 'category', ['Fasteners'])).toEqual([{ group: 'Fasteners', helpers: [] }]);
    expect(coverage(sameName, 'location', ['Fasteners'])).toEqual([{ group: 'Fasteners', helpers: ['Shelf'] }]);
  });

  it('groups removed from the list show as missing; a rename carries the helper along', () => {
    const h = helper({ groups: ['Electrical', 'Old shelf'] });
    expect(missingGroups(h, ['Electrical', 'Tools'])).toEqual(['Old shelf']);
    const hs = [h, helper({ id: 'b', name: 'B', groups: ['Tools'] }), helper({ id: 'c', name: 'C', kind: 'location', groups: ['Electrical'] })];
    expect(renameGroup(hs, 'category', 'ELECTRICAL', 'Electronics')).toEqual([{ ...h, groups: ['Electronics', 'Old shelf'] }]);
  });

  it('ids: hp- and kit- with no look-alike characters, never one already used', () => {
    expect(newHelperId(() => false)).toMatch(/^hp-[23456789A-HJKMNP-Z]{5}$/);
    expect(newKitId(() => false)).toMatch(/^kit-[23456789A-HJKMNP-Z]{8}$/);
    let n = 0;
    const seq = () => [0, 0, 0, 0, 0, 0.99, 0.99, 0.99, 0.99, 0.99][n++ % 10]!;
    expect(newHelperId((id) => id === 'hp-22222', seq)).toBe('hp-ZZZZZ');
  });
});

describe('helpers on the tablet (data)', () => {
  async function tablet() {
    const db = new InventoryDb(`hd-${Math.random()}`);
    await db.categories.bulkAdd(categories);
    await db.locations.bulkAdd(locations.map(toLocationRow));
    await db.suppliers.bulkAdd([{ name: 'REV', website: '', notes: '' }, { name: 'other', website: '', notes: '' }].map(toSupplierRow));
    return db;
  }

  it('add, edit and remove; the rules hold in the data layer too', async () => {
    const db = await tablet();
    const a = await addHelper(db, draft({ name: 'Maya', groups: ['tools', 'Electrical'] }), 7);
    expect(a).toMatchObject({ name: 'Maya', kind: 'category', groups: ['Electrical', 'Tools'], allowNewItems: true, kits: [], lastImportAt: null, created: 7 });
    expect(a.id).toMatch(/^hp-/);
    await expect(addHelper(db, draft({ name: 'MAYA' }))).rejects.toThrow(/already a helper/);
    await expect(addHelper(db, draft({ name: 'B', kind: 'location', groups: ['Fasteners'] }))).rejects.toThrow(/aren’t in the list/);
    const b = await addHelper(db, draft({ name: 'B', kind: 'location', groups: ['Shelf B'] }));
    const edited = await editHelper(db, a.id, { name: 'Maya P', kind: 'location', groups: [NO_LOCATION], allowNewItems: false });
    expect(edited).toMatchObject({ id: a.id, name: 'Maya P', kind: 'location', groups: [NO_LOCATION], allowNewItems: false, created: 7 });
    expect((await loadHelpers(db)).map((h) => h.name)).toEqual(['B', 'Maya P']);
    await removeHelper(db, b.id);
    expect((await loadHelpers(db)).map((h) => h.name)).toEqual(['Maya P']);
    db.close();
  });

  it('after a kit is recorded the name is locked, even in the data layer', async () => {
    const db = await tablet();
    const a = await addHelper(db, draft({ name: 'Maya' }));
    await recordKit(db, a.id, { kitId: 'kit-11111111', createdAt: '2026-10-24T18:00:00-05:00' });
    await recordKit(db, a.id, { kitId: 'kit-22222222', createdAt: '2026-10-25T09:00:00-05:00' });
    const [saved] = await loadHelpers(db);
    expect(saved!.kits).toEqual([
      { id: 'kit-11111111', createdAt: '2026-10-24T18:00:00-05:00' },
      { id: 'kit-22222222', createdAt: '2026-10-25T09:00:00-05:00' },
    ]);
    await expect(editHelper(db, a.id, draft({ name: 'Other' }))).rejects.toThrow(/can’t change after a kit/);
    expect(await editHelper(db, a.id, draft({ name: 'Maya', groups: ['Tools'] }))).toMatchObject({ groups: ['Tools'], kits: saved!.kits });
    db.close();
  });

  it('renaming a category or location carries the helpers along; nothing else changes', async () => {
    const db = await tablet();
    const c = await addHelper(db, draft({ name: 'Cat', groups: ['Electrical', 'Tools'] }));
    const l = await addHelper(db, draft({ name: 'Loc', kind: 'location', groups: ['Bin A'] }));
    await renameCategory(db, 'Electrical', 'Electronics');
    await updateLocation(db, 'bin a', 'Bin A1', 'blue tote');
    const byName = new Map((await loadHelpers(db)).map((h) => [h.name, h]));
    expect(byName.get('Cat')).toEqual({ ...c, groups: ['Electronics', 'Tools'] });
    expect(byName.get('Loc')).toEqual({ ...l, groups: ['Bin A1'] });
    db.close();
  });

  it('setting up a shop tablet starts with no helpers (independent review, finding 6)', async () => {
    const db = await tablet();
    await addHelper(db, draft({ name: 'Left over' }));
    await startInventory(db, 'empty', { items: [], photos: new Map(), suppliers: [{ name: 'other', website: '', notes: '' }], locations: [], categories });
    expect(await loadHelpers(db)).toEqual([]);
    db.close();
  });

  it('helper changes don’t count as inventory changes, and a restore keeps helpers', async () => {
    const db = await tablet();
    await db.settings.put({ key: 'lastChangeAt', value: 5 });
    const a = await addHelper(db, draft({ name: 'Maya' }));
    await editHelper(db, a.id, draft({ name: 'Maya', groups: ['Tools'] }));
    expect((await db.settings.get('lastChangeAt'))!.value).toBe(5);
    const snap = await loadSnapshot(db);
    await applyRestore(db, { kind: 'zip', fileName: 'x.zip', fileSize: 1, items: [item({ category: 'Tools' })], photos: new Map(), suppliers: [{ name: 'REV', website: '', notes: '' }], locations: [], categories: snap.categories, orderLists: [], pending: [], pendingPhotos: new Map(), addedSuppliers: [], addedLocations: [], savedAt: null, savedAtSource: null, warnings: [] });
    expect((await loadHelpers(db)).map((h) => h.name)).toEqual(['Maya']);
    db.close();
  });
});

const photo = (...b: number[]) => new Blob([new Uint8Array(b)], { type: 'image/jpeg' });

function snapshot() {
  return {
    items: [
      item({
        id: 'st-0001',
        name: 'NEO 2.0, "brushless"',
        category: 'Electrical',
        subcategory: 'Motors',
        location: 'Bin A',
        onHand: 3,
        desired: 4,
        spares: 1,
        notes: 'use with Thrifty swerve,\nask before cutting "x"',
        lastCounted: '2026-10-24T18:42:07-05:00',
        countedBy: 'Maya',
        barcode: '012345678905',
        preferredVendor: 2,
        vendors: [vendor({ packPriceCents: 4999, priceChecked: '2026-10-17' }), vendor({ supplier: 'other', partNo: 'X-1', url: 'https://x.test/a?b=1,2', packSize: 5, packPriceCents: 1234, priceChecked: '2026-09-01' }), null],
        hasPhoto: true,
      }),
      item({ id: 'tm-ABCDE', name: 'Plain', category: 'Tools', vendors: [vendor({ packPriceCents: null, priceChecked: '' }), null, null] }),
    ],
    suppliers: [
      { name: 'REV', website: 'https://revrobotics.com', notes: 'login, "needed"' },
      { name: 'other', website: '', notes: '' },
    ],
    locations: [{ name: 'Bin A', notes: 'blue tote', order: 0 }],
    categories,
  };
}

async function readKit(blob: Blob) {
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const text = (n: string) => zip.file(n)!.async('string');
  return { zip, names: Object.keys(zip.files).sort(), text };
}

describe('count kit contents (§18.2)', () => {
  const input = (includePhotos: boolean) => ({
    snapshot: snapshot(),
    photos: new Map([
      ['st-0001', photo(0xff, 0xd8, 1, 2, 0xff, 0xd9)],
      ['gone-item', photo(9)],
    ]),
    helper: helper({ groups: ['Electrical', 'Tools'], allowNewItems: false }),
    kitId: 'kit-ABCDEFGH',
    createdAt: '2026-10-24T18:50:00-05:00',
    includePhotos,
    now: new Date(2026, 9, 24, 18, 50),
  });

  it('kit.json carries the format and version, the kit, the helper, the time, the app version, the groups and the new-items setting', async () => {
    const kit = await readKit(await buildCountKit(input(true)));
    expect(JSON.parse(await kit.text(KIT_FILE))).toEqual({
      format: KIT_FORMAT,
      format_version: KIT_FORMAT_VERSION,
      kit_id: 'kit-ABCDEFGH',
      helper_id: 'hp-AAAAA',
      helper_name: 'Tablet 2 · Alex & Jordan',
      created_at: '2026-10-24T18:50:00-05:00',
      app_version: APP_VERSION,
      groups: { kind: 'category', names: ['Electrical', 'Tools'] },
      allow_new_items: false,
    });
    expect(KIT_FORMAT).toBe('frc2408-count-kit');
    expect(KIT_FORMAT_VERSION).toBe(1);
  });

  it('holds the §7 inventory with pack prices and price-checked dates blank, and everything else exact', async () => {
    const kit = await readKit(await buildCountKit(input(true)));
    expect(kit.names).toEqual(['categories.csv', 'inventory.csv', 'kit.json', 'locations.csv', 'photos/', 'photos/st-0001.jpg', 'suppliers.csv']);
    const csv = await kit.text('inventory.csv');
    const parsed = parseInventoryCsv(csv);
    expect(parsed.problems).toEqual([]);
    expect(parsed.items).toEqual(snapshot().items.map((i) => ({ ...withoutPrices(i), hasPhoto: false })));
    for (const i of parsed.items) for (const v of i.vendors) if (v) expect([v.packPriceCents, v.priceChecked]).toEqual([null, '']);
    // Nothing that looks like a price in the file.
    expect(csv).not.toMatch(/49\.99|12\.34|2026-10-17|2026-09-01/);
    expect(parsed.photoFiles).toEqual(new Map([['st-0001', 'photos/st-0001.jpg']]));
    expect([...new Uint8Array(await kit.zip.file('photos/st-0001.jpg')!.async('arraybuffer'))]).toEqual([0xff, 0xd8, 1, 2, 0xff, 0xd9]);
    expect(parseSuppliersCsv(await kit.text('suppliers.csv')).list).toEqual(snapshot().suppliers);
    expect(parseLocationsCsv(await kit.text('locations.csv')).list).toEqual(snapshot().locations);
    expect(parseCategoriesCsv(await kit.text('categories.csv')).list).toEqual(categories);
  });

  it('“Include photos” off: no photos folder, and photo_file is blank', async () => {
    const kit = await readKit(await buildCountKit(input(false)));
    expect(kit.names).toEqual(['categories.csv', 'inventory.csv', 'kit.json', 'locations.csv', 'suppliers.csv']);
    expect(parseInventoryCsv(await kit.text('inventory.csv')).photoFiles.size).toBe(0);
  });

  it('is not a backup: no order lists or manifest, and Restore refuses it', async () => {
    const blob = await buildCountKit(input(true));
    const kit = await readKit(blob);
    expect(kit.names).not.toContain('order-lists.csv');
    expect(kit.names).not.toContain('manifest.json');
    const r = await readRestoreFile({ name: 'count-kit-x.zip', bytes: new Uint8Array(await blob.arrayBuffer()) }, { items: [], suppliers: [], locations: [], categories: [] });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.problems[0]!.message).toMatch(/count kit for a helper device, not a backup/);
  });

  it('its inventory.csv on its own is refused too, when the tablet has prices (independent review, finding 1)', async () => {
    const kit = await readKit(await buildCountKit(input(true)));
    const bytes = new TextEncoder().encode(await kit.text('inventory.csv'));
    const priced = snapshot();
    const r = await readRestoreFile({ name: 'inventory.csv', bytes }, priced);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.problems[0]!.message).toMatch(/no prices at all, but this tablet has prices.*count kit/);
    // A tablet with no prices yet (e.g. Start empty) can still take it; so can a priced backup.
    const unpriced = { ...priced, items: priced.items.map(withoutPrices) };
    expect((await readRestoreFile({ name: 'inventory.csv', bytes }, unpriced)).ok).toBe(true);
    const backup = new TextEncoder().encode(serializeInventoryCsv(priced.items));
    expect((await readRestoreFile({ name: 'inventory-backup.csv', bytes: backup }, priced)).ok).toBe(true);
  });

  it('file name: count-kit-<helper name>-<yyyy-mm-dd-hhmm>.zip, safe for any device', () => {
    expect(kitFileName('Tablet 2 · Alex & Jordan', new Date(2026, 9, 24, 18, 5))).toBe('count-kit-tablet-2-alex-jordan-2026-10-24-1805.zip');
    expect(kitFileName('Maya’s phone / ../x', new Date(2026, 0, 2, 3, 4))).toBe('count-kit-maya-s-phone-x-2026-01-02-0304.zip');
    expect(kitFileName('🤖', new Date(2026, 0, 2, 3, 4))).toBe('count-kit-2026-01-02-0304.zip');
  });
});

describe('building a kit from the tablet', () => {
  async function filled() {
    const db = new InventoryDb(`kit-${Math.random()}`);
    const s = snapshot();
    await db.items.bulkAdd(s.items.map((i) => toItemRow(i, 1)));
    await db.photos.add({ itemId: 'st-0001', full: photo(0xff, 0xd8, 7), thumb: null, updatedAt: 1 });
    await db.suppliers.bulkAdd(s.suppliers.map(toSupplierRow));
    await db.locations.bulkAdd(s.locations.map(toLocationRow));
    await db.categories.bulkAdd(s.categories);
    return db;
  }

  it('builds from the inventory as it is now, with a new kit id each time, and records only when told', async () => {
    const db = await filled();
    const h = await addHelper(db, draft({ name: 'Maya', groups: ['Tools'] }));
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(Date.UTC(2026, 9, 24, 23, 50)));
    const one = await buildKit(db, h.id, true);
    const two = await buildKit(db, h.id, false);
    expect(one.kitId).toMatch(/^kit-/);
    expect(two.kitId).not.toBe(one.kitId);
    expect(one).toMatchObject({ createdAt: '2026-10-24T18:50:00-05:00', itemCount: 2, photoCount: 1 });
    expect(two.photoCount).toBe(0);
    expect((await loadHelpers(db))[0]!.kits).toEqual([]);
    const k = JSON.parse(await (await readKit(one.blob)).text(KIT_FILE));
    expect(k).toMatchObject({ kit_id: one.kitId, helper_id: h.id, helper_name: 'Maya', created_at: '2026-10-24T18:50:00-05:00', groups: { kind: 'category', names: ['Tools'] } });
    await recordKit(db, h.id, one);
    expect((await loadHelpers(db))[0]!.kits).toEqual([{ id: one.kitId, createdAt: one.createdAt }]);
    db.close();
  });

  it('created_at is the time it was asked for (independent review, finding 6)', async () => {
    const db = await filled();
    const h = await addHelper(db, draft({ name: 'Maya', groups: ['Tools'] }));
    const k = await buildKit(db, h.id, false, new Date(2026, 0, 5, 7, 3, 9));
    expect(k.createdAt).toBe('2026-01-05T07:03:09-06:00');
    expect(JSON.parse(await (await readKit(k.blob)).text(KIT_FILE)).created_at).toBe('2026-01-05T07:03:09-06:00');
    db.close();
  });

  it('refuses a helper whose groups are all gone from the list', async () => {
    const db = await filled();
    const h = await addHelper(db, draft({ name: 'Maya', groups: ['Tools'] }));
    await db.categories.delete('Tools');
    await expect(buildKit(db, h.id, true)).rejects.toThrow(/Edit this helper first/);
    db.close();
  });
});
