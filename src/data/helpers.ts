// Helper devices on the main tablet (§18.1): add, edit and remove helpers, and build and record
// count kits. No PIN (§6). Helpers are working records, not inventory: they aren't in backups,
// and changing them doesn't touch the "last change" time the restore comparison shows.
import { nowLocalIso } from '../domain/dates';
import { checkHelper, groupChoices, newHelperId, newKitId, sortHelpers, type Helper, type HelperDraft } from '../domain/helpers';
import { buildCountKit } from '../io/count-kit';
import { fromHelperRow, toHelperRow, type InventoryDb } from './db';
import { loadSnapshot } from './inventory';

export async function loadHelpers(db: InventoryDb): Promise<Helper[]> {
  return sortHelpers((await db.helpers.toArray()).map(fromHelperRow));
}

async function choicesFor(db: InventoryDb, draft: HelperDraft): Promise<string[]> {
  return groupChoices(draft.kind, await db.categories.orderBy('order').toArray(), await db.locations.orderBy('order').toArray());
}

function failed(errors: Partial<Record<string, string>>): Error {
  return new Error(Object.values(errors).join(' '));
}

export async function addHelper(db: InventoryDb, draft: HelperDraft, now = Date.now()): Promise<Helper> {
  return db.transaction('rw', db.helpers, db.categories, db.locations, async () => {
    const helpers = (await db.helpers.toArray()).map(fromHelperRow);
    const r = checkHelper(draft, helpers, await choicesFor(db, draft));
    if (!r.ok) throw failed(r.errors);
    const ids = new Set(helpers.map((h) => h.id));
    const helper: Helper = { id: newHelperId((x) => ids.has(x)), ...r.draft, kits: [], lastImportAt: null, created: now };
    await db.helpers.add(toHelperRow(helper));
    return helper;
  });
}

/** Changes take effect in the next kit (§18.1). The name stays locked once a kit was sent. */
export async function editHelper(db: InventoryDb, id: string, draft: HelperDraft): Promise<Helper> {
  return db.transaction('rw', db.helpers, db.categories, db.locations, async () => {
    const row = await db.helpers.get(id);
    if (!row) throw new Error('that helper was removed');
    const editing = fromHelperRow(row);
    const r = checkHelper(draft, (await db.helpers.toArray()).map(fromHelperRow), await choicesFor(db, draft), editing);
    if (!r.ok) throw failed(r.errors);
    const helper: Helper = { ...editing, ...r.draft };
    await db.helpers.put(toHelperRow(helper));
    return helper;
  });
}

/** Removing a helper doesn't touch counts already imported (§18.1). */
export async function removeHelper(db: InventoryDb, id: string): Promise<void> {
  await db.helpers.delete(id);
}

export interface BuiltKit {
  blob: Blob;
  kitId: string;
  createdAt: string;
  itemCount: number;
  photoCount: number;
}

/**
 * Builds a count kit for one helper (§18.2) from the inventory as it is now, read in one
 * transaction so items and photos agree. Nothing is recorded until `recordKit`, after the
 * file has been handed on.
 */
export async function buildKit(db: InventoryDb, helperId: string, includePhotos: boolean, now = new Date()): Promise<BuiltKit> {
  const { helper, snapshot, photos, kitIds } = await db.transaction('r', [db.helpers, db.items, db.suppliers, db.locations, db.categories, db.photos], async () => {
    const row = await db.helpers.get(helperId);
    if (!row) throw new Error('that helper was removed');
    const all = (await db.helpers.toArray()).map(fromHelperRow);
    return {
      helper: fromHelperRow(row),
      snapshot: await loadSnapshot(db),
      photos: includePhotos ? new Map((await db.photos.toArray()).map((p) => [p.itemId, p.full] as const)) : new Map<string, Blob>(),
      kitIds: new Set(all.flatMap((h) => h.kits.map((k) => k.id))),
    };
  });
  const choices = groupChoices(helper.kind, snapshot.categories, snapshot.locations);
  const check = checkHelper(helper, [], choices, helper);
  if (!check.ok) throw new Error(`Edit this helper first: ${Object.values(check.errors).join(' ')}`);
  const kitId = newKitId((x) => kitIds.has(x));
  const createdAt = nowLocalIso();
  const ids = new Set(snapshot.items.map((i) => i.id));
  const blob = await buildCountKit({ snapshot, photos, helper: { ...helper, groups: check.draft.groups }, kitId, createdAt, includePhotos, now });
  return { blob, kitId, createdAt, itemCount: snapshot.items.length, photoCount: [...photos.keys()].filter((id) => ids.has(id)).length };
}

/** A kit was handed on (shared or saved): record it, which also locks the helper's name (§18.1). */
export async function recordKit(db: InventoryDb, helperId: string, kit: { kitId: string; createdAt: string }): Promise<void> {
  await db.transaction('rw', db.helpers, async () => {
    const row = await db.helpers.get(helperId);
    if (!row) throw new Error('that helper was removed');
    await db.helpers.put({ ...row, kits: [...row.kits, { id: kit.kitId, createdAt: kit.createdAt }] });
  });
}
