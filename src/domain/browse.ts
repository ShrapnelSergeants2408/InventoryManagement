// Browse (SPEC v3.0 F2): one part's items as a collapsible tree. By place: Area › Spot › Bin in
// walk order, loose items under their spot, then bins with no spot and "No home yet". By season
// (Holiday): Season › Bin, plus "Not in a bin", then "No season". By category is the Inventory
// view (inventory-view.ts). Pure, so it is unit-tested.
import { activeFilterCount, passesFilters, type Filters } from './filters';
import { buildInventoryView, type InventoryView, type ListLine } from './inventory-view';
import { binLabel, indexPlaces, itemSeasonId, NO_HOME, type Places } from './places';
import { matchesTerms, queryTerms, searchText } from './search';
import type { Category, Item, Season } from './types';

export type BrowseBy = 'place' | 'category' | 'season';

/** A group header in the place and season trees. */
export interface GroupLine {
  kind: 'group';
  key: string;
  /** 0 = area or season, 1 = spot (or a bin under a season), 2 = bin. */
  level: number;
  /** What it is, for the icon and the link. */
  type: 'area' | 'spot' | 'bin' | 'season' | 'none';
  /** The record it opens (spot or bin), or ''. */
  id: string;
  name: string;
  expanded: boolean;
  total: number;
  matching: number;
  /** Ids of the items passing search and filters under it, collapsed or not. */
  ids: string[];
}

export type BrowseLine = ListLine | GroupLine;

export interface BrowseView extends Omit<InventoryView, 'lines'> {
  lines: BrowseLine[];
}

export interface BrowseInput {
  items: readonly Item[];
  categories: readonly Category[];
  places: Places;
  seasons: readonly Season[];
  query: string;
  filters: Filters;
  expanded: ReadonlySet<string>;
}

interface Node {
  key: string;
  type: GroupLine['type'];
  id: string;
  name: string;
  /** Items directly in this group (shown after its child groups). */
  items: Item[];
  children: Node[];
}

const byName = (a: Item, b: Item) => a.name.localeCompare(b.name, 'en-US', { sensitivity: 'base' });
const byCode = (a: { code: string }, b: { code: string }) => a.code.localeCompare(b.code, 'en-US', { numeric: true });

function flatten(nodes: Node[], input: BrowseInput, passes: (i: Item) => boolean, filtering: boolean): BrowseView {
  const lines: BrowseLine[] = [];
  const shownIds: string[] = [];
  const all = (n: Node): Item[] => [...n.children.flatMap(all), ...n.items];
  const walk = (n: Node, level: number, parentOpen: boolean) => {
    const every = all(n);
    const visible = every.filter(passes);
    if (filtering && visible.length === 0) return;
    const expanded = filtering || input.expanded.has(n.key);
    if (parentOpen) lines.push({ kind: 'group', key: n.key, level, type: n.type, id: n.id, name: n.name, expanded, total: every.length, matching: visible.length, ids: visible.map((i) => i.id) });
    for (const c of n.children) walk(c, level + 1, parentOpen && expanded);
    const own = n.items.filter(passes);
    shownIds.push(...own.map((i) => i.id));
    if (parentOpen && expanded) for (const item of own) lines.push({ kind: 'item', item });
  };
  for (const n of nodes) walk(n, 0, true);
  const shown = new Set(input.items.filter(passes).map((i) => i.id)).size;
  return { lines, filtering, shown: filtering ? shown : input.items.length, shownIds, total: input.items.length };
}

/** Storage key for a group's expanded state. */
export const groupKey = (view: BrowseBy, id: string) => JSON.stringify([view, id]);

function placeTree(input: BrowseInput): Node[] {
  const { areas, spots, bins } = input.places;
  const items = [...input.items].sort(byName);
  const binNode = (b: (typeof bins)[number]): Node => ({ key: groupKey('place', b.id), type: 'bin', id: b.id, name: binLabel(b), items: items.filter((i) => i.binId === b.id), children: [] });
  const nodes: Node[] = [...areas]
    .sort((a, b) => a.order - b.order)
    .map((a) => ({
      key: groupKey('place', a.id),
      type: 'area',
      id: a.id,
      name: `${a.name} (${a.letter})`,
      items: [],
      children: spots
        .filter((s) => s.areaId === a.id)
        .sort((x, y) => x.order - y.order)
        .map((s) => ({ key: groupKey('place', s.id), type: 'spot', id: s.id, name: s.name, items: items.filter((i) => i.spotId === s.id), children: bins.filter((b) => b.spotId === s.id).sort(byCode).map(binNode) })),
    }));
  const loose = bins.filter((b) => b.spotId === '').sort(byCode);
  if (loose.length) nodes.push({ key: groupKey('place', 'no-spot'), type: 'none', id: '', name: 'Bins with no spot', items: [], children: loose.map(binNode) });
  const homeless = items.filter((i) => i.binId === '' && i.spotId === '');
  if (homeless.length) nodes.push({ key: groupKey('place', 'no-home'), type: 'none', id: '', name: NO_HOME, items: homeless, children: [] });
  return nodes;
}

function seasonTree(input: BrowseInput): Node[] {
  const ix = indexPlaces(input.places);
  const items = [...input.items].sort(byName);
  const seasonOf = new Map(items.map((i) => [i.id, itemSeasonId(i, ix)]));
  const tree = (seasonId: string, key: string, name: string, type: GroupLine['type']): Node => {
    const mine = items.filter((i) => seasonOf.get(i.id) === seasonId);
    const binIds = new Set(mine.filter((i) => i.binId).map((i) => i.binId));
    // A season's bins: those set to it, and any bin holding one of its items.
    const seasonBins = input.places.bins.filter((b) => (seasonId !== '' && b.seasonId === seasonId) || binIds.has(b.id)).sort(byCode);
    const children: Node[] = seasonBins.map((b) => ({ key: groupKey('season', `${seasonId}/${b.id}`), type: 'bin', id: b.id, name: binLabel(b), items: mine.filter((i) => i.binId === b.id), children: [] }));
    const outside = mine.filter((i) => !i.binId);
    if (outside.length) children.push({ key: groupKey('season', `${seasonId}/loose`), type: 'none', id: '', name: 'Not in a bin', items: outside, children: [] });
    return { key, type, id: seasonId, name, items: [], children };
  };
  // Seasons with no bins or items are left out: the ten defaults would otherwise fill the list.
  const nodes = [...input.seasons]
    .sort((a, b) => a.order - b.order)
    .map((s) => tree(s.id, groupKey('season', s.id), s.name, 'season'))
    .filter((n) => n.children.length > 0);
  const none = tree('', groupKey('season', 'none'), 'No season', 'none');
  // "No season" lists only items; bins with no season and nothing in them aren't seasonal.
  none.children = none.children.filter((c) => c.items.length > 0);
  if (none.children.length) nodes.push(none);
  return nodes;
}

/** The Browse list for a view; By category is the Inventory view. */
export function buildBrowseView(input: BrowseInput, by: BrowseBy): BrowseView {
  if (by === 'category') return buildInventoryView(input);
  const terms = queryTerms(input.query);
  const filtering = terms.length > 0 || activeFilterCount(input.filters) > 0;
  const ix = indexPlaces(input.places);
  const ctx = { places: ix, seasons: new Map(input.seasons.map((s) => [s.id, s])) };
  const passes = (i: Item) => passesFilters(i, input.filters, ix) && matchesTerms(searchText(i, ctx), terms);
  return flatten(by === 'place' ? placeTree(input) : seasonTree(input), input, passes, filtering);
}
