// Core data model (SPEC v3.0 §3): two parts (Household, Holiday), each with Area › Spot › Bin ›
// Item, categories and tags; seasons are Holiday only. Sync fields (updatedBy, deleted) arrive
// with H5; until then a delete removes the record.

/** The two parts of the app (§3, F21). Nothing links across them. */
export type Part = 'household' | 'holiday';
export const PARTS: readonly Part[] = ['household', 'holiday'];
export const PART_NAME: Readonly<Record<Part, string>> = { household: 'Household', holiday: 'Holiday' };
export const otherPart = (p: Part): Part => (p === 'household' ? 'holiday' : 'household');

/** A room or zone (Attic, Garage…). Its code starts the codes of bins made there (ATTIC-04). */
export interface Area {
  id: string;
  part: Part;
  /** Unique within the part, ignoring capitals. */
  name: string;
  /** 1–8 capital letters ("ATTIC"), unique across both parts, so every bin code is (Dan, 2026-11-03). */
  code: string;
  /** Walk order, 0-based. */
  order: number;
  notes: string;
}

/** A place inside an area: "Shelf B", "Pegboard". */
export interface Spot {
  id: string;
  areaId: string;
  name: string;
  /** Walk order within the area, 0-based. */
  order: number;
  notes: string;
}

export type BinState = 'stored' | 'out';

/** A labelled container. */
export interface Bin {
  id: string;
  /** "ATTIC-04": area code + number, unique across both parts. Kept when the bin moves. */
  code: string;
  name: string;
  /** Always stored; must match its spot's area's part when it has a spot. */
  part: Part;
  /** '' = no spot. */
  spotId: string;
  /** Holiday only; '' = no season. */
  seasonId: string;
  tags: string[];
  state: BinState;
  notes: string;
  /** ms since epoch the label was last printed, or null. */
  labelPrintedAt: number | null;
  /** The contents summary printed on that label (§4), or null. */
  labelContents: string | null;
}

export type ItemStatus = 'stored' | 'out' | 'lent';
export type Condition = 'ok' | 'needs repair' | 'replace' | 'toss';

export const ITEM_STATUSES: readonly ItemStatus[] = ['stored', 'out', 'lent'];
export const CONDITIONS: readonly Condition[] = ['ok', 'needs repair', 'replace', 'toss'];
export const BIN_STATES: readonly BinState[] = ['stored', 'out'];

export interface Item {
  id: string;
  /** Must match its home's part. */
  part: Part;
  name: string;
  category: string;
  subcategory: string;
  /** Its home: a bin, or a spot for a loose item, or neither ('' both) for "No home yet". Never both. */
  binId: string;
  spotId: string;
  /** Whole number ≥ 0. */
  quantity: number;
  /** Shown as "~40" (a bulk line). */
  approx: boolean;
  /** Holiday only. '' = follows its bin's season. */
  seasonId: string;
  /** Holiday only: the display it usually goes on (F22, H4); ''. */
  displayId: string;
  tags: string[];
  status: ItemStatus;
  /** While out: where ("Mantel"). */
  outWhere: string;
  /** Holiday only, while out: the display it's on this time (H4); ''. */
  outDisplayId: string;
  /** While out: ms since epoch, or null. */
  outSince: number | null;
  lentTo: string;
  /** ISO date, or ''. */
  lentOn: string;
  condition: Condition;
  conditionNote: string;
  /** Holiday only: ms since epoch its condition was last checked (F9, H6), or null. */
  checkedAt: number | null;
  barcode: string;
  notes: string;
  /** Integer cents, or null. */
  value: number | null;
  /** ISO dates, or ''. */
  purchaseDate: string;
  model: string;
  serial: string;
  warrantyUntil: string;
  /** Pantry phase (F19); null until then. */
  keepAtLeast: number | null;
  /** Derived: the item has at least one photo. Kept in step by the photo writes; not in backups. */
  hasPhoto: boolean;
}

/** Fixed season palette (§3): chips only, never a condition color. */
export const SEASON_COLORS = ['red', 'orange', 'gold', 'green', 'teal', 'blue', 'navy', 'purple', 'pink', 'brown'] as const;
export type SeasonColor = (typeof SEASON_COLORS)[number];

/** A Holiday season (§3). Its window is setupFrom → takedownBy each year, "MM-DD", wrapping over New Year. */
export interface Season {
  id: string;
  name: string;
  order: number;
  color: SeasonColor;
  /** "MM-DD", or '' for none. */
  setupFrom: string;
  takedownBy: string;
  setupNotes: string;
}

export interface Category {
  part: Part;
  name: string;
  order: number;
  subcategories: string[];
}

/** One entry of the Tags list (F11). Records hold tag names. */
export interface Tag {
  part: Part;
  name: string;
  order: number;
}

export type PhotoOwner = 'item' | 'bin' | 'spot' | 'season';
export type PhotoKind = 'photo' | 'setup';

/** A photo's record (§3); the image itself is stored beside it. */
export interface PhotoInfo {
  id: string;
  ownerType: PhotoOwner;
  ownerId: string;
  kind: PhotoKind;
  caption: string;
  /** Position in the owner's carousel; the first is the thumbnail. */
  order: number;
}

/** Case-insensitive identity for names (§3). */
export function nameKey(name: string): string {
  return name.trim().toLocaleLowerCase('en-US');
}

/** A new item's defaults: stored, condition OK, quantity 1, no home. */
export function blankItem(id: string, name: string, category: string, part: Part = 'household'): Item {
  return {
    id,
    part,
    name,
    category,
    subcategory: '',
    binId: '',
    spotId: '',
    quantity: 1,
    approx: false,
    seasonId: '',
    displayId: '',
    tags: [],
    status: 'stored',
    outWhere: '',
    outDisplayId: '',
    outSince: null,
    lentTo: '',
    lentOn: '',
    condition: 'ok',
    conditionNote: '',
    checkedAt: null,
    barcode: '',
    notes: '',
    value: null,
    purchaseDate: '',
    model: '',
    serial: '',
    warrantyUntil: '',
    keepAtLeast: null,
    hasPhoto: false,
  };
}
