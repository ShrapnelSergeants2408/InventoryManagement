// Inventory search (SPEC F4; spec-questions D2).
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

/**
 * Everything F4 searches: name, part numbers and suppliers of every vendor
 * option (D2: not just the preferred one), location and notes.
 */
export function searchText(item: Item): string {
  const parts = [item.name, item.location, item.notes];
  for (const v of item.vendors) if (v) parts.push(v.partNo, v.supplier);
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

export function matchesQuery(item: Item, query: string): boolean {
  return matchesTerms(searchText(item), queryTerms(query));
}
