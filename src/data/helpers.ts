// Helper devices on the main tablet (§18.1): add, edit and remove helpers, and record the count
// kits sent to them (building a kit is in kits.ts). No PIN (§6). Helpers are working records, not inventory: they aren't in backups,
// and changing them doesn't touch the "last change" time the restore comparison shows.
import { checkHelper, groupChoices, newHelperId, sortHelpers, subcategoryChoices, type Helper, type HelperDraft } from '../domain/helpers';
import { fromHelperRow, toHelperRow, type InventoryDb } from './db';

export async function loadHelpers(db: InventoryDb): Promise<Helper[]> {
  return sortHelpers((await db.helpers.toArray()).map(fromHelperRow));
}

async function choicesFor(db: InventoryDb, draft: HelperDraft) {
  const categories = await db.categories.orderBy('order').toArray();
  const choices = groupChoices(draft.kind, categories, await db.locations.orderBy('order').toArray());
  const subChoices = draft.kind === 'category' ? subcategoryChoices(categories, await db.items.toArray()) : undefined;
  return { choices, subChoices };
}

function failed(errors: Partial<Record<string, string>>): Error {
  return new Error(Object.values(errors).join(' '));
}

export async function addHelper(db: InventoryDb, draft: HelperDraft, now = Date.now()): Promise<Helper> {
  return db.transaction('rw', db.helpers, db.categories, db.locations, db.items, async () => {
    const helpers = (await db.helpers.toArray()).map(fromHelperRow);
    const { choices, subChoices } = await choicesFor(db, draft);
    const r = checkHelper(draft, helpers, choices, null, subChoices);
    if (!r.ok) throw failed(r.errors);
    const ids = new Set(helpers.map((h) => h.id));
    const helper: Helper = { id: newHelperId((x) => ids.has(x)), ...r.draft, kits: [], lastImportAt: null, created: now };
    await db.helpers.add(toHelperRow(helper));
    return helper;
  });
}

/** Changes take effect in the next kit (§18.1). The name stays locked once a kit was sent. */
export async function editHelper(db: InventoryDb, id: string, draft: HelperDraft): Promise<Helper> {
  return db.transaction('rw', db.helpers, db.categories, db.locations, db.items, async () => {
    const row = await db.helpers.get(id);
    if (!row) throw new Error('that helper was removed');
    const editing = fromHelperRow(row);
    const { choices, subChoices } = await choicesFor(db, draft);
    const r = checkHelper(draft, (await db.helpers.toArray()).map(fromHelperRow), choices, editing, subChoices);
    if (!r.ok) throw failed(r.errors);
    // Limits are replaced as a whole: an edit that counts a whole category drops the old limit.
    const { subcategories: _old, ...kept } = editing;
    const helper: Helper = { ...kept, ...r.draft };
    await db.helpers.put(toHelperRow(helper));
    return helper;
  });
}

/** Removing a helper doesn't touch counts already imported (§18.1). */
export async function removeHelper(db: InventoryDb, id: string): Promise<void> {
  await db.helpers.delete(id);
}

/** A kit was handed on (shared or saved): record it, which also locks the helper's name (§18.1). */
export async function recordKit(db: InventoryDb, helperId: string, kit: { kitId: string; createdAt: string }): Promise<void> {
  await recordKits(db, [{ helperId, ...kit }]);
}

/** Several kits handed on together (Send all kits, v0.20): all recorded, or none. */
export async function recordKits(db: InventoryDb, kits: ReadonlyArray<{ helperId: string; kitId: string; createdAt: string }>): Promise<void> {
  await db.transaction('rw', db.helpers, async () => {
    for (const kit of kits) {
      const row = await db.helpers.get(kit.helperId);
      if (!row) throw new Error('that helper was removed');
      await db.helpers.put({ ...row, kits: [...row.kits, { id: kit.kitId, createdAt: kit.createdAt }] });
    }
  });
}
