// QR label payloads and what a scanned or typed code means (SPEC §9, F21).
import type { Item } from './types';

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

export type ScanResult =
  | { kind: 'empty' }
  /** One item: by its team label, its typed id, or its barcode. */
  | { kind: 'item'; item: Item; via: 'label' | 'id' | 'barcode'; code: string }
  /** The same barcode on more than one item: the user picks. */
  | { kind: 'many'; items: Item[]; code: string }
  /** A team label whose item isn't on this tablet (deleted, or an older backup). */
  | { kind: 'missing-label'; id: string; code: string }
  /** Not a team label, id or known barcode: offer attach or add (F21). */
  | { kind: 'unknown'; code: string };

export function resolveScan(raw: string, items: readonly Item[]): ScanResult {
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
  return { kind: 'unknown', code };
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
