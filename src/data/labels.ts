// Per-layout alignment nudge (SPEC §9), kept with the device settings: never in a backup,
// and not an inventory change.
import { cleanNudge, type Nudge } from '../domain/labels';
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
