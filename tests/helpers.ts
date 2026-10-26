import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Item, Vendor } from '../src/domain/types';

export const SEED_PATH = fileURLToPath(new URL('../seed/frc2408-starter-catalog-2026-10-21.zip', import.meta.url));

/** SPEC §11 categories (v0.8) in their order, as the starter catalog's `categories.csv` has them. */
export const SPEC_CATEGORIES = [
  'Electrical', 'Pneumatics', 'Mechanical', 'Fasteners', 'Power Transfer', 'Assemblies',
  'Public Relations', 'Programming', 'Tools', 'Safety', 'Misc',
];

export function seedBytes(): Uint8Array {
  return new Uint8Array(readFileSync(SEED_PATH));
}

export function vendor(over: Partial<Vendor> = {}): Vendor {
  return { supplier: 'REV', partNo: 'REV-1', url: '', packSize: 1, packPriceCents: 1000, priceChecked: '2026-10-17', ...over };
}

export function item(over: Partial<Item> = {}): Item {
  return {
    id: 'tm-TEST1',
    name: 'Test item',
    category: 'Motors',
    subcategory: '',
    location: '',
    unit: 'each',
    onHand: 0,
    desired: 0,
    spares: 0,
    barcode: '',
    notes: '',
    source: 'team',
    lastCounted: '',
    countedBy: '',
    preferredVendor: 1,
    vendors: [vendor(), null, null],
    hasPhoto: false,
    ...over,
  };
}
