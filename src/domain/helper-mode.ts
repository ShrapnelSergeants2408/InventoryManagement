// Helper mode on a helper device (SPEC §18.2–§18.4): what the kit says, which items are the
// helper's to count, what goes in the cumulative counts file, and the "Add item not on the
// list" rules. Pure, so the rules are unit-tested; data/helper-db.ts stores them.
import type { GroupKind } from './helpers';
import { NO_LOCATION } from './lists';
import { parsePrice } from './money';
import { QR_PREFIX, barcodeKey, cleanCode } from './scan';
import { nameKey, type Category, type Item, type Location } from './types';
import { normalizeUrl } from './url';
import { parseWholeNumber } from './validate';

export const KIT_FORMAT = 'frc2408-count-kit';
/** Raised when the kit layout changes; a helper refuses a newer kit and asks to reload (§18.7). */
export const KIT_FORMAT_VERSION = 1;
export const COUNTS_FORMAT = 'frc2408-counts';
/** Raised when the counts file layout changes; the main tablet refuses a newer one (§18.7). */
export const COUNTS_FORMAT_VERSION = 1;

/** The kit a helper joined with (kit.json, §18.2), as the helper keeps it. */
export interface HelperKit {
  kitId: string;
  helperId: string;
  helperName: string;
  /** kit.json created_at: local date-time with offset. */
  createdAt: string;
  /** The main tablet's app version. */
  appVersion: string;
  kind: GroupKind;
  groups: string[];
  allowNewItems: boolean;
}

export type KitCheck = { ok: true; kit: HelperKit } | { ok: false; newer: boolean; message: string };

const isText = (v: unknown): v is string => typeof v === 'string';

/** Checks kit.json. A newer format is refused with "reload" (§18.7); anything malformed is refused. */
export function checkKitJson(raw: unknown): KitCheck {
  const bad = (why: string): KitCheck => ({ ok: false, newer: false, message: `This count kit can’t be used: ${why}.` });
  if (typeof raw !== 'object' || raw === null) return bad('kit.json is not readable');
  const k = raw as Record<string, unknown>;
  if (k.format !== KIT_FORMAT) return bad('kit.json isn’t from this app');
  const v = k.format_version;
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 1) return bad('kit.json has no format version');
  if (v > KIT_FORMAT_VERSION) {
    return {
      ok: false,
      newer: true,
      message: 'This count kit was made by a newer version of the app. Reload the app to update it (close it and open it again, or refresh the page), then open the kit again.',
    };
  }
  const groups = k.groups as { kind?: unknown; names?: unknown } | undefined;
  if (!isText(k.kit_id) || k.kit_id === '' || !isText(k.helper_id) || k.helper_id === '' || !isText(k.helper_name) || k.helper_name.trim() === '') return bad('kit.json has no kit or helper');
  if (!isText(k.created_at)) return bad('kit.json has no date');
  if (!groups || (groups.kind !== 'category' && groups.kind !== 'location') || !Array.isArray(groups.names) || !groups.names.every(isText)) return bad('kit.json has no groups');
  return {
    ok: true,
    kit: {
      kitId: k.kit_id,
      helperId: k.helper_id,
      helperName: k.helper_name.trim(),
      createdAt: k.created_at,
      appVersion: isText(k.app_version) ? k.app_version : '',
      kind: groups.kind,
      groups: [...(groups.names as string[])],
      allowNewItems: k.allow_new_items !== false,
    },
  };
}

/** Whether the item is in one of the helper's groups (§18.3). Items with no location are in "No location". */
export function inAssignment(item: Pick<Item, 'category' | 'location'>, kit: Pick<HelperKit, 'kind' | 'groups'>): boolean {
  const mine = new Set(kit.groups.map(nameKey));
  if (kit.kind === 'category') return mine.has(nameKey(item.category));
  return mine.has(nameKey(item.location === '' ? NO_LOCATION : item.location));
}

/** "HELPER · Maya's phone · 3 groups" (§17), the part after HELPER. */
export function helperBarText(kit: Pick<HelperKit, 'helperName' | 'groups' | 'kind'>): string {
  const n = kit.groups.length;
  const what = n === 1 ? kit.groups[0]! : `${n} ${kit.kind === 'category' ? 'categories' : 'locations'}`;
  return `${kit.helperName} · ${what}`;
}

/**
 * What a helper changed (§18.4), one record each, kept so every counts file is cumulative.
 * An item: counted, location set, barcode attached (any mix; the latest values are read from
 * the item when the file is built). A location created on the helper. A pending item added.
 */
export type HelperChange =
  | { kind: 'item'; itemId: string; counted: boolean; location: boolean; barcode: boolean; outside: boolean; changedAt: number }
  | { kind: 'location'; name: string; changedAt: number }
  | { kind: 'pending'; pendingId: string; changedAt: number };

/** Storage key of a change, so a second change to the same thing replaces the first. */
export function changeKey(c: Pick<HelperChange, 'kind'> & { itemId?: string; name?: string; pendingId?: string }): string {
  if (c.kind === 'item') return `item:${c.itemId}`;
  if (c.kind === 'location') return `location:${nameKey(c.name ?? '')}`;
  return `pending:${c.pendingId}`;
}

/**
 * Folds a new change to an item into the earlier one: each flag stays set once set, and
 * "outside the assignment" is decided by the first change (the item as the kit gave it).
 */
export function mergeItemChange(
  earlier: Extract<HelperChange, { kind: 'item' }> | null,
  next: { itemId: string; counted?: boolean; location?: boolean; barcode?: boolean; outside: boolean },
  now: number,
): Extract<HelperChange, { kind: 'item' }> {
  return {
    kind: 'item',
    itemId: next.itemId,
    counted: (earlier?.counted ?? false) || next.counted === true,
    location: (earlier?.location ?? false) || next.location === true,
    barcode: (earlier?.barcode ?? false) || next.barcode === true,
    outside: earlier ? earlier.outside : next.outside,
    changedAt: now,
  };
}

/** "n changes not sent yet" (§18.4): changes made after the last send (all of them before the first). */
export function unsentChanges(changes: readonly Pick<HelperChange, 'changedAt'>[], lastSentAt: number | null): number {
  return changes.filter((c) => lastSentAt === null || c.changedAt > lastSentAt).length;
}

/** One counts.csv row (§18.4). Blank location or barcode means unchanged; blank on_hand means not counted. */
export interface CountsRow {
  item_id: string;
  on_hand: string;
  counted_at: string;
  location: string;
  barcode: string;
  outside_assignment: string;
}

export const COUNTS_COLUMNS: readonly (keyof CountsRow)[] = ['item_id', 'on_hand', 'counted_at', 'location', 'barcode', 'outside_assignment'];

/**
 * counts.csv: one row per item counted or changed since the kit was opened, with its latest
 * values, in item-id order. An item no longer on the device (it can't be, but just in case) is left out.
 */
export function countsRows(changes: readonly HelperChange[], items: ReadonlyMap<string, Item>): CountsRow[] {
  const rows: CountsRow[] = [];
  for (const c of changes) {
    if (c.kind !== 'item') continue;
    const item = items.get(c.itemId);
    if (!item) continue;
    rows.push({
      item_id: item.id,
      on_hand: c.counted ? String(item.onHand) : '',
      counted_at: c.counted ? item.lastCounted : '',
      location: c.location ? item.location : '',
      barcode: c.barcode ? item.barcode : '',
      outside_assignment: c.outside ? 'yes' : '',
    });
  }
  return rows.sort((a, b) => (a.item_id < b.item_id ? -1 : a.item_id > b.item_id ? 1 : 0));
}

/** What the Send screen lists (11c). */
export interface SendSummary {
  counted: number;
  locationChanges: number;
  barcodes: number;
  newLocations: number;
  newItems: number;
  outside: number;
}

export function sendSummary(changes: readonly HelperChange[]): SendSummary {
  const items = changes.filter((c): c is Extract<HelperChange, { kind: 'item' }> => c.kind === 'item');
  return {
    counted: items.filter((c) => c.counted).length,
    locationChanges: items.filter((c) => c.location).length,
    barcodes: items.filter((c) => c.barcode).length,
    newLocations: changes.filter((c) => c.kind === 'location').length,
    newItems: changes.filter((c) => c.kind === 'pending').length,
    outside: items.filter((c) => c.outside).length,
  };
}

/** Temporary id of a helper's new item (§18.3): `pending-<helper id>-<n>`, n from 1. */
export const pendingId = (helperId: string, n: number): string => `pending-${helperId}-${n}`;

/** A new item a helper added (§18.3), as kept on the helper and written to new-items.csv (§18.4). */
export interface PendingItem {
  id: string;
  name: string;
  category: string;
  subcategory: string;
  unit: string;
  onHand: number;
  desired: number;
  location: string;
  barcode: string;
  notes: string;
  /** Local date-time with offset: when it was counted (saved). */
  countedAt: string;
  /** Vendor option 1, or null when none was given. Price in cents, or null. */
  vendor: { supplier: string; partNo: string; url: string; packSize: number; packPriceCents: number | null } | null;
  hasPhoto: boolean;
}

/** A pending item with the helper it came from: on the helper, in new-items.csv, and on the shop tablet until decided (§18.5). */
export type PendingRecord = PendingItem & { helperId: string; helperName: string };

/** The Add item form as typed. */
export interface PendingDraft {
  name: string;
  category: string;
  /** An existing subcategory, or ''. */
  subcategory: string;
  /** A subcategory typed in, or null when an existing one (or none) is picked. */
  newSubcategory: string | null;
  unit: string;
  onHand: string;
  desired: string;
  /** A name from the Location list, or ''. */
  location: string;
  barcode: string;
  notes: string;
  supplier: string;
  partNo: string;
  url: string;
  packSize: string;
  price: string;
}

export function blankPendingDraft(category = '', barcode = ''): PendingDraft {
  return { name: '', category, subcategory: '', newSubcategory: null, unit: 'each', onHand: '', desired: '0', location: '', barcode, notes: '', supplier: '', partNo: '', url: '', packSize: '1', price: '' };
}

export interface PendingContext {
  id: string;
  countedAt: string;
  categories: readonly Category[];
  locations: readonly Location[];
  supplierNames: readonly string[];
  /** Items on the device: a barcode already on one of them is refused (count that item instead). */
  items: readonly Item[];
}

export type PendingCheck = { ok: true; item: PendingItem } | { ok: false; errors: Partial<Record<keyof PendingDraft | 'vendor', string>> };

/**
 * Checks the Add item form (§18.3). Required: name, category, unit, on hand. Optional:
 * subcategory (existing or new), location, barcode, notes, desired (default 0), vendor option 1
 * (supplier from the list, part #, link, pack size, price). Names take the lists' spelling.
 */
export function checkPendingItem(d: PendingDraft, ctx: PendingContext): PendingCheck {
  const errors: Partial<Record<keyof PendingDraft | 'vendor', string>> = {};
  const name = d.name.trim();
  if (name === '') errors.name = 'Name is required.';
  const cat = ctx.categories.find((c) => nameKey(c.name) === nameKey(d.category));
  if (!cat) errors.category = 'Choose a category.';
  let subcategory = '';
  if (d.newSubcategory !== null) {
    const typed = d.newSubcategory.trim();
    if (typed === '') errors.newSubcategory = 'Type a name for the new subcategory, or pick one from the list.';
    else subcategory = cat?.subcategories.find((s) => nameKey(s) === nameKey(typed)) ?? typed;
  } else if (d.subcategory.trim() !== '') {
    const listed = cat?.subcategories.find((s) => nameKey(s) === nameKey(d.subcategory));
    if (listed) subcategory = listed;
    else errors.subcategory = 'Choose a subcategory from the list.';
  }
  const unit = d.unit.trim();
  if (unit === '') errors.unit = 'Choose a unit.';
  let onHand = 0;
  if (d.onHand.trim() === '') errors.onHand = 'On hand is required: how many are here?';
  else {
    const p = parseWholeNumber(d.onHand, 'On hand');
    if (p.ok) onHand = p.value;
    else errors.onHand = `${p.error}.`;
  }
  let desired = 0;
  if (d.desired.trim() !== '') {
    const p = parseWholeNumber(d.desired, 'Desired');
    if (p.ok) desired = p.value;
    else errors.desired = `${p.error}.`;
  }
  let location = '';
  if (d.location.trim() !== '') {
    const loc = ctx.locations.find((l) => nameKey(l.name) === nameKey(d.location));
    if (loc) location = loc.name;
    else errors.location = 'Choose a location from the list, or add it with New location….';
  }
  const barcode = cleanCode(d.barcode);
  if (barcode !== '') {
    if (barcode.toLowerCase().startsWith(QR_PREFIX)) errors.barcode = 'That’s a team QR label, not a manufacturer barcode.';
    else {
      const other = ctx.items.find((i) => i.barcode !== '' && barcodeKey(i.barcode) === barcodeKey(barcode));
      if (other) errors.barcode = `This barcode is already on “${other.name}”. Count that item instead.`;
    }
  }

  // Vendor option 1 is optional; any field filled in means one is given, and then it needs a supplier.
  let vendor: PendingItem['vendor'] = null;
  const vendorTyped = [d.supplier, d.partNo, d.url, d.price].some((s) => s.trim() !== '');
  if (vendorTyped) {
    const known = ctx.supplierNames.find((s) => nameKey(s) === nameKey(d.supplier));
    if (d.supplier.trim() === '') errors.supplier = 'Choose a supplier, or leave the vendor fields empty.';
    else if (!known) errors.supplier = `Supplier “${d.supplier.trim()}” isn’t in the list.`;
    const ps = d.packSize.trim() === '' ? '1' : d.packSize.trim();
    const packSize = /^\d+$/.test(ps) ? Number(ps) : NaN;
    if (!(Number.isSafeInteger(packSize) && packSize >= 1)) errors.packSize = 'Pack size must be a whole number of 1 or more.';
    const price = parsePrice(d.price);
    if (!price.ok) errors.price = `${price.error.charAt(0).toUpperCase()}${price.error.slice(1)}.`;
    const url = normalizeUrl(d.url, 'link');
    if (!url.ok) errors.url = `${url.error.charAt(0).toUpperCase()}${url.error.slice(1)}.`;
    if (known && Number.isSafeInteger(packSize) && price.ok && url.ok) vendor = { supplier: known, partNo: d.partNo.trim(), url: url.url, packSize, packPriceCents: price.cents };
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    item: { id: ctx.id, name, category: cat!.name, subcategory, unit, onHand, desired, location, barcode, notes: d.notes.trim(), countedAt: ctx.countedAt, vendor, hasPhoto: false },
  };
}

/** new-items.csv columns (§18.4). */
export const NEW_ITEMS_COLUMNS = [
  'pending_id',
  'name',
  'category',
  'subcategory',
  'unit',
  'on_hand',
  'desired',
  'location',
  'barcode',
  'notes',
  'photo_file',
  'counted_at',
  'v1_supplier',
  'v1_part_no',
  'v1_url',
  'v1_pack_size',
  'v1_pack_price',
] as const;
