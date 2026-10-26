// Core data model (SPEC §3). Money is integer cents (spec-questions Q6).

export type VendorSlot = 1 | 2 | 3;
export const VENDOR_SLOTS: readonly VendorSlot[] = [1, 2, 3];

export interface Vendor {
  supplier: string;
  partNo: string;
  url: string;
  /** Units per purchasable pack; whole number ≥ 1. */
  packSize: number;
  /** Price per pack in cents, or null when there is no price ("no price", §4). */
  packPriceCents: number | null;
  /** ISO date YYYY-MM-DD, or '' when unknown. */
  priceChecked: string;
}

export type ItemSource = 'starter' | 'team';

export interface Item {
  id: string;
  name: string;
  category: string;
  subcategory: string;
  /** A Location name, or '' for "No location". */
  location: string;
  unit: string;
  onHand: number;
  desired: number;
  spares: number;
  barcode: string;
  notes: string;
  source: ItemSource;
  /**
   * When on_hand was last confirmed by a count (F24): a local date-time with its UTC offset,
   * 2026-10-24T18:42:07-05:00 (§3), or '' when never counted. Older data held a date only.
   */
  lastCounted: string;
  /** Where that count came from: '' = this tablet, otherwise the helper's name (§3, §18.5). */
  countedBy: string;
  preferredVendor: VendorSlot;
  /** Fixed slots: index 0 is v1, 1 is v2, 2 is v3. */
  vendors: [Vendor | null, Vendor | null, Vendor | null];
  hasPhoto: boolean;
}

export interface Supplier {
  name: string;
  website: string;
  notes: string;
}

export interface Location {
  name: string;
  notes: string;
  /** Walk order, 0-based (F24, F25). */
  order: number;
}

export interface Category {
  name: string;
  order: number;
  subcategories: string[];
}

export const OTHER_SUPPLIER = 'other';

export const DEFAULT_SUPPLIERS: readonly string[] = [
  'REV',
  'AndyMark',
  'CTRE',
  'WCP',
  'VEX',
  'McMaster-Carr',
  'Thrifty Bot',
  'Amazon',
  OTHER_SUPPLIER,
];

/** Case-insensitive identity for supplier and location names (§3). */
export function nameKey(name: string): string {
  return name.trim().toLocaleLowerCase('en-US');
}

export function vendorAt(item: Item, slot: VendorSlot): Vendor | null {
  return item.vendors[slot - 1] ?? null;
}

export function preferredVendorOf(item: Item): Vendor | null {
  return vendorAt(item, item.preferredVendor);
}
