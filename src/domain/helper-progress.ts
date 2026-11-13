// How far each helper has got (§18.1, v0.20): of the items in the helper's groups, how many
// were counted by that helper after its last kit was made, as imported on this tablet. Pure.
import { inAssignment } from './helper-mode';
import { lastKit, type Helper } from './helpers';
import { stampMs } from './import-counts';
import { nameKey, type Item } from './types';

export interface HelperProgress {
  /** Items in the helper's groups. */
  total: number;
  /** Of those, counted by this helper since its last kit. */
  counted: number;
}

/** null: no kit has been sent, so there is nothing to count against. */
export function helperProgress(h: Helper, items: readonly Pick<Item, 'category' | 'location' | 'lastCounted' | 'countedBy'>[]): HelperProgress | null {
  const kit = lastKit(h);
  if (!kit) return null;
  const since = stampMs(kit.createdAt);
  const mine = nameKey(h.name);
  let total = 0;
  let counted = 0;
  for (const i of items) {
    if (!inAssignment(i, h)) continue;
    total++;
    if (i.countedBy !== '' && nameKey(i.countedBy) === mine && !Number.isNaN(stampMs(i.lastCounted)) && stampMs(i.lastCounted) >= since) counted++;
  }
  return { total, counted };
}
