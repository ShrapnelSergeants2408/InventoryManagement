// A whole household's data checked as one (restore, first setup): every record valid, every
// link pointing at a record that exists in the same part, and names and codes unique where §3
// says so: names within a part, area codes and bin codes across both parts.
import { binCodeKey } from './places';
import { isPart } from './validate';
import { PART_NAME, nameKey, type Part, type Area, type Bin, type Category, type Display, type Item, type PhotoInfo, type Season, type SeasonRun, type SeasonTask, type Spot, type Tag } from './types';
import { validateArea, validateBin, validateDisplay, validateItem, validateSeason, validateSeasonRun, validateSeasonTask, validateSpot, type FieldError } from './validate';

export interface HouseholdData {
  items: Item[];
  areas: Area[];
  spots: Spot[];
  bins: Bin[];
  seasons: Season[];
  tags: Tag[];
  categories: Category[];
  /** Holiday only (H4): displays, season tasks and season runs. */
  displays: Display[];
  seasonTasks: SeasonTask[];
  seasonRuns: SeasonRun[];
  /** Photo records; the images travel separately. */
  photos: PhotoInfo[];
}

export const emptyData = (): HouseholdData => ({ items: [], areas: [], spots: [], bins: [], seasons: [], tags: [], categories: [], displays: [], seasonTasks: [], seasonRuns: [], photos: [] });

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
  for (const x of d.displays) fieldErrors(`display ${x.id}`, validateDisplay(x), out);
  for (const t of d.seasonTasks) fieldErrors(`season task ${t.id}`, validateSeasonTask(t), out);
  for (const r of d.seasonRuns) fieldErrors(`season run ${r.id}`, validateSeasonRun(r), out);

  const ids = [...d.areas, ...d.spots, ...d.bins, ...d.seasons, ...d.items, ...d.displays, ...d.seasonTasks, ...d.seasonRuns, ...d.photos].map((r) => r.id);
  dupes(ids, (x) => x.toLowerCase(), (x) => `id ${x} is used more than once`, out);
  dupes(d.areas, (a) => `${a.part}\n${nameKey(a.name)}`, (a, f) => `area "${a.name}" is listed twice in ${partName(a.part)} (also "${f.name}")`, out);
  dupes(d.areas, (a) => a.code, (a, f) => `areas "${f.name}" and "${a.name}" both use the code ${a.code}`, out);
  dupes(d.spots, (s) => `${s.areaId}\n${nameKey(s.name)}`, (s) => `spot "${s.name}" is listed twice in its area`, out);
  dupes(d.bins, (b) => binCodeKey(b.code), (b, f) => `bin code ${b.code} is used by two bins ("${f.name}" and "${b.name}")`, out);
  dupes(d.seasons, (s) => nameKey(s.name), (s) => `season "${s.name}" is listed twice`, out);
  dupes(d.displays, (x) => nameKey(x.name), (x) => `display "${x.name}" is listed twice`, out);
  dupes(d.seasonRuns, (r) => `${r.seasonId}\n${r.year}`, (r) => `season ${r.seasonId} has two runs for ${r.year}`, out);
  for (const r of [...d.tags, ...d.categories]) if (!isPart(r.part)) out.push(`list entry "${r.name}" has part "${String(r.part)}"`);
  dupes(d.tags, (t) => `${t.part}\n${nameKey(t.name)}`, (t) => `tag "${t.name}" is listed twice in ${partName(t.part)}`, out);
  dupes(d.categories, (c) => `${c.part}\n${nameKey(c.name)}`, (c) => `category "${c.name}" is listed twice in ${partName(c.part)}`, out);

  // Every link points at a record that's there, in the same part (§3: nothing links across parts).
  const areaPart = new Map(d.areas.map((a) => [a.id, a.part]));
  const spotPart = new Map(d.spots.map((s) => [s.id, areaPart.get(s.areaId)]));
  const binPart = new Map(d.bins.map((b) => [b.id, b.part]));
  const seasons = new Set(d.seasons.map((s) => s.id));
  const items = new Set(d.items.map((i) => i.id));
  const displays = new Set(d.displays.map((x) => x.id));
  const cats = new Set(d.categories.map((c) => `${c.part}\n${nameKey(c.name)}`));
  const across = (what: string, part: Part, home: Part | undefined) => `${what} is in ${partName(part)}, but its home is in ${partName(home)}`;
  for (const s of d.spots) if (!areaPart.has(s.areaId)) out.push(`spot "${s.name}" is in area ${s.areaId}, which isn't there`);
  for (const b of d.bins) {
    if (b.spotId && !spotPart.has(b.spotId)) out.push(`bin ${b.code} is on spot ${b.spotId}, which isn't there`);
    else if (b.spotId && spotPart.get(b.spotId) !== b.part) out.push(across(`bin ${b.code}`, b.part, spotPart.get(b.spotId)));
    if (b.seasonId && !seasons.has(b.seasonId)) out.push(`bin ${b.code} has season ${b.seasonId}, which isn't there`);
  }
  for (const i of d.items) {
    if (i.binId && !binPart.has(i.binId)) out.push(`item "${i.name}" is in bin ${i.binId}, which isn't there`);
    else if (i.binId && binPart.get(i.binId) !== i.part) out.push(across(`item "${i.name}"`, i.part, binPart.get(i.binId)));
    if (i.spotId && !spotPart.has(i.spotId)) out.push(`item "${i.name}" is on spot ${i.spotId}, which isn't there`);
    else if (i.spotId && spotPart.get(i.spotId) !== i.part) out.push(across(`item "${i.name}"`, i.part, spotPart.get(i.spotId)));
    if (i.seasonId && !seasons.has(i.seasonId)) out.push(`item "${i.name}" has season ${i.seasonId}, which isn't there`);
    if (!cats.has(`${i.part}\n${nameKey(i.category)}`)) out.push(`item "${i.name}" has category "${i.category}", which isn't in the ${partName(i.part)} category list`);
    if (i.displayId && !displays.has(i.displayId)) out.push(`item "${i.name}" usually goes on display ${i.displayId}, which isn't there`);
    if (i.outDisplayId && !displays.has(i.outDisplayId)) out.push(`item "${i.name}" is out on display ${i.outDisplayId}, which isn't there`);
  }
  const tasks = new Map(d.seasonTasks.map((t) => [t.id, t]));
  for (const t of d.seasonTasks) if (!seasons.has(t.seasonId)) out.push(`season task "${t.text}" is for season ${t.seasonId}, which isn't there`);
  for (const r of d.seasonRuns) {
    if (!seasons.has(r.seasonId)) out.push(`season run ${r.id} is for season ${r.seasonId}, which isn't there`);
    for (const t of r.doneTaskIds) if (tasks.get(t)?.seasonId !== r.seasonId) out.push(`season run ${r.id} ticks task ${t}, which isn't one of its season's tasks`);
  }
  const spots = new Set(spotPart.keys());
  const bins = new Set(binPart.keys());
  const owners: Record<PhotoInfo['ownerType'], Set<string>> = { item: items, bin: bins, spot: spots, season: seasons, display: displays };
  for (const p of d.photos) {
    const set = owners[p.ownerType];
    if (!set) out.push(`photo ${p.id} has owner type "${p.ownerType}"`);
    else if (!set.has(p.ownerId)) out.push(`photo ${p.id} belongs to ${p.ownerType} ${p.ownerId}, which isn't there`);
    if (p.seasonId && !seasons.has(p.seasonId)) out.push(`photo ${p.id} is tagged with season ${p.seasonId}, which isn't there`);
  }
  return out;
}

/** Tags the records use that their part's Tags list doesn't have, in first-appearance order (order 0). */
export function unlistedTags(d: Pick<HouseholdData, 'items' | 'bins' | 'tags'>): Tag[] {
  const key = (part: Part, name: string) => `${part}\n${nameKey(name)}`;
  const known = new Set(d.tags.map((t) => key(t.part, t.name)));
  const out: Tag[] = [];
  for (const r of [...d.bins, ...d.items]) {
    for (const t of r.tags) {
      if (known.has(key(r.part, t))) continue;
      known.add(key(r.part, t));
      out.push({ part: r.part, name: t, order: 0 });
    }
  }
  return out;
}

const partName = (p: Part | undefined) => (p && isPart(p) ? PART_NAME[p] : 'no part');
