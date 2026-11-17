// Building a count kit for a helper on the main tablet (§18.1, §18.2). Kept apart from helpers.ts
// (adding, editing and recording helpers) so the start-up code doesn't load JSZip (review R8, M33).
import { localIsoDateTime } from '../domain/dates';
import { checkHelper, groupChoices, newKitId, subcategoryChoices } from '../domain/helpers';
import { buildCountKit } from '../io/count-kit';
import { fromHelperRow, type InventoryDb } from './db';
import { getCountSince } from './count';
import { loadSnapshot } from './inventory';
import { getSettings } from './settings';
import { kitPhotos, type KitPhotoProgress, type Shrink } from './kit-photos';

export interface BuiltKit {
  blob: Blob;
  kitId: string;
  createdAt: string;
  itemCount: number;
  photoCount: number;
}

/** The tablet's settings that travel in a kit: the recount age and the shared Drive folder links (v0.20, v0.21). */
async function kitSettings(db: InventoryDb) {
  const s = await getSettings(db);
  return { recountDays: s.recountDays, kitsFolderUrl: s.kitsFolderUrl, countsFolderUrl: s.countsFolderUrl };
}

/**
 * Builds a count kit for one helper (§18.2) from the inventory as it is now, read in one
 * transaction so items and photos agree. Nothing is recorded until `recordKit`, after the
 * file has been handed on.
 */
export async function buildKit(
  db: InventoryDb,
  helperId: string,
  includePhotos: boolean,
  now = new Date(),
  /** v0.27 (M32): makes each photo small for the kit; without it (tests) the stored photos go in. */
  opts: { shrink?: Shrink; onProgress?: KitPhotoProgress } = {},
): Promise<BuiltKit> {
  const { helper, snapshot, photoRows, kitIds, countSince, recountDays, kitsFolderUrl, countsFolderUrl } = await db.transaction('r', [db.helpers, db.items, db.suppliers, db.locations, db.categories, db.photos, db.settings], async () => {
    const row = await db.helpers.get(helperId);
    if (!row) throw new Error('that helper was removed');
    const all = (await db.helpers.toArray()).map(fromHelperRow);
    return {
      helper: fromHelperRow(row),
      snapshot: await loadSnapshot(db),
      photoRows: includePhotos ? await db.photos.toArray() : [],
      kitIds: new Set(all.flatMap((h) => h.kits.map((k) => k.id))),
      countSince: await getCountSince(db),
      ...(await kitSettings(db)),
    };
  });
  const choices = groupChoices(helper.kind, snapshot.categories, snapshot.locations);
  const check = checkHelper(helper, [], choices, helper, helper.kind === 'category' ? subcategoryChoices(snapshot.categories, snapshot.items) : undefined);
  if (!check.ok) throw new Error(`Edit this helper first: ${Object.values(check.errors).join(' ')}`);
  const kitId = newKitId((x) => kitIds.has(x));
  const createdAt = localIsoDateTime(now);
  const ids = new Set(snapshot.items.map((i) => i.id));
  // Made small after the read, outside the transaction (canvas work would let it close early).
  const rows = photoRows.filter((p) => ids.has(p.itemId));
  const photos = opts.shrink ? await kitPhotos(rows, opts.shrink, opts.onProgress) : new Map(rows.map((p) => [p.itemId, p.full] as const));
  const blob = await buildCountKit({ snapshot, photos, helper: { ...helper, groups: check.draft.groups, subcategories: check.draft.subcategories }, kitId, createdAt, includePhotos, now, countSince, recountDays, kitsFolderUrl, countsFolderUrl });
  return { blob, kitId, createdAt, itemCount: snapshot.items.length, photoCount: [...photos.keys()].filter((id) => ids.has(id)).length };
}
