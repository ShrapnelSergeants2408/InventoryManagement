// Helpers limited to some subcategories of a category (SPEC v0.22).
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { InventoryDb, toHelperRow, toItemRow } from '../src/data/db';
import { addHelper, buildKit, editHelper, loadHelpers } from '../src/data/helpers';
import { HelperDb, getKit, joinKit } from '../src/data/helper-db';
import { addSubcategory, renameCategory, renameSubcategory } from '../src/data/lists';
import { checkKitJson, inAssignment } from '../src/domain/helper-mode';
import { helperProgress } from '../src/domain/helper-progress';
import {
  checkHelper,
  coverage,
  groupLabels,
  missingGroups,
  renameGroup,
  renameSubgroup,
  sharedGroups,
  subcategoryChoices,
  type Helper,
  type HelperDraft,
} from '../src/domain/helpers';
import { NO_SUBCATEGORY } from '../src/domain/lists';
import type { Category } from '../src/domain/types';
import { readCountKit } from '../src/io/count-kit';
import { item } from './helpers';

const categories: Category[] = [
  { name: 'Mechanical', order: 0, subcategories: ['Wheels', 'Gears', 'Belts'] },
  { name: 'Electrical', order: 1, subcategories: [] },
];
const items = [
  item({ id: 'a', category: 'Mechanical', subcategory: 'Wheels' }),
  item({ id: 'b', category: 'Mechanical', subcategory: 'Gears' }),
  item({ id: 'c', category: 'Mechanical', subcategory: 'Belts' }),
  item({ id: 'd', category: 'Mechanical', subcategory: '' }),
  item({ id: 'e', category: 'Electrical', subcategory: '' }),
];
const subChoices = subcategoryChoices(categories, items);
const choices = ['Mechanical', 'Electrical'];

const draft = (over: Partial<HelperDraft> = {}): HelperDraft => ({ name: 'Maya', kind: 'category', groups: ['Mechanical'], allowNewItems: true, ...over });
const helper = (over: Partial<Helper> = {}): Helper => ({ id: 'hp-AAAAA', name: 'Maya', kind: 'category', groups: ['Mechanical'], allowNewItems: true, kits: [], lastImportAt: null, created: 1, ...over });

describe('the subcategory choices', () => {
  it('are the list’s, then any an item uses, then “No subcategory” when items sit directly under the category', () => {
    expect(subChoices.Mechanical).toEqual(['Wheels', 'Gears', 'Belts', NO_SUBCATEGORY]);
    expect(subChoices.Electrical).toEqual([NO_SUBCATEGORY]);
    const odd = subcategoryChoices(categories, [item({ category: 'Mechanical', subcategory: 'Chains' })]);
    expect(odd.Mechanical).toEqual(['Wheels', 'Gears', 'Belts', 'Chains']);
  });
});

describe('checking a helper limited to subcategories', () => {
  const run = (d: HelperDraft) => checkHelper(d, [], choices, null, subChoices);
  it('keeps a part of a category, in the list’s order and spelling', () => {
    const r = run(draft({ subcategories: { mechanical: ['gears', 'WHEELS'] } }));
    expect(r.ok && r.draft.subcategories).toEqual({ Mechanical: ['Wheels', 'Gears'] });
  });
  it('every subcategory ticked is the whole category: no limit is stored', () => {
    const r = run(draft({ subcategories: { Mechanical: [...subChoices.Mechanical!] } }));
    expect(r.ok && r.draft.subcategories).toBeUndefined();
  });
  it('none ticked is refused with what to do', () => {
    const r = run(draft({ subcategories: { Mechanical: [] } }));
    expect(r.ok ? '' : r.errors.groups).toMatch(/Choose at least one subcategory of Mechanical, or count all of it/);
  });
  it('a subcategory that isn’t in the list is refused', () => {
    const r = run(draft({ subcategories: { Mechanical: ['Wheels', 'Sprockets'] } }));
    expect(r.ok ? '' : r.errors.groups).toMatch(/Some subcategories of Mechanical aren’t in the list any more/);
  });
  it('limits for a category that isn’t chosen are dropped, and a location helper has none', () => {
    const r = run(draft({ groups: ['Electrical'], subcategories: { Mechanical: ['Wheels'] } }));
    expect(r.ok && r.draft.subcategories).toBeUndefined();
    const l = checkHelper({ ...draft({ kind: 'location', groups: ['Bin A'], subcategories: { Mechanical: ['Wheels'] } }) }, [], ['Bin A'], null, undefined);
    expect(l.ok && l.draft.subcategories).toBeUndefined();
  });
});

describe('which items are in a helper’s groups', () => {
  const kit = { kind: 'category' as const, groups: ['Mechanical', 'Electrical'], subcategories: { Mechanical: ['Wheels', NO_SUBCATEGORY] } };
  it('a limited category counts only those subcategories; “No subcategory” means items with none', () => {
    expect(items.map((i) => [i.id, inAssignment(i, kit)])).toEqual([['a', true], ['b', false], ['c', false], ['d', true], ['e', true]]);
  });
  it('a category with no limit is whole; a kit without limits (older) counts every item of the category', () => {
    expect(items.filter((i) => inAssignment(i, { kind: 'category', groups: ['Mechanical'] })).map((i) => i.id)).toEqual(['a', 'b', 'c', 'd']);
  });
  it('progress counts only the helper’s subcategories', () => {
    const h = helper({ subcategories: { Mechanical: ['Gears'] }, kits: [{ id: 'k', createdAt: '2026-11-01T10:00:00-06:00' }] });
    const counted = items.map((i) => ({ ...i, lastCounted: '2026-11-02T10:00:00-06:00', countedBy: 'Maya' }));
    expect(helperProgress(h, counted)).toEqual({ total: 1, counted: 1 });
  });
});

describe('sharing and coverage', () => {
  const wheels = helper({ id: 'w', name: 'Wheels crew', subcategories: { Mechanical: ['Wheels'] } });
  const gears = helper({ id: 'g', name: 'Gears crew', subcategories: { Mechanical: ['Gears', 'Belts'] } });
  it('two helpers on different subcategories of one category don’t share it', () => {
    expect(sharedGroups(draft({ subcategories: { Mechanical: ['Gears'] } }), [wheels])).toEqual([]);
  });
  it('overlapping parts, or a whole category against a part, do', () => {
    expect(sharedGroups(draft({ subcategories: { Mechanical: ['Gears', 'Wheels'] } }), [wheels])).toEqual([{ group: 'Mechanical', helpers: ['Wheels crew'] }]);
    expect(sharedGroups(draft(), [wheels])).toEqual([{ group: 'Mechanical', helpers: ['Wheels crew'] }]);
  });
  it('coverage names the parts, flags overlap, and lists what nobody has', () => {
    expect(coverage([wheels, gears], 'category', choices, subChoices)[0]).toEqual({
      group: 'Mechanical',
      helpers: ['Gears crew (Gears, Belts)', 'Wheels crew (Wheels)'],
      overlap: false,
      uncovered: [NO_SUBCATEGORY],
    });
    expect(coverage([wheels, helper({ id: 'x', name: 'Whole' })], 'category', choices, subChoices)[0]).toMatchObject({ overlap: true, uncovered: [] });
  });
  it('group labels show the parts', () => {
    expect(groupLabels(helper({ groups: ['Mechanical', 'Electrical'], subcategories: { Mechanical: ['Wheels', 'Gears'] } }))).toEqual(['Mechanical (Wheels, Gears)', 'Electrical']);
  });
});

describe('renames and removed subcategories', () => {
  const h = helper({ subcategories: { Mechanical: ['Wheels', 'Gears'] } });
  it('a renamed category or subcategory is followed', () => {
    expect(renameGroup([h], 'category', 'Mechanical', 'Mech')[0]).toMatchObject({ groups: ['Mech'], subcategories: { Mech: ['Wheels', 'Gears'] } });
    expect(renameSubgroup([h], 'Mechanical', 'wheels', 'Tires')[0]!.subcategories).toEqual({ Mechanical: ['Tires', 'Gears'] });
    expect(renameSubgroup([h], 'Mechanical', 'Belts', 'x')).toEqual([]);
  });
  it('a subcategory no longer in the list is reported as Category › Subcategory', () => {
    const gone = missingGroups(helper({ subcategories: { Mechanical: ['Wheels', 'Sprockets'] } }), choices, subChoices);
    expect(gone).toEqual(['Mechanical › Sprockets']);
  });
});

describe('the kit file', () => {
  const base = { format: 'frc2408-count-kit', format_version: 1, kit_id: 'kit-1', helper_id: 'hp-1', helper_name: 'Maya', created_at: '2026-11-13T10:00:00-06:00' };
  it('reads the limits, ignoring anything that isn’t a list of text', () => {
    const r = (subcategories: unknown) => {
      const c = checkKitJson({ ...base, groups: { kind: 'category', names: ['Mechanical'], subcategories } });
      return c.ok ? c.kit.subcategories : null;
    };
    expect(r({ Mechanical: ['Wheels'] })).toEqual({ Mechanical: ['Wheels'] });
    expect(r({ Mechanical: [], Bad: 5, Worse: [1] })).toEqual({});
    expect(r('nope')).toEqual({});
    expect(r(undefined)).toEqual({});
  });
});

describe('on the tablet', () => {
  let n = 0;
  const open: Dexie[] = [];
  afterEach(async () => {
    for (const db of open.splice(0)) {
      db.close();
      await Dexie.delete(db.name);
    }
  });
  async function tablet() {
    const db = new InventoryDb(`m27-subs-${++n}`);
    open.push(db);
    await db.items.bulkAdd(items.map((i, k) => toItemRow(i, k + 1)));
    await db.categories.bulkAdd(categories);
    return db;
  }

  it('saves a helper with its subcategories, and an edit to the whole category drops the limit', async () => {
    const db = await tablet();
    const h = await addHelper(db, draft({ name: 'Wheels crew', subcategories: { Mechanical: ['Wheels'] } }));
    expect(h.subcategories).toEqual({ Mechanical: ['Wheels'] });
    expect((await loadHelpers(db))[0]!.subcategories).toEqual({ Mechanical: ['Wheels'] });
    const whole = await editHelper(db, h.id, draft({ name: 'Wheels crew' }));
    expect(whole.subcategories).toBeUndefined();
    expect((await loadHelpers(db))[0]!.subcategories).toBeUndefined();
  });

  it('the kit carries the limits and the helper keeps them, so its Count screen and progress follow', async () => {
    const db = await tablet();
    const h = await addHelper(db, draft({ name: 'Wheels crew', subcategories: { Mechanical: ['Wheels', 'Gears'] } }));
    const built = await buildKit(db, h.id, false);
    const read = await readCountKit(new Uint8Array(await built.blob.arrayBuffer()));
    if (!read.ok) throw new Error('kit');
    expect(read.read.kit.subcategories).toEqual({ Mechanical: ['Wheels', 'Gears'] });
    const phone = new HelperDb(`m27-subs-phone-${++n}`);
    open.push(phone);
    await joinKit(phone, read.read, 1000);
    const kit = await getKit(phone);
    expect(kit && items.filter((i) => inAssignment(i, kit)).map((i) => i.id)).toEqual(['a', 'b']);
  });

  it('a helper with no limit makes a kit with none (kit.json has no subcategories)', async () => {
    const db = await tablet();
    const h = await addHelper(db, draft({ name: 'Whole' }));
    const built = await buildKit(db, h.id, false);
    const read = await readCountKit(new Uint8Array(await built.blob.arrayBuffer()));
    if (!read.ok) throw new Error('kit');
    expect(read.read.kit.subcategories).toEqual({});
  });

  it('renaming the category or the subcategory on the tablet updates the helper', async () => {
    const db = await tablet();
    const h = await addHelper(db, draft({ name: 'Wheels crew', subcategories: { Mechanical: ['Wheels'] } }));
    await renameSubcategory(db, 'Mechanical', 'Wheels', 'Tires');
    expect((await loadHelpers(db))[0]!.subcategories).toEqual({ Mechanical: ['Tires'] });
    await renameCategory(db, 'Mechanical', 'Mech');
    const after = (await loadHelpers(db))[0]!;
    expect([after.groups, after.subcategories]).toEqual([['Mech'], { Mech: ['Tires'] }]);
    expect(h.id).toBe(after.id);
  });

  it('a limit to a subcategory added later can be saved', async () => {
    const db = await tablet();
    await addSubcategory(db, 'Mechanical', 'Chains');
    const h = await addHelper(db, draft({ name: 'Chains', subcategories: { Mechanical: ['Chains'] } }));
    expect(h.subcategories).toEqual({ Mechanical: ['Chains'] });
  });
});

// A row from before v0.22 has no limits at all.
describe('helpers saved before v0.22', () => {
  it('still count their whole categories', () => {
    const row = toHelperRow(helper());
    expect(row.subcategories).toBeUndefined();
    expect(items.filter((i) => inAssignment(i, row)).length).toBe(4);
  });
});
