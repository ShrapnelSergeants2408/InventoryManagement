// The two parts, Household and Holiday (SPEC v3.0 §3 "Parts", F21): which part a record is in,
// one part's view of the data, moving an item or bin to the other part, and reading 0.1.2
// (schema v2) data, which had no parts. Pure, so it is unit-tested.
import { ID_PREFIX, newId } from './ids';
import { DEFAULT_SEASONS } from './places';
import { defaultDates } from './seasons';
import { nameKey, type Area, type Bin, type Category, type Item, type Part, type Season, type Spot, type Tag } from './types';

/** Default categories for each part (§3, Category). */
export const DEFAULT_CATEGORIES: Readonly<Record<Part, readonly string[]>> = {
  household: ['Tools', 'Hardware', 'Yard & garden', 'Sports & outdoors', 'Seasonal clothing', 'Kitchen', 'Pantry', 'Cleaning & laundry', 'Electronics', 'Documents & keepsakes', 'Other'],
  holiday: ['Ornaments', 'Lights', 'Wreaths & garland', 'Trees', 'Inflatables & yard', 'Village & figurines', 'Tableware & linens', 'Wrapping & cards', 'Costumes', 'Other'],
};

/** Where an item's category goes when nothing in the new part matches (§3, "Moving to the other part"). */
export const FALLBACK_CATEGORY = 'Other';

/** Area names offered while a part's suggestions are unused (§12.5). */
export const SUGGESTED_AREAS: Readonly<Record<Part, readonly string[]>> = {
  household: ['Garage', 'Utility room', 'Attic', 'Basement', 'Kitchen', 'Pantry', 'Laundry'],
  holiday: ['Storage room', 'Attic', 'Basement', 'Crawl space', 'Shed', 'Closet'],
};

export const defaultCategoryList = (part: Part): Category[] => DEFAULT_CATEGORIES[part].map((name, order) => ({ part, name, order, subcategories: [] }));

/** The default seasons (§3), with their colors and dates and fresh ids. */
export function defaultSeasons(random: () => number = Math.random, taken: Set<string> = new Set()): Season[] {
  return DEFAULT_SEASONS.map((s, order) => {
    const id = newId(ID_PREFIX.season, (x) => taken.has(x), random);
    taken.add(id);
    return { id, name: s.name, color: s.color, order, ...defaultDates(s.name), setupNotes: '' };
  });
}

/** The records a part's view is made of. */
export interface PartRecords {
  items: readonly Item[];
  areas: readonly Area[];
  spots: readonly Spot[];
  bins: readonly Bin[];
  seasons: readonly Season[];
  tags: readonly Tag[];
  categories: readonly Category[];
}

/** The part a spot is in: its area's. Null when the area is missing. */
export function spotPart(spot: Pick<Spot, 'areaId'>, areas: ReadonlyMap<string, Pick<Area, 'part'>>): Part | null {
  return areas.get(spot.areaId)?.part ?? null;
}

/**
 * One part's records (F21): its areas and their spots, its bins, items, categories and tags, and
 * the seasons in Holiday (none in Household). Order is kept.
 */
export function partView<T extends PartRecords>(d: T, part: Part): T {
  const areas = d.areas.filter((a) => a.part === part);
  const areaIds = new Set(areas.map((a) => a.id));
  return {
    ...d,
    items: d.items.filter((i) => i.part === part),
    areas,
    spots: d.spots.filter((s) => areaIds.has(s.areaId)),
    bins: d.bins.filter((b) => b.part === part),
    seasons: part === 'holiday' ? d.seasons : [],
    tags: d.tags.filter((t) => t.part === part),
    categories: d.categories.filter((c) => c.part === part),
  };
}

/** The part of any record id in the data: item, bin, spot or area. Null when it isn't there. */
export function partOfRecord(d: Pick<PartRecords, 'items' | 'bins' | 'spots' | 'areas'>, id: string): Part | null {
  const areas = new Map(d.areas.map((a) => [a.id, a]));
  const item = d.items.find((i) => i.id === id);
  if (item) return item.part;
  const bin = d.bins.find((b) => b.id === id);
  if (bin) return bin.part;
  const spot = d.spots.find((s) => s.id === id);
  if (spot) return spotPart(spot, areas);
  return areas.get(id)?.part ?? null;
}

/**
 * An item moved to the other part (§3): its season, displays, check date and tags are cleared
 * when it leaves Holiday (tags are per part, so they're cleared either way), and its category is
 * matched by name in the new part's list, else "Other" (its subcategory is kept only when the
 * matched category has it).
 */
export function itemToPart(item: Item, part: Part, categories: readonly Category[]): Item {
  if (item.part === part) return item;
  const list = categories.filter((c) => c.part === part);
  const cat = list.find((c) => nameKey(c.name) === nameKey(item.category)) ?? list.find((c) => nameKey(c.name) === nameKey(FALLBACK_CATEGORY));
  const category = cat?.name ?? FALLBACK_CATEGORY;
  const subcategory = (cat && item.subcategory && cat.subcategories.find((s) => nameKey(s) === nameKey(item.subcategory))) || '';
  return { ...item, part, category, subcategory, seasonId: '', displayId: '', outDisplayId: '', checkedAt: null, tags: [] };
}

/** A bin moved to the other part: its season and tags are cleared (§3). */
export function binToPart(bin: Bin, part: Part): Bin {
  return bin.part === part ? bin : { ...bin, part, seasonId: '', tags: [] };
}

// ── Reading 0.1.2 data (schema v2: one part) ──

type V2<T, Added extends keyof T> = Omit<T, Added> & Partial<Pick<T, Added>>;

/** Records as 0.1.2 stored or backed them up: no parts, no season dates, fewer item fields. */
export interface V2Data {
  items: V2<Item, 'part' | 'displayId' | 'outDisplayId' | 'checkedAt'>[];
  areas: V2<Area, 'part'>[];
  spots: Spot[];
  bins: V2<Bin, 'part'>[];
  seasons: V2<Season, 'setupFrom' | 'takedownBy'>[];
  tags: V2<Tag, 'part'>[];
  categories: V2<Category, 'part'>[];
}

/** 0.1.2 data with its records in the two-part model; anything else in `D` is kept. */
export type FromV2<D> = Omit<D, keyof V2Data> & { items: Item[]; areas: Area[]; spots: Spot[]; bins: Bin[]; seasons: Season[]; tags: Tag[]; categories: Category[] };

/**
 * 0.1.2 data in the two-part model (§3, "Upgrading a 0.1.2 phone"), shared by the phone's
 * upgrade and restoring a 0.1.2 backup: every area, category, tag, bin and item goes to
 * Household; the seasons are kept (in Holiday) with their default dates, and the household items
 * and bins lose their season; Holiday starts with its default categories and no areas.
 */
export function fromV2<D extends V2Data>(d: D): FromV2<D> {
  const household: Part = 'household';
  const categories: Category[] = [...d.categories].sort((a, b) => a.order - b.order).map((c, order) => ({ ...c, part: household, order }));
  return {
    ...d,
    areas: d.areas.map((a) => ({ ...a, part: household })),
    spots: [...d.spots],
    bins: d.bins.map((b) => ({ ...b, part: household, seasonId: '' })),
    items: d.items.map((i) => ({ ...i, part: household, seasonId: '', displayId: '', outDisplayId: '', checkedAt: null })),
    seasons: d.seasons.map((s) => {
      const dates = defaultDates(s.name);
      return { ...s, setupFrom: s.setupFrom ?? dates.setupFrom, takedownBy: s.takedownBy ?? dates.takedownBy };
    }),
    tags: d.tags.map((t) => ({ ...t, part: household })),
    categories: [...categories, ...defaultCategoryList('holiday')],
  };
}
