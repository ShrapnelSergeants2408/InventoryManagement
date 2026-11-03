// Search (SPEC v2.0 F1).
import { itemPath, itemSeasonId, pathText, type PlaceIndex } from './places';
import type { Item, Season } from './types';

/** Lower-case, accents removed, runs of whitespace collapsed. */
export function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLocaleLowerCase('en-US')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface SearchContext {
  places: PlaceIndex;
  seasons: ReadonlyMap<string, Season>;
}

/**
 * Everything F1 searches on an item: name, notes, tags, barcode, model and serial, its
 * category, its path (area, spot, bin code and name) and its season.
 */
export function searchText(item: Item, ctx?: SearchContext): string {
  const parts = [item.name, item.notes, item.tags.join(' '), item.barcode, item.model, item.serial, item.category, item.subcategory];
  if (ctx) {
    const path = itemPath(item, ctx.places);
    if (path.length) parts.push(pathText(path));
    const season = ctx.seasons.get(itemSeasonId(item, ctx.places));
    if (season) parts.push(season.name);
  }
  return normalize(parts.join(' \n '));
}

/** Search words; an item matches when it contains every one of them, in any order. */
export function queryTerms(query: string): string[] {
  const q = normalize(query);
  return q === '' ? [] : q.split(' ');
}

export function matchesTerms(text: string, terms: readonly string[]): boolean {
  return terms.every((t) => text.includes(t));
}

export function matchesQuery(item: Item, query: string, ctx?: SearchContext): boolean {
  return matchesTerms(searchText(item, ctx), queryTerms(query));
}
