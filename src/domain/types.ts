// Core data model (SPEC v2.0 §3). H1 keeps the FRC item reduced to what v2.0 keeps; H2 adds
// areas, spots, bins and seasons.

export interface Item {
  id: string;
  name: string;
  category: string;
  subcategory: string;
  /** A Location name, or '' for "No location". */
  location: string;
  /** Whole number ≥ 0. */
  quantity: number;
  barcode: string;
  notes: string;
  hasPhoto: boolean;
}

export interface Location {
  name: string;
  notes: string;
  /** Walk order, 0-based. */
  order: number;
}

export interface Category {
  name: string;
  order: number;
  subcategories: string[];
}

/** Case-insensitive identity for category and location names (§3). */
export function nameKey(name: string): string {
  return name.trim().toLocaleLowerCase('en-US');
}
