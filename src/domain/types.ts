// Core data model (SPEC v2.0 §3): Area › Spot › Bin › Item, seasons, tags and categories.
// Sync fields (updatedBy, deleted) arrive with H4; until then a delete removes the record.

/** A room or zone (Attic, Garage…). Its letter starts the codes of bins made there. */
export interface Area {
  id: string;
  name: string;
  /** One letter A–Z, unique. */
  letter: string;
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
  /** "A-04": area letter + number. Kept when the bin moves. */
  code: string;
  name: string;
  /** '' = no spot. */
  spotId: string;
  /** '' = no season. */
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
  /** '' = follows its bin's season. */
  seasonId: string;
  tags: string[];
  status: ItemStatus;
  /** While out: where ("Mantel"). */
  outWhere: string;
  /** While out: ms since epoch, or null. */
  outSince: number | null;
  lentTo: string;
  /** ISO date, or ''. */
  lentOn: string;
  condition: Condition;
  conditionNote: string;
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

export interface Season {
  id: string;
  name: string;
  order: number;
  color: SeasonColor;
  setupNotes: string;
}

export interface Category {
  name: string;
  order: number;
  subcategories: string[];
}

/** One entry of the Tags list (F11). Records hold tag names. */
export interface Tag {
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
export function blankItem(id: string, name: string, category: string): Item {
  return {
    id,
    name,
    category,
    subcategory: '',
    binId: '',
    spotId: '',
    quantity: 1,
    approx: false,
    seasonId: '',
    tags: [],
    status: 'stored',
    outWhere: '',
    outSince: null,
    lentTo: '',
    lentOn: '',
    condition: 'ok',
    conditionNote: '',
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
