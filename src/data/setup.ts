// First launch (F22, spec-questions Q2): what the inventory starts with — the starter
// catalog, a backup file, or empty lists — and the end of setup. Each choice replaces the
// (empty) inventory and marks setup done in one transaction, so a tablet closed part-way
// simply shows the choice again.
import type { Category, Supplier } from '../domain/types';
import type { InventoryDb } from './db';
import { replaceAll, type ReplaceAllInput } from './inventory';

export const SETUP_DONE = 'setupDoneAt';
/** When the starter catalog was loaded (kept from the pre-M10 boot load). */
export const STARTER_LOADED = 'starterLoadedAt';

export type StartChoice = 'starter' | 'restore' | 'empty';

/** Setup is done once the inventory's starting point has been chosen (after the PIN, §6). */
export async function isSetUp(db: InventoryDb): Promise<boolean> {
  return typeof (await db.settings.get(SETUP_DONE))?.value === 'number';
}

/**
 * Fills the inventory for the first time. Refused once setup is done, so this can never
 * replace a team's data (restoring later is F17, behind the PIN). Returns how many items have a photo.
 */
export async function startInventory(db: InventoryDb, choice: StartChoice, data: ReplaceAllInput, now = Date.now()): Promise<number> {
  return db.transaction('rw', [db.items, db.photos, db.suppliers, db.locations, db.categories, db.settings], async () => {
    if (await isSetUp(db)) throw new Error('this tablet is already set up; use Restore in More › Backup instead');
    const photos = await replaceAll(db, data, now);
    await db.settings.put({ key: SETUP_DONE, value: now });
    if (choice === 'starter') await db.settings.put({ key: STARTER_LOADED, value: now });
    return photos;
  });
}

/** "Start empty": the starter catalog's suppliers and categories, with no items (9h). */
export function emptyStart(lists: { suppliers: Supplier[]; categories: Category[] }): ReplaceAllInput {
  return { items: [], photos: new Map(), suppliers: lists.suppliers, locations: [], categories: lists.categories.map((c) => ({ ...c })) };
}

/**
 * Asks the browser to keep this app's data (SPEC §2). true: granted; false: refused;
 * null: the browser can't say (no Storage API).
 */
export async function requestPersistentStorage(storage: Pick<StorageManager, 'persist'> | undefined = globalThis.navigator?.storage): Promise<boolean | null> {
  if (!storage?.persist) return null;
  try {
    return await storage.persist();
  } catch {
    return null;
  }
}
