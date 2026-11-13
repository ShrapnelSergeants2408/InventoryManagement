// Cycle counts (§19, v0.20): an item is due for a recount when it was counted, but longer ago than
// the Recount after setting. An item never counted isn't "due": it shows NOT COUNTED already (F2).
import { countedDate } from './dates';
import { daysBetween } from './stale';
import type { Item } from './types';

/** Due when last counted more than `days` days before `today` (90 → day 91 is due). */
export function isDue(item: Pick<Item, 'lastCounted'>, today: string, days: number): boolean {
  const day = countedDate(item.lastCounted);
  return day !== '' && daysBetween(day, today) > days;
}

export const dueCount = (items: readonly Pick<Item, 'lastCounted'>[], today: string, days: number): number => items.filter((i) => isDue(i, today, days)).length;
