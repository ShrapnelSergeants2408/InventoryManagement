// Search (SPEC v2.0 F1).
import type { Item } from './types';

/** Lower-case, accents removed, runs of whitespace collapsed. */
export function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLocaleLowerCase('en-US')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Everything F1 searches on an item: name, location, notes, category, subcategory and barcode. */
export function searchText(item: Item): string {
  return normalize([item.name, item.location, item.notes, item.category, item.subcategory, item.barcode].join(' \n '));
}

/** Search words; an item matches when it contains every one of them, in any order. */
export function queryTerms(query: string): string[] {
  const q = normalize(query);
  return q === '' ? [] : q.split(' ');
}

export function matchesTerms(text: string, terms: readonly string[]): boolean {
  return terms.every((t) => text.includes(t));
}

export function matchesQuery(item: Item, query: string): boolean {
  return matchesTerms(searchText(item), queryTerms(query));
}
