// First launch (F22, spec-questions Q2): what the inventory starts with — the starter
// catalog, a backup file, or empty lists — and the end of setup. Each choice replaces the
// (empty) inventory and marks setup done in one transaction, so a tablet closed part-way
// simply shows the choice again.
import type { Category, Supplier } from '../domain/types';
import type { InventoryDb } from './db';
import type { RestorePlan } from '../io/restore';
import { replaceAll, type ReplaceAllInput } from './inventory';
import { replacePending } from './pending';
import { replaceOrders } from './placed-orders';

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
  const tables = [db.items, db.photos, db.suppliers, db.locations, db.categories, db.orderLists, db.settings, db.helpers, db.pendingItems, db.pendingPhotos, db.importUndo, db.orders, db.receipts];
  return db.transaction('rw', tables, async () => {
    if (await isSetUp(db)) throw new Error('this tablet is already set up; use Restore in More › Backup instead');
    // A backup restored at setup brings its order lists, pending items and placed orders (§7, F22, §21.6).
    const p = data as Partial<Pick<RestorePlan, 'orderLists' | 'pending' | 'pendingPhotos' | 'orders' | 'receipts'>>;
    const photos = await replaceAll(db, data, now, { orderLists: p.orderLists ?? [] });
    // A fresh shop tablet starts with no helpers (§18.1), whatever an earlier install left.
    await db.helpers.clear();
    // …and nothing pending from helpers, nothing to undo (§18.5).
    await Promise.all([db.pendingItems.clear(), db.pendingPhotos.clear(), db.importUndo.clear()]);
    if (p.pending) await replacePending(db, p.pending, p.pendingPhotos ?? new Map());
    await replaceOrders(db, p.orders ?? [], p.receipts ?? new Map());
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

/**
 * Boot and install (Stage 5 T-01): asks again while the data isn't persistent yet, since
 * Chrome may grant it later (after install, more use). Returns what persisted() then says;
 * null when the browser can't say.
 */
export async function ensurePersistentStorage(
  storage: Partial<Pick<StorageManager, 'persist' | 'persisted'>> | undefined = globalThis.navigator?.storage,
): Promise<boolean | null> {
  if (!storage?.persisted) return null;
  try {
    if (await storage.persisted()) return true;
    if (storage.persist) await storage.persist();
    return await storage.persisted();
  } catch {
    return null;
  }
}

/** Sent on the window when a launch-time request finds storage persistent, so open screens re-read it (Stage 5 finding 9). */
export const STORAGE_PERSISTED_EVENT = 'inventory:storage-persisted';

type EventHost = Pick<EventTarget, 'addEventListener' | 'removeEventListener' | 'dispatchEvent'>;

/**
 * App boot (§2, T-01): asks now and again after install, and announces a grant. Returns the
 * cleanup for the install listener.
 */
export function watchPersistentStorage(host: EventHost = window, ensure: () => Promise<boolean | null> = ensurePersistentStorage): () => void {
  const ask = () =>
    void ensure().then((granted) => {
      if (granted) host.dispatchEvent(new Event(STORAGE_PERSISTED_EVENT));
    });
  ask();
  host.addEventListener('appinstalled', ask);
  return () => host.removeEventListener('appinstalled', ask);
}
