// The two parts, Household and Holiday (SPEC v3.0 §3 "Parts", F21): which part a record is in,
// one part's view of the data, moving an item or bin to the other part, and reading 0.1.2
// (schema v2) data, which had no parts. Pure, so it is unit-tested.
import { ID_PREFIX, newId } from './ids';
import { DEFAULT_SEASONS, defaultAreaCode, splitBinCode } from './places';
import { defaultDates } from './seasons';
import { nameKey, type Area, type Bin, type Category, type Display, type Item, type Part, type Season, type SeasonRun, type SeasonTask, type Spot, type Tag } from './types';

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
  /** Holiday's setup records (H4); a view keeps them in Holiday and empties them in Household. */
  displays?: readonly Display[];
  seasonTasks?: readonly SeasonTask[];
  seasonRuns?: readonly SeasonRun[];
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
    ...(d.displays && { displays: part === 'holiday' ? d.displays : [] }),
    ...(d.seasonTasks && { seasonTasks: part === 'holiday' ? d.seasonTasks : [] }),
    ...(d.seasonRuns && { seasonRuns: part === 'holiday' ? d.seasonRuns : [] }),
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
  /** 0.1.2 areas had a one-letter `letter` where 0.1.3 has `code`. */
  areas: (Omit<Area, 'part' | 'code'> & { letter: string })[];
  spots: Spot[];
  bins: V2<Bin, 'part'>[];
  seasons: V2<Season, 'setupFrom' | 'takedownBy'>[];
  tags: V2<Tag, 'part'>[];
  categories: V2<Category, 'part'>[];
}

/**
 * Area letters become codes from the area names (Dan, 2026-11-03): Attic's A → ATTIC, unique across
 * both parts, chosen in walk order (Household first). Bins with a letter's code are renamed to
 * match (A-04 → ATTIC-04); a renamed bin's printed label shows the old code, so it counts as not
 * printed yet. Used for 0.1.2 data and for the first 0.1.3 build, which still had letters.
 * Areas keep their input order.
 */
export function lettersToCodes<A extends { id: string; name: string; order: number; part: Part; letter: string }, B extends { code: string; labelPrintedAt: number | null; labelContents: string | null }>(
  areas: readonly A[],
  bins: readonly B[],
): { areas: (Omit<A, 'letter'> & { code: string })[]; bins: B[] } {
  const taken: string[] = [];
  const codeOf = new Map<string, string>();
  const byId = new Map<string, string>();
  const walk = [...areas].sort((a, b) => (a.part === b.part ? a.order - b.order : a.part === 'household' ? -1 : 1));
  for (const a of walk) {
    const code = defaultAreaCode(a.name, taken) ?? a.letter;
    taken.push(code);
    codeOf.set(a.letter, code);
    byId.set(a.id, code);
  }
  return {
    areas: areas.map(({ letter: _l, ...a }) => ({ ...a, code: byId.get(a.id)! })),
    bins: bins.map((b) => {
      const p = splitBinCode(b.code);
      const code = p && codeOf.get(p.area);
      return code ? { ...b, code: `${code}-${String(p!.number).padStart(2, '0')}`, labelPrintedAt: null, labelContents: null } : b;
    }),
  };
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
  const coded = lettersToCodes(
    d.areas.map((a) => ({ ...a, part: household })),
    d.bins,
  );
  return {
    ...d,
    areas: coded.areas,
    spots: [...d.spots],
    bins: coded.bins.map((b) => ({ ...b, part: household, seasonId: '' })),
    items: d.items.map((i) => ({ ...i, part: household, seasonId: '', displayId: '', outDisplayId: '', checkedAt: null })),
    seasons: d.seasons.map((s) => {
      const dates = defaultDates(s.name);
      return { ...s, setupFrom: s.setupFrom ?? dates.setupFrom, takedownBy: s.takedownBy ?? dates.takedownBy };
    }),
    tags: d.tags.map((t) => ({ ...t, part: household })),
    categories: [...categories, ...defaultCategoryList('holiday')],
  };
}
