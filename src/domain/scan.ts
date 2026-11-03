// QR label payloads and what a scanned or typed code means (SPEC v3.0 §9, F3): labels of
// items, bins and spots, typed ids and bin codes, and product barcodes, in either part.
import { binCodeKey } from './places';
import { BIN_CODE_PATTERN } from './validate';
import type { Bin, Item, Spot } from './types';

/** Household labels encode `hhi:<record id>` (§9); the prefix tells them apart from product barcodes. */
export const QR_PREFIX = 'hhi:';

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
  /** One item: by its household label, its typed id or its barcode. */
  | { kind: 'item'; item: Item; via: 'label' | 'id' | 'barcode'; code: string }
  /** A bin: by its label, its typed id or its typed code ("A-04"). */
  | { kind: 'bin'; bin: Bin; via: 'label' | 'id' | 'code'; code: string }
  /** A spot: by its label or its typed id. */
  | { kind: 'spot'; spot: Spot; via: 'label' | 'id'; code: string }
  /** The same barcode on more than one item: the user picks. */
  | { kind: 'many'; items: Item[]; code: string }
  /** A household label whose record isn't on this phone (deleted, or an older backup). */
  | { kind: 'missing-label'; id: string; code: string }
  /** Not a household label, id, bin code or known barcode: offer attach or add (F3). */
  | { kind: 'unknown'; code: string };

/** What a scan is looked up in: both parts' records (F3 opens a record in whichever part). */
export interface ScanData {
  items: readonly Item[];
  bins: readonly Bin[];
  spots: readonly Spot[];
}

/** Household labels first, then typed ids, then typed bin codes, then product barcodes. */
export function resolveScan(raw: string, d: ScanData): ScanResult {
  const code = cleanCode(raw);
  if (code === '') return { kind: 'empty' };
  const byId = (id: string, via: 'label' | 'id'): ScanResult | null => {
    const k = id.toLowerCase();
    const item = d.items.find((i) => i.id.toLowerCase() === k);
    if (item) return { kind: 'item', item, via, code };
    const bin = d.bins.find((b) => b.id.toLowerCase() === k);
    if (bin) return { kind: 'bin', bin, via, code };
    const spot = d.spots.find((s) => s.id.toLowerCase() === k);
    if (spot) return { kind: 'spot', spot, via, code };
    return null;
  };

  if (code.toLowerCase().startsWith(QR_PREFIX)) {
    const id = code.slice(QR_PREFIX.length);
    return byId(id, 'label') ?? { kind: 'missing-label', id, code };
  }
  const typed = byId(code, 'id');
  if (typed) return typed;

  // A typed bin code ("A-04", "a4"), unique across both parts (§3). Barcodes are digits, so
  // they can't look like one.
  const binCode = binCodeKey(code);
  if (BIN_CODE_PATTERN.test(binCode)) {
    const bin = d.bins.find((b) => binCodeKey(b.code) === binCode);
    if (bin) return { kind: 'bin', bin, via: 'code', code: bin.code };
  }

  const key = barcodeKey(code);
  const matches = d.items.filter((i) => i.barcode !== '' && barcodeKey(i.barcode) === key);
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

/** Formats the camera looks for: household QR labels and common manufacturer barcodes. */
export const SCAN_FORMATS = ['qr_code', 'upc_a', 'upc_e', 'ean_13', 'ean_8', 'code_128', 'code_39'] as const;
