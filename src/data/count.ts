// Count-in save (F24): on_hand and last_counted together, and the location when one was
// picked, in one transaction. No PIN (§6).
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
