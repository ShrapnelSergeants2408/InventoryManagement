// The Holiday setup (SPEC v3.0 §3 Season run, §4 "A season's run", F25, F5): which year's run a
// season is on, and its setup list — the season's bins to bring out, its items by display, and
// its setup tasks — with progress. Pure, so it is unit-tested.
import { binLabel, indexPlaces, itemSeasonId, type PlaceIndex, type Places } from './places';
import { nextWindow, windowNow, windowStarting, type Window } from './seasons';
import type { Bin, Display, Item, RunPhase, Season, SeasonRun, SeasonTask } from './types';

/** Phases in which a run is underway (§4): the season counts as on now whatever the date. */
export const UNDERWAY: readonly RunPhase[] = ['setting up', 'up', 'taking down'];
export const isUnderway = (r: Pick<SeasonRun, 'phase'> | null | undefined) => !!r && UNDERWAY.includes(r.phase);

/** A run's dates: its own for this year, else the season's. */
export function runDates(season: Pick<Season, 'setupFrom' | 'takedownBy'>, run: Pick<SeasonRun, 'setupFrom' | 'takedownBy'> | null): Pick<Season, 'setupFrom' | 'takedownBy'> {
  return { setupFrom: run?.setupFrom || season.setupFrom, takedownBy: run?.takedownBy || season.takedownBy };
}

/** The run's window (its year, its dates), or null when the season has no dates. */
export const runWindow = (season: Season, run: SeasonRun): Window | null => windowStarting(runDates(season, run), run.year);

/**
 * A run still marked underway is stale once the season's next window (the one starting the year
 * after the run's) has begun: it was never taken down, and the new year gets its own run. A season
 * without dates never goes stale.
 */
export function isStale(season: Pick<Season, 'setupFrom' | 'takedownBy'>, run: Pick<SeasonRun, 'year'>, today: Date): boolean {
  const next = windowStarting(season, run.year + 1);
  return next !== null && next.start <= today;
}

/** A season's runs, newest first. */
export const runsOf = (runs: readonly SeasonRun[], seasonId: string) => runs.filter((r) => r.seasonId === seasonId).sort((a, b) => b.year - a.year);

/**
 * The year a season's run is for, today (§3: the year its setup starts): an underway run's year,
 * else the window containing today, else the next window, else this year.
 */
export function runYear(season: Season, runs: readonly SeasonRun[], today: Date): number {
  const underway = runsOf(runs, season.id).find((r) => isUnderway(r) && !isStale(season, r, today));
  if (underway) return underway.year;
  const w = windowNow(season, today) ?? nextWindow(season, today);
  return w ? w.start.getFullYear() : today.getFullYear();
}

/** The season's run for the year it's on (`runYear`), or null before Start setup. */
export function currentRun(season: Season, runs: readonly SeasonRun[], today: Date): SeasonRun | null {
  const year = runYear(season, runs, today);
  return runs.find((r) => r.seasonId === season.id && r.year === year) ?? null;
}

export interface Count {
  done: number;
  total: number;
}

export interface SetupBin {
  bin: Bin;
  /** "Storage room › Rack 1", or "No spot". */
  where: string;
  done: boolean;
}

export interface SetupItem {
  item: Item;
  /** Its home: "ATTIC-04 Christmas 4", a spot's name, or "No home yet". */
  home: string;
  done: boolean;
}

export interface SetupGroup {
  /** null: "No display". */
  display: Display | null;
  items: SetupItem[];
  count: Count;
}

export interface SetupList {
  bins: SetupBin[];
  /** Displays in walk order, each with the season's items that usually go there; "No display" last. Empty groups are left out. */
  groups: SetupGroup[];
  tasks: { task: SeasonTask; done: boolean }[];
  count: { bins: Count; items: Count; tasks: Count; all: Count };
}

export interface HolidayRecords extends Places {
  items: readonly Item[];
  displays: readonly Display[];
  seasonTasks: readonly SeasonTask[];
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'en-US', { sensitivity: 'base' });
const count = (list: readonly { done: boolean }[]): Count => ({ done: list.filter((x) => x.done).length, total: list.length });

/** Bins in walk order (§4): area, then spot, then code; bins with no spot last. */
export function binsByPlace(bins: readonly Bin[], ix: PlaceIndex): Bin[] {
  const key = (b: Bin): [number, number] => {
    const spot = b.spotId ? ix.spot.get(b.spotId) : undefined;
    const area = spot ? ix.area.get(spot.areaId) : undefined;
    return [area ? area.order : Number.MAX_SAFE_INTEGER, spot ? spot.order : Number.MAX_SAFE_INTEGER];
  };
  return [...bins].sort((a, b) => {
    const [aa, as] = key(a);
    const [ba, bs] = key(b);
    return aa - ba || as - bs || a.code.localeCompare(b.code, 'en-US', { numeric: true });
  });
}

export function placeText(bin: Bin, ix: PlaceIndex): string {
  const spot = bin.spotId ? ix.spot.get(bin.spotId) : undefined;
  const area = spot ? ix.area.get(spot.areaId) : undefined;
  return spot && area ? `${area.name} › ${spot.name}` : 'No spot';
}

export function homeText(item: Pick<Item, 'binId' | 'spotId'>, ix: PlaceIndex): string {
  const bin = item.binId ? ix.bin.get(item.binId) : undefined;
  if (bin) return binLabel(bin);
  const spot = item.spotId ? ix.spot.get(item.spotId) : undefined;
  return spot ? spot.name : 'No home yet';
}

/** The season's items (§4: an item's own season, else its bin's), in one part's records. */
export function seasonItems(d: Pick<HolidayRecords, 'items'> & Places, seasonId: string, ix: PlaceIndex = indexPlaces(d)): Item[] {
  return d.items.filter((i) => itemSeasonId(i, ix) === seasonId);
}

/**
 * The setup list (F25) of a season, from the Holiday part's records and its run (null before
 * Start setup: nothing ticked). Bins are done when `out`, items when `out`, tasks when ticked in the run.
 */
export function setupList(d: HolidayRecords, seasonId: string, run: Pick<SeasonRun, 'doneTaskIds'> | null): SetupList {
  const ix = indexPlaces(d);
  const bins = binsByPlace(
    d.bins.filter((b) => b.seasonId === seasonId),
    ix,
  ).map((bin) => ({ bin, where: placeText(bin, ix), done: bin.state === 'out' }));

  const displays = [...d.displays].sort((a, b) => a.order - b.order);
  const known = new Set(displays.map((x) => x.id));
  // A lent item isn't here to put out; it stays off the list until it's returned.
  const items = seasonItems(d, seasonId, ix).filter((i) => i.status !== 'lent').sort(byName);
  const groups: SetupGroup[] = [...displays, null]
    .map((display) => {
      const mine = items
        .filter((i) => (display ? i.displayId === display.id : !known.has(i.displayId)))
        .map((item) => ({ item, home: homeText(item, ix), done: item.status === 'out' }));
      return { display, items: mine, count: count(mine) };
    })
    .filter((g) => g.items.length > 0);

  const done = new Set(run?.doneTaskIds ?? []);
  const tasks = d.seasonTasks
    .filter((t) => t.seasonId === seasonId && t.phase === 'setup')
    .sort((a, b) => a.order - b.order)
    .map((task) => ({ task, done: done.has(task.id) }));

  const c = { bins: count(bins), items: count(groups.flatMap((g) => g.items)), tasks: count(tasks) };
  return { bins, groups, tasks, count: { ...c, all: { done: c.bins.done + c.items.done + c.tasks.done, total: c.bins.total + c.items.total + c.tasks.total } } };
}

/** What a season's card offers next (§10): the step for its run's phase. */
export type NextStep = 'start setup' | 'setup list' | 'take down' | 'done';

export function nextStep(run: Pick<SeasonRun, 'phase'> | null): NextStep {
  if (!run || run.phase === 'planned') return 'start setup';
  if (run.phase === 'setting up') return 'setup list';
  if (run.phase === 'done') return 'done';
  return 'take down';
}
