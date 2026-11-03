// Find (SPEC v3.0 F1): one search over a part's items, bins and spots, results grouped with their
// paths. Items match on name, notes, tags, barcode, model, serial, category, path and season;
// bins on code, name, notes, tags, path and season; spots on name, notes and area. A typed bin
// code ("a4") also finds that bin. Pure, so it is unit-tested.
import type { PartRecords } from './parts';
import { binCodeKey, binPath, indexPlaces, itemPath, pathText, spotPath, type PathPart } from './places';
import { matchesTerms, normalize, queryTerms, searchText } from './search';
import { BIN_CODE_PATTERN } from './validate';
import type { Bin, Item, Spot } from './types';

export interface FindResults {
  items: { item: Item; path: string }[];
  bins: { bin: Bin; path: string }[];
  spots: { spot: Spot; path: string }[];
  /** Matches before any limit. */
  total: number;
}

export const NO_RESULTS: FindResults = { items: [], bins: [], spots: [], total: 0 };

/** The path above a bin or spot (its area and spot), for the result line. */
const above = (parts: PathPart[]) => pathText(parts.slice(0, -1)) || 'No spot';

/** Search results for one part. `limit` caps each group (the counts stay whole). */
export function findIn(d: PartRecords, query: string, limit = 50): FindResults {
  const terms = queryTerms(query);
  if (terms.length === 0) return NO_RESULTS;
  const ix = indexPlaces(d);
  const seasons = new Map(d.seasons.map((s) => [s.id, s]));
  const ctx = { places: ix, seasons };
  const code = binCodeKey(query.trim());
  const isCode = BIN_CODE_PATTERN.test(code);

  const items = d.items.filter((i) => matchesTerms(searchText(i, ctx), terms));
  const bins = d.bins.filter((b) => {
    if (isCode && binCodeKey(b.code) === code) return true;
    const text = [b.code, b.name, b.notes, b.tags.join(' '), pathText(binPath(b, ix)), seasons.get(b.seasonId)?.name ?? ''].join(' \n ');
    return matchesTerms(normalize(text), terms);
  });
  const spots = d.spots.filter((s) => matchesTerms(normalize([s.name, s.notes, pathText(spotPath(s, ix))].join(' \n ')), terms));

  const byName = <T>(name: (x: T) => string) => (a: T, b: T) => name(a).localeCompare(name(b), 'en-US', { sensitivity: 'base' });
  return {
    items: items
      .sort(byName((i) => i.name))
      .slice(0, limit)
      .map((item) => ({ item, path: pathText(itemPath(item, ix)) })),
    bins: bins
      .sort((a, b) => a.code.localeCompare(b.code, 'en-US', { numeric: true }))
      .slice(0, limit)
      .map((bin) => ({ bin, path: above(binPath(bin, ix)) })),
    spots: spots
      .sort(byName((s) => s.name))
      .slice(0, limit)
      .map((spot) => ({ spot, path: above(spotPath(spot, ix)) })),
    total: items.length + bins.length + spots.length,
  };
}
