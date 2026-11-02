// First launch (SPEC v2.0 §12.5): what the inventory starts with (the default categories, or a
// backup file) and the end of setup. Each choice replaces the (empty) inventory and marks
// setup done in one transaction, so a phone closed part-way simply shows the choice again.
import type { Category } from '../domain/types';
import type { InventoryDb } from './db';
import { replaceAll, type ReplaceAllInput } from './inventory';

export const SETUP_DONE = 'setupDoneAt';

export type StartChoice = 'restore' | 'empty';

/** Setup is done once the inventory's starting point has been chosen. */
export async function isSetUp(db: InventoryDb): Promise<boolean> {
  return typeof (await db.settings.get(SETUP_DONE))?.value === 'number';
}

/**
 * Fills the inventory for the first time. Refused once setup is done, so this can never
 * replace the household's data (restoring later is F18). Returns how many items have a photo.
 */
export async function startInventory(db: InventoryDb, data: ReplaceAllInput, now = Date.now()): Promise<number> {
  return db.transaction('rw', [db.items, db.photos, db.locations, db.categories, db.settings], async () => {
    if (await isSetUp(db)) throw new Error('this phone is already set up; use Restore in More › Backup instead');
    const photos = await replaceAll(db, data, now);
    await db.settings.put({ key: SETUP_DONE, value: now });
    return photos;
  });
}

/** Default categories (SPEC v2.0 §3, Category). */
export const DEFAULT_CATEGORIES: readonly string[] = [
  'Decorations',
  'Lights',
  'Tools',
  'Hardware',
  'Yard & garden',
  'Sports & outdoors',
  'Seasonal clothing',
  'Kitchen',
  'Pantry',
  'Cleaning & laundry',
  'Electronics',
  'Documents & keepsakes',
  'Other',
];

/** "Start fresh": the default categories, no items or locations. */
export function emptyStart(): ReplaceAllInput {
  const categories: Category[] = DEFAULT_CATEGORIES.map((name, order) => ({ name, order, subcategories: [] }));
  return { items: [], photos: new Map(), locations: [], categories };
}

/**
 * Asks the browser to keep this app's data (SPEC v2.0 §2). true: granted; false: refused;
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
 * Boot and install: asks again while the data isn't persistent yet, since
 * the browser may grant it later (after install, more use). Returns what persisted() then says;
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

/** Sent on the window when a launch-time request finds storage persistent, so open screens re-read it. */
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
