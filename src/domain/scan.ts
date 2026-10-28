// QR label payloads and what a scanned or typed code means (SPEC §9, F21, F29).
import { nameKey, type Item, type Location } from './types';

/** Team labels encode `2408:<item id>`; the prefix tells them apart from vendor QR codes. */
export const QR_PREFIX = '2408:';

export const qrPayload = (id: string) => QR_PREFIX + id;

/** The code as scanned or typed: trimmed, inner spaces removed (people type UPCs in groups). */
export const cleanCode = (raw: string) => raw.trim().replace(/\s+/g, '');

/**
 * Compare key for manufacturer barcodes. A 13-digit EAN starting with 0 is the same code as
 * the 12-digit UPC-A without it (scanners report either), so both map to the UPC-A.
 * Letters (Code 128/39) compare without case.
 */
export function barcodeKey(code: string): string {
  const c = cleanCode(code);
  if (/^0\d{12}$/.test(c)) return c.slice(1);
  return c.toUpperCase();
}

/**
 * A scanned or typed location name (F29): trimmed, runs of spaces made one. Unlike
 * `cleanCode` the inner spaces stay, since bin codes read "Electrical 15".
 */
export const locationText = (raw: string) => raw.trim().replace(/\s+/g, ' ');

const spaceless = (s: string) => nameKey(s).replace(/\s+/g, '');

/**
 * The location a bin's QR code names (F29): the name ignoring capitals, or else the one name
 * that matches with spaces ignored ("Tools7" for "Tools 7"). Null when none, or when several
 * match that way. A team item label is never a location.
 */
export function findLocation(raw: string, locations: readonly Location[]): Location | null {
  const text = locationText(raw);
  if (text === '' || text.toLowerCase().startsWith(QR_PREFIX)) return null;
  const exact = locations.find((l) => nameKey(l.name) === nameKey(text));
  if (exact) return exact;
  const loose = locations.filter((l) => spaceless(l.name) === spaceless(text));
  return loose.length === 1 ? loose[0]! : null;
}

/** Longest scanned text offered as a new location name (F29); bin codes are short. */
export const LOCATION_TEXT_MAX = 60;

/**
 * Whether an unknown code could be a bin's location QR code (F29), so "Location not found"
 * offers Add and Rename: a QR code or typed text with a letter, not a web address or team
 * label, and short. Manufacturer barcodes (UPC, Code 128…) never are.
 */
export function couldBeLocation(raw: string, format: string | null): boolean {
  if (format !== null && format !== 'qr_code') return false;
  const text = locationText(raw);
  return text !== '' && text.length <= LOCATION_TEXT_MAX && /\p{L}/u.test(text) && !/^[a-z][a-z0-9+.-]*:\/\//i.test(text) && !text.toLowerCase().startsWith(QR_PREFIX);
}

export type ScanResult =
  | { kind: 'empty' }
  /** One item: by its team label, its typed id, its barcode, or picked from a scanned location (F29). */
  | { kind: 'item'; item: Item; via: 'label' | 'id' | 'barcode' | 'location'; code: string }
  /** The same barcode on more than one item: the user picks. */
  | { kind: 'many'; items: Item[]; code: string }
  /** A team label whose item isn't on this tablet (deleted, or an older backup). */
  | { kind: 'missing-label'; id: string; code: string }
  /** A bin's QR code naming a location (F29). */
  | { kind: 'location'; location: Location; code: string }
  /** Not a team label, id, known barcode or location: offer attach or add (F21, F29). `text` keeps the spaces, for a location name. */
  | { kind: 'unknown'; code: string; text: string };

/** Team labels, item ids and barcodes come first, so item scans work as before; location names last (F29). */
export function resolveScan(raw: string, items: readonly Item[], locations: readonly Location[] = []): ScanResult {
  const code = cleanCode(raw);
  if (code === '') return { kind: 'empty' };
  const byId = (id: string) => items.find((i) => i.id.toLowerCase() === id.toLowerCase());

  if (code.toLowerCase().startsWith(QR_PREFIX)) {
    const id = code.slice(QR_PREFIX.length);
    const item = byId(id);
    return item ? { kind: 'item', item, via: 'label', code } : { kind: 'missing-label', id, code };
  }
  const item = byId(code);
  if (item) return { kind: 'item', item, via: 'id', code };

  const key = barcodeKey(code);
  const matches = items.filter((i) => i.barcode !== '' && barcodeKey(i.barcode) === key);
  if (matches.length === 1) return { kind: 'item', item: matches[0]!, via: 'barcode', code };
  if (matches.length > 1) return { kind: 'many', items: matches, code };
  const location = findLocation(raw, locations);
  if (location) return { kind: 'location', location, code: locationText(raw) };
  return { kind: 'unknown', code, text: locationText(raw) };
}

const FORMAT_NAMES: Record<string, string> = {
  qr_code: 'QR code',
  upc_a: 'UPC-A barcode',
  upc_e: 'UPC-E barcode',
  ean_13: 'EAN-13 barcode',
  ean_8: 'EAN-8 barcode',
  code_128: 'Code 128 barcode',
  code_39: 'Code 39 barcode',
  code_93: 'Code 93 barcode',
  codabar: 'Codabar barcode',
  itf: 'ITF barcode',
  data_matrix: 'Data Matrix code',
  pdf417: 'PDF417 code',
  aztec: 'Aztec code',
};

/** "UPC-A barcode" for a BarcodeDetector format; "Typed code" when it was typed. */
export function formatName(format: string | null): string {
  if (format === null) return 'Typed code';
  return FORMAT_NAMES[format] ?? 'Code';
}

/** Formats the camera looks for: team QR labels and common manufacturer barcodes. */
export const SCAN_FORMATS = ['qr_code', 'upc_a', 'upc_e', 'ean_13', 'ean_8', 'code_128', 'code_39'] as const;
