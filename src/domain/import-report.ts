// The count report and spot-check list for an import (§18.5, v0.20): before → after for every
// item the import changed, and the ones worth a recount. Pure; the undo record holds the numbers.
import type { CountFields } from './import-counts';

/** An item is "a big change" at this share of its old count AND this many units. */
export const BIG_PERCENT = 50;
export const BIG_UNITS = 5;

export type SpotFlag = 'zero' | 'big' | 'outside';

export const FLAG_LABEL: Record<SpotFlag, string> = {
  zero: 'Counted zero (there was stock)',
  big: 'Big change',
  outside: 'Outside the helper’s groups',
};

export interface ReportRow {
  itemId: string;
  before: CountFields;
  after: CountFields;
  flags: SpotFlag[];
}

/** Flags for one item: zero where there was stock, a big change in the count, or counted outside the helper's groups. */
export function spotFlags(before: number, after: number, outside: boolean): SpotFlag[] {
  const flags: SpotFlag[] = [];
  if (before > 0 && after === 0) flags.push('zero');
  const diff = Math.abs(after - before);
  // Starting from none, any count of 5 or more is a big change; otherwise half the old count and 5 units.
  if (after !== 0 && diff >= BIG_UNITS && diff * 100 >= before * BIG_PERCENT) flags.push('big');
  if (outside) flags.push('outside');
  return flags;
}

/** One row per item the import changed, in item id order. */
export function reportRows(before: ReadonlyArray<readonly [string, CountFields]>, after: ReadonlyArray<readonly [string, CountFields]>, outside: readonly string[]): ReportRow[] {
  const was = new Map(before);
  const out = new Set(outside);
  const rows: ReportRow[] = [];
  for (const [itemId, now] of after) {
    const b = was.get(itemId);
    if (!b) continue;
    rows.push({ itemId, before: b, after: now, flags: spotFlags(b.onHand, now.onHand, out.has(itemId)) });
  }
  return rows.sort((a, b) => a.itemId.localeCompare(b.itemId, 'en-US', { numeric: true }));
}

/** The rows worth a recount. */
export const spotCheck = (rows: readonly ReportRow[]): ReportRow[] => rows.filter((r) => r.flags.length > 0);
