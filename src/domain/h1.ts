// H1 (0.1.1) data in the household model (SPEC "Upgrading an H1 phone"), shared by the
// in-place database upgrade and restoring an H1 backup. Pure.
import { ID_PREFIX, newId } from './ids';
import { DEFAULT_SEASONS } from './places';
import { defaultDates } from './seasons';
import { blankItem, nameKey, type Area, type Item, type Season, type Spot } from './types';

/** The area H1 locations move into on upgrade or when an H1 backup is restored (Dan, 2026-11-02). */
export const UNSORTED_AREA = { name: 'Unsorted', code: 'UNSORTED' } as const;

/** The fields an H1 item had. */
export interface H1ItemFields {
  id: string;
  name: string;
  category: string;
  subcategory: string;
  quantity: number;
  barcode: string;
  notes: string;
  hasPhoto: boolean;
}

/** Converts H1 records the way an H1 backup is converted on restore (SPEC "Upgrading an H1 phone"). */
export function convertH1(
  locations: readonly { name: string; notes: string; order: number }[],
  random: () => number = Math.random,
): { area: Area | null; spots: Spot[]; spotIdFor: (location: string) => string; seasons: Season[] } {
  const taken = new Set<string>();
  const id = (prefix: string) => {
    const v = newId(prefix, (x) => taken.has(x), random);
    taken.add(v);
    return v;
  };
  const sorted = [...locations].sort((a, b) => a.order - b.order);
  const area: Area | null = sorted.length === 0 ? null : { id: id(ID_PREFIX.area), part: 'household', name: UNSORTED_AREA.name, code: UNSORTED_AREA.code, order: 0, notes: 'Moved here from the old location list. Move each spot to its real area.' };
  const spots: Spot[] = area ? sorted.map((l, order) => ({ id: id(ID_PREFIX.spot), areaId: area.id, name: l.name.trim(), order, notes: l.notes })) : [];
  const byKey = new Map(spots.map((s) => [nameKey(s.name), s.id]));
  const seasons: Season[] = DEFAULT_SEASONS.map((s, order) => ({ id: id(ID_PREFIX.season), name: s.name, color: s.color, order, ...defaultDates(s.name), setupNotes: '' }));
  return { area, spots, spotIdFor: (location) => (location.trim() === '' ? '' : (byKey.get(nameKey(location)) ?? '')), seasons };
}

/** An H1 item with its location turned into a spot, and every new field at its default. */
export function itemFromH1(old: H1ItemFields, spotId: string): Item {
  return {
    ...blankItem(old.id, old.name, old.category),
    subcategory: old.subcategory,
    spotId,
    quantity: old.quantity,
    barcode: old.barcode,
    notes: old.notes,
    hasPhoto: old.hasPhoto,
  };
}
