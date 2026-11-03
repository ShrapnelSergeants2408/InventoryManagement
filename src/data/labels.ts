// Per-layout alignment nudge (SPEC §9), kept with the device settings: never in a backup,
// and not an inventory change.
import { binSummary, cleanNudge, type Nudge } from '../domain/labels';
import type { InventoryDb } from './db';

const key = (layoutId: string) => `labelNudge.${layoutId}`;

export async function getNudge(db: InventoryDb, layoutId: string): Promise<Nudge> {
  return cleanNudge((await db.settings.get(key(layoutId)))?.value);
}

export async function setNudge(db: InventoryDb, layoutId: string, nudge: Nudge): Promise<Nudge> {
  const clean = cleanNudge(nudge);
  await db.settings.put({ key: key(layoutId), value: clean });
  return clean;
}

/**
 * Records that bin labels were printed (§9): when, and the contents summary printed on them, so
 * a later change shows "Label out of date". Unknown ids are skipped.
 */
export async function recordBinLabels(db: InventoryDb, binIds: readonly string[], now = Date.now()): Promise<void> {
  if (binIds.length === 0) return;
  await db.transaction('rw', db.bins, db.items, async () => {
    for (const id of binIds) {
      const bin = await db.bins.get(id);
      if (!bin) continue;
      const items = await db.items.where('binId').equals(id).toArray();
      await db.bins.put({ ...bin, labelPrintedAt: now, labelContents: binSummary(items, id) });
    }
  });
}
