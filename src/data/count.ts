// Count-in save (F24): on_hand and last_counted together, and the location when one was
// picked, in one transaction. No PIN (§6).
import { cleanSince } from '../domain/count';
import { localIsoDate } from '../domain/dates';
import { pushRecent } from '../domain/lists';
import { nameKey, type Item } from '../domain/types';
import { fromItemRow, type InventoryDb } from './db';
import { RECENT_LOCATIONS, getRecentLocations } from './items';

/**
 * Saves one counted item. `location` is a name from the Location list or '' for "No
 * location"; undefined leaves the item's location as it is. Returns the item as saved.
 */
export async function saveCount(db: InventoryDb, id: string, onHand: number, location?: string, today = localIsoDate(), now = Date.now()): Promise<Item> {
  if (!Number.isSafeInteger(onHand) || onHand < 0) throw new RangeError('the count must be a whole number ≥ 0');
  return db.transaction('rw', db.items, db.locations, db.settings, async () => {
    const row = await db.items.get(id);
    if (!row) throw new Error(`no item with id ${id}`);
    let loc = row.location;
    if (location !== undefined && location !== '') {
      const listed = await db.locations.get(nameKey(location));
      if (!listed) throw new Error(`location “${location}” isn't in the Location list`);
      loc = listed.name;
    } else if (location === '') loc = '';
    const saved = {
      ...row,
      onHand,
      lastCounted: today,
      location: loc,
      updatedAt: now,
    };
    await db.items.put(saved);
    await db.settings.put({ key: 'lastChangeAt', value: now });
    if (location !== undefined && loc !== '')
      await db.settings.put({
        key: RECENT_LOCATIONS,
        value: pushRecent(await getRecentLocations(db), loc),
      });
    return fromItemRow(saved);
  });
}

export const COUNT_SINCE = 'countSince';

/** The "counting since" date of the current count round (F24), or '' for the first count. */
export async function getCountSince(db: InventoryDb): Promise<string> {
  return cleanSince((await db.settings.get(COUNT_SINCE))?.value);
}

/** Starts a count round from `since` (YYYY-MM-DD), or '' to count from the beginning. Erases nothing. */
export async function setCountSince(db: InventoryDb, since: string): Promise<void> {
  if (since !== '' && cleanSince(since) === '') throw new RangeError(`not a date: ${since}`);
  await db.settings.put({ key: COUNT_SINCE, value: since });
}
