// Selecting items on the Inventory list and moving them in bulk (F28). Pure, so it is unit-tested;
// the data layer (moveItemsTo) saves the move in one transaction.
import { placeLabel, type CategoryPlace } from './lists';
import { nameKey, type Item } from './types';

export type SelectState = 'on' | 'some' | 'off';

/** A group checkbox: all of its shown items selected, some, or none. An empty group is 'off'. */
export function selectState(ids: readonly string[], selected: ReadonlySet<string>): SelectState {
  const n = ids.filter((id) => selected.has(id)).length;
  return n === 0 ? 'off' : n === ids.length ? 'on' : 'some';
}

/** Adds (on) or removes (off) the ids. Tapping a group that is all selected clears it; otherwise it selects all of it. */
export function withIds(selected: ReadonlySet<string>, ids: readonly string[], on: boolean): Set<string> {
  const next = new Set(selected);
  for (const id of ids) on ? next.add(id) : next.delete(id);
  return next;
}

/** Drops ids of items that no longer exist (deleted while selecting). */
export function keepExisting(selected: ReadonlySet<string>, items: readonly Item[]): Set<string> {
  const known = new Set(items.map((i) => i.id));
  return new Set([...selected].filter((id) => known.has(id)));
}

export interface MoveFrom {
  place: CategoryPlace;
  count: number;
}

export interface MoveSummary {
  /** Items chosen. */
  count: number;
  /** Of those, already in the destination (they stay as they are). */
  staying: number;
  /** Where the others come from, in the order first met. */
  from: MoveFrom[];
}

/** What the confirmation says ("Move 12 items to Fasteners › Bolts?", F28). Names match ignoring capitals (§3). */
export function moveSummary(chosen: readonly Item[], to: CategoryPlace): MoveSummary {
  const from = new Map<string, MoveFrom>();
  let staying = 0;
  for (const i of chosen) {
    if (nameKey(i.category) === nameKey(to.category) && nameKey(i.subcategory) === nameKey(to.subcategory)) {
      staying++;
      continue;
    }
    const key = JSON.stringify([nameKey(i.category), nameKey(i.subcategory)]);
    const f = from.get(key);
    if (f) f.count++;
    else from.set(key, { place: { category: i.category, subcategory: i.subcategory }, count: 1 });
  }
  return { count: chosen.length, staying, from: [...from.values()] };
}

/** "Mechanical › Structure (5), Fasteners (2)" — the first `max` places, then "and n more". */
export function fromText(from: readonly MoveFrom[], max = 3): string {
  const shown = from.slice(0, max).map((f) => `${placeLabel(f.place)} (${f.count})`);
  const more = from.length - shown.length;
  return more > 0 ? `${shown.join(', ')} and ${more} more` : shown.join(', ');
}
