// Areas, spots and bins (SPEC v3.0 §3, §4): area codes, bin codes, an item's path and season,
// and a bin's contents summary. Pure, so it is unit-tested.
import { BIN_CODE_PATTERN } from './validate';
import { nameKey, type Area, type Bin, type Item, type Season, type Spot } from './types';

/** Everything an item's or bin's place is worked out from. */
export interface Places {
  areas: readonly Area[];
  spots: readonly Spot[];
  bins: readonly Bin[];
}

export interface PlaceIndex {
  area: Map<string, Area>;
  spot: Map<string, Spot>;
  bin: Map<string, Bin>;
}

export function indexPlaces(p: Places): PlaceIndex {
  return {
    area: new Map(p.areas.map((a) => [a.id, a])),
    spot: new Map(p.spots.map((s) => [s.id, s])),
    bin: new Map(p.bins.map((b) => [b.id, b])),
  };
}

// ── Area codes (Dan, 2026-11-03: names, not letters) ──

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** Letters only, so a bin code's number can never run into it ("ATTIC4" is ATTIC-04). */
export const AREA_CODE_MAX = 8;

/** The name's words in capitals, accents dropped, letters only. */
function nameWords(name: string): string[] {
  return name
    .normalize('NFD')
    .toUpperCase()
    .split(/[^A-Z]+/)
    .filter(Boolean);
}

/**
 * A new area's code (§3): the first word of its name ("Storage room" → STORAGE, at most 8
 * letters). Taken (codes are unique across both parts): the word with the other words' initials
 * ("STORAGER"), then the first 7 letters and A–Z. Null when nothing is free.
 */
export function defaultAreaCode(name: string, taken: readonly string[]): string | null {
  const used = new Set(taken.map((t) => t.toUpperCase()));
  const words = nameWords(name);
  const first = (words[0] ?? 'AREA').slice(0, AREA_CODE_MAX);
  const initials = words.slice(1).map((w) => w[0]).join('');
  const candidates = [first, (first.slice(0, AREA_CODE_MAX - initials.length) + initials).slice(0, AREA_CODE_MAX), ...[...LETTERS].map((l) => first.slice(0, AREA_CODE_MAX - 1) + l)];
  return candidates.find((c) => c !== '' && !used.has(c)) ?? null;
}

// ── Bin codes ──

/**
 * A typed bin code, tidied: capitals, spaces dropped, the dash added and the number padded to
 * two digits ("attic4" → "ATTIC-04", "garage 12" → "GARAGE-12"). Anything else comes back trimmed
 * and upper-cased, for validation to refuse.
 */
export function tidyBinCode(raw: string): string {
  const s = raw.trim().toUpperCase().replace(/\s+/g, '');
  const m = /^([A-Z]+)-?(\d+)$/.exec(s);
  if (!m) return s;
  const n = String(Number(m[2]));
  return `${m[1]}-${n.padStart(2, '0')}`;
}

export const binCodeKey = (code: string) => tidyBinCode(code);

/** The area code and number of a bin code, or null. */
export function splitBinCode(code: string): { area: string; number: number } | null {
  if (!BIN_CODE_PATTERN.test(code)) return null;
  const at = code.lastIndexOf('-');
  return { area: code.slice(0, at), number: Number(code.slice(at + 1)) };
}

/** The number in a bin code, or null. */
export function binNumber(code: string): number | null {
  return splitBinCode(code)?.number ?? null;
}

/**
 * The next code for a new bin in an area (§3, D4): the area code and one more than the highest
 * number used with that code, so a deleted bin's code isn't handed out again.
 */
export function nextBinCode(areaCode: string, codes: readonly string[]): string {
  let max = 0;
  for (const c of codes) {
    const p = splitBinCode(c);
    if (p && p.area === areaCode && p.number > max) max = p.number;
  }
  return `${areaCode}-${String(max + 1).padStart(2, '0')}`;
}

/** Codes compare ignoring capitals and padding ("a-4" is "A-04"). */
export function sameBinCode(a: string, b: string): boolean {
  return binCodeKey(a) === binCodeKey(b);
}

// ── Paths (§4) ──

export interface PathPart {
  kind: 'area' | 'spot' | 'bin';
  id: string;
  label: string;
}

export const binLabel = (b: Pick<Bin, 'code' | 'name'>) => `${b.code} ${b.name}`;

/** A spot's path: its area, then itself. */
export function spotPath(spot: Spot, ix: PlaceIndex): PathPart[] {
  const area = ix.area.get(spot.areaId);
  return [...(area ? [{ kind: 'area' as const, id: area.id, label: area.name }] : []), { kind: 'spot', id: spot.id, label: spot.name }];
}

/** A bin's path: its spot's path, then itself. */
export function binPath(bin: Bin, ix: PlaceIndex): PathPart[] {
  const spot = bin.spotId ? ix.spot.get(bin.spotId) : undefined;
  return [...(spot ? spotPath(spot, ix) : []), { kind: 'bin', id: bin.id, label: binLabel(bin) }];
}

/** An item's home as a path (§4): Attic › Shelf B › A-04 Christmas 4. Empty = no home yet. */
export function itemPath(item: Pick<Item, 'binId' | 'spotId'>, ix: PlaceIndex): PathPart[] {
  if (item.binId) {
    const bin = ix.bin.get(item.binId);
    return bin ? binPath(bin, ix) : [];
  }
  if (item.spotId) {
    const spot = ix.spot.get(item.spotId);
    return spot ? spotPath(spot, ix) : [];
  }
  return [];
}

export const NO_HOME = 'No home yet';
export const NO_SPOT = 'no spot';

/**
 * The spot for things kept loose in an area, with no shelf or bin of their own (Dan, 2026-11-04).
 * An ordinary spot by this name, made the first time the home picker's "Loose in …" is chosen.
 */
export const LOOSE_SPOT = 'Loose';
export const isLooseSpot = (s: Pick<Spot, 'name'>) => nameKey(s.name) === nameKey(LOOSE_SPOT);

/** The path as one line. A bin with no spot reads "A-04 Christmas 4 (no spot)". */
export function pathText(parts: readonly PathPart[]): string {
  if (parts.length === 0) return NO_HOME;
  const text = parts.map((p) => p.label).join(' › ');
  return parts.length === 1 && parts[0]!.kind === 'bin' ? `${text} (${NO_SPOT})` : text;
}

/** The area an item's home is in, or null. */
export function itemAreaId(item: Pick<Item, 'binId' | 'spotId'>, ix: PlaceIndex): string | null {
  return itemPath(item, ix).find((p) => p.kind === 'area')?.id ?? null;
}

// ── Seasons (§4) ──

/** An item's season: its own, else its bin's; '' for none. */
export function itemSeasonId(item: Pick<Item, 'seasonId' | 'binId'>, ix: PlaceIndex): string {
  if (item.seasonId) return item.seasonId;
  return (item.binId && ix.bin.get(item.binId)?.seasonId) || '';
}

/** Default seasons in calendar order, with their palette colors (§3). */
export const DEFAULT_SEASONS: ReadonlyArray<Pick<Season, 'name' | 'color'>> = [
  { name: 'Valentine’s', color: 'pink' },
  { name: 'St. Patrick’s', color: 'green' },
  { name: 'Easter', color: 'purple' },
  { name: '4th of July', color: 'navy' },
  { name: 'Fall', color: 'brown' },
  { name: 'Halloween', color: 'orange' },
  { name: 'Thanksgiving', color: 'gold' },
  { name: 'Christmas', color: 'red' },
  { name: 'Winter', color: 'teal' },
  { name: 'New Year’s', color: 'blue' },
];

// ── Quantities and contents (§4) ──

/** "×3", or "~40" for a bulk line. */
export const qtyText = (i: Pick<Item, 'quantity' | 'approx'>) => (i.approx ? `~${i.quantity}` : `×${i.quantity}`);

/**
 * A bin's contents summary (§4): stored items in the bin, largest quantities first, bulk lines
 * first when tied, then A–Z. One line each: "Name ×3" or "Name ~40".
 */
export function binContents(items: readonly Item[], binId: string): string[] {
  return items
    .filter((i) => i.binId === binId && i.status === 'stored')
    .sort((a, b) => b.quantity - a.quantity || Number(b.approx) - Number(a.approx) || a.name.localeCompare(b.name, 'en-US', { sensitivity: 'base' }))
    .map((i) => `${i.name} ${qtyText(i)}`);
}

/** Names unique within a group, ignoring capitals. */
export function nameTaken(names: readonly string[], name: string, self?: string): string | null {
  const key = nameKey(name);
  const selfKey = self === undefined ? null : nameKey(self);
  return names.find((n) => nameKey(n) === key && nameKey(n) !== selfKey) ?? null;
}
