// A whole household's data checked as one (restore, first setup): every record valid, every
// link pointing at a record that exists, and names and codes unique where §3 says so.
import { binCodeKey } from './places';
import { nameKey, type Area, type Bin, type Category, type Item, type PhotoInfo, type Season, type Spot, type Tag } from './types';
import { validateArea, validateBin, validateItem, validateSeason, validateSpot, type FieldError } from './validate';

export interface HouseholdData {
  items: Item[];
  areas: Area[];
  spots: Spot[];
  bins: Bin[];
  seasons: Season[];
  tags: Tag[];
  categories: Category[];
  /** Photo records; the images travel separately. */
  photos: PhotoInfo[];
}

export const emptyData = (): HouseholdData => ({ items: [], areas: [], spots: [], bins: [], seasons: [], tags: [], categories: [], photos: [] });

function dupes<T>(list: readonly T[], key: (x: T) => string, say: (x: T, first: T) => string, out: string[]): void {
  const seen = new Map<string, T>();
  for (const x of list) {
    const k = key(x);
    const first = seen.get(k);
    if (first !== undefined) out.push(say(x, first));
    else seen.set(k, x);
  }
}

const fieldErrors = (what: string, errors: FieldError[], out: string[]) => {
  for (const e of errors) out.push(`${what}: ${e.message}`);
};

/** Every problem found; an empty list means the data can be stored. */
export function checkData(d: HouseholdData): string[] {
  const out: string[] = [];
  for (const a of d.areas) fieldErrors(`area ${a.id}`, validateArea(a), out);
  for (const s of d.spots) fieldErrors(`spot ${s.id}`, validateSpot(s), out);
  for (const b of d.bins) fieldErrors(`bin ${b.id}`, validateBin(b), out);
  for (const s of d.seasons) fieldErrors(`season ${s.id}`, validateSeason(s), out);
  for (const i of d.items) fieldErrors(`item ${i.id}`, validateItem(i), out);

  const ids = [...d.areas, ...d.spots, ...d.bins, ...d.seasons, ...d.items, ...d.photos].map((r) => r.id);
  dupes(ids, (x) => x.toLowerCase(), (x) => `id ${x} is used more than once`, out);
  dupes(d.areas, (a) => nameKey(a.name), (a, f) => `area "${a.name}" is listed twice (also "${f.name}")`, out);
  dupes(d.areas, (a) => a.letter, (a, f) => `areas "${f.name}" and "${a.name}" both use the letter ${a.letter}`, out);
  dupes(d.spots, (s) => `${s.areaId}\n${nameKey(s.name)}`, (s) => `spot "${s.name}" is listed twice in its area`, out);
  dupes(d.bins, (b) => binCodeKey(b.code), (b, f) => `bin code ${b.code} is used by two bins ("${f.name}" and "${b.name}")`, out);
  dupes(d.seasons, (s) => nameKey(s.name), (s) => `season "${s.name}" is listed twice`, out);
  dupes(d.tags, (t) => nameKey(t.name), (t) => `tag "${t.name}" is listed twice`, out);
  dupes(d.categories, (c) => nameKey(c.name), (c) => `category "${c.name}" is listed twice`, out);

  const areas = new Set(d.areas.map((a) => a.id));
  const spots = new Set(d.spots.map((s) => s.id));
  const bins = new Set(d.bins.map((b) => b.id));
  const seasons = new Set(d.seasons.map((s) => s.id));
  const items = new Set(d.items.map((i) => i.id));
  const cats = new Set(d.categories.map((c) => nameKey(c.name)));
  for (const s of d.spots) if (!areas.has(s.areaId)) out.push(`spot "${s.name}" is in area ${s.areaId}, which isn't there`);
  for (const b of d.bins) {
    if (b.spotId && !spots.has(b.spotId)) out.push(`bin ${b.code} is on spot ${b.spotId}, which isn't there`);
    if (b.seasonId && !seasons.has(b.seasonId)) out.push(`bin ${b.code} has season ${b.seasonId}, which isn't there`);
  }
  for (const i of d.items) {
    if (i.binId && !bins.has(i.binId)) out.push(`item "${i.name}" is in bin ${i.binId}, which isn't there`);
    if (i.spotId && !spots.has(i.spotId)) out.push(`item "${i.name}" is on spot ${i.spotId}, which isn't there`);
    if (i.seasonId && !seasons.has(i.seasonId)) out.push(`item "${i.name}" has season ${i.seasonId}, which isn't there`);
    if (!cats.has(nameKey(i.category))) out.push(`item "${i.name}" has category "${i.category}", which isn't in the category list`);
  }
  const owners: Record<PhotoInfo['ownerType'], Set<string>> = { item: items, bin: bins, spot: spots, season: seasons };
  for (const p of d.photos) {
    const set = owners[p.ownerType];
    if (!set) out.push(`photo ${p.id} has owner type "${p.ownerType}"`);
    else if (!set.has(p.ownerId)) out.push(`photo ${p.id} belongs to ${p.ownerType} ${p.ownerId}, which isn't there`);
  }
  return out;
}

/** Tag names the records use that the Tags list doesn't have, in first-appearance order. */
export function unlistedTags(d: Pick<HouseholdData, 'items' | 'bins' | 'tags'>): string[] {
  const known = new Set(d.tags.map((t) => nameKey(t.name)));
  const out: string[] = [];
  for (const r of [...d.bins, ...d.items]) {
    for (const t of r.tags) {
      if (known.has(nameKey(t))) continue;
      known.add(nameKey(t));
      out.push(t);
    }
  }
  return out;
}
