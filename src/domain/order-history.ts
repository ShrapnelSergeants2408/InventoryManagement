// Order history and spending (F32, §21.5): date ranges by placed date (inclusive), the
// supplier and status filters, and the spending summaries by supplier and by category.
// Money is whole cents. Cancelled orders are listed but never counted in a summary.
import { localIsoDate } from './dates';
import { isOpen, lineTotalCents, orderStatus, orderTotals, sortOrders, type PlacedOrder } from './placed-orders';
import { nameKey, type Category } from './types';

export type RangeKind = 'month' | 'last30' | 'season' | 'schoolYear' | 'lastSchoolYear' | 'custom';

export const RANGE_KINDS: readonly RangeKind[] = ['month', 'last30', 'season', 'schoolYear', 'lastSchoolYear', 'custom'];

export const RANGE_LABEL: Record<RangeKind, string> = {
  month: 'This month',
  last30: 'Last 30 days',
  season: 'This season',
  schoolYear: 'This school year',
  lastSchoolYear: 'Last school year',
  custom: 'Custom',
};

/** The range a device starts on before one is chosen. */
export const DEFAULT_RANGE: RangeKind = 'schoolYear';

/** Default school year start (§21.5): August 1. */
export const DEFAULT_SCHOOL_YEAR_START = '08-01';

export interface HistorySettings {
  /** YYYY-MM-DD, or '' when not set ("This season" is hidden). */
  seasonStart: string;
  /** MM-DD. */
  schoolYearStart: string;
}

/** From and To, YYYY-MM-DD, both included. */
export interface DateRange {
  from: string;
  to: string;
}

const p2 = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number) => `${y}-${p2(m)}-${p2(d)}`;

function parts(date: string): [number, number, number] {
  return date.split('-').map(Number) as [number, number, number];
}

/** The date `days` after (or before, when negative) a YYYY-MM-DD date. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = parts(date);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return iso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** A real month and day, MM-DD. February 29 isn't allowed: it isn't in every year. */
export function isMonthDay(s: string): boolean {
  const m = /^(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [mo, d] = [Number(m[1]), Number(m[2])];
  const t = new Date(Date.UTC(2025, mo - 1, d));
  // A day the month doesn't have rolls into the next month, so its date changes.
  return mo >= 1 && mo <= 12 && t.getUTCDate() === d;
}

/** The latest school-year start on or before `today`. */
export function schoolYearStartOn(today: string, monthDay: string): string {
  const md = isMonthDay(monthDay) ? monthDay : DEFAULT_SCHOOL_YEAR_START;
  const [y] = parts(today);
  const thisYear = `${y}-${md}`;
  return thisYear <= today ? thisYear : `${y - 1}-${md}`;
}

/**
 * The dates a range covers, both included, or null when it can't be worked out: "This season"
 * with no season start set, or a custom range with a date missing.
 */
export function rangeDates(kind: RangeKind, today: string, s: HistorySettings, custom: DateRange = { from: '', to: '' }): DateRange | null {
  const [y, m] = parts(today);
  switch (kind) {
    case 'month':
      return { from: iso(y, m, 1), to: today };
    case 'last30':
      return { from: addDays(today, -29), to: today };
    case 'season':
      return s.seasonStart ? { from: s.seasonStart, to: today } : null;
    case 'schoolYear':
      return { from: schoolYearStartOn(today, s.schoolYearStart), to: today };
    case 'lastSchoolYear': {
      const start = schoolYearStartOn(today, s.schoolYearStart);
      const [sy] = parts(start);
      return { from: `${sy - 1}${start.slice(4)}`, to: addDays(start, -1) };
    }
    case 'custom':
      if (!custom.from || !custom.to) return null;
      return custom.from <= custom.to ? { ...custom } : { from: custom.to, to: custom.from };
  }
}

/** The ranges offered: "This season" only once its start is set. */
export const offeredRanges = (s: HistorySettings) => RANGE_KINDS.filter((k) => k !== 'season' || s.seasonStart !== '');

export type StatusFilter = 'all' | 'open' | 'received' | 'cancelled';

export const STATUS_FILTERS: readonly StatusFilter[] = ['all', 'open', 'received', 'cancelled'];

export const STATUS_FILTER_LABEL: Record<StatusFilter, string> = { all: 'All', open: 'Open', received: 'Received', cancelled: 'Cancelled' };

export interface HistoryFilters {
  /** A supplier name, or null for any; compared ignoring capitals. */
  supplier: string | null;
  status: StatusFilter;
}

export const inRange = (o: Pick<PlacedOrder, 'placedOn'>, r: DateRange) => o.placedOn >= r.from && o.placedOn <= r.to;

const matchesSupplier = (o: Pick<PlacedOrder, 'supplier'>, supplier: string | null) => supplier === null || nameKey(o.supplier) === nameKey(supplier);

export function matchesStatus(o: PlacedOrder, status: StatusFilter): boolean {
  if (status === 'all') return true;
  if (status === 'open') return isOpen(o);
  return orderStatus(o) === status;
}

/** The orders listed: in the range, of the supplier, with the status; newest first. */
export function historyOrders(orders: readonly PlacedOrder[], r: DateRange, f: HistoryFilters): PlacedOrder[] {
  return sortOrders(orders.filter((o) => inRange(o, r) && matchesSupplier(o, f.supplier) && matchesStatus(o, f.status)));
}

/** The orders a summary counts: in the range, of the supplier, never cancelled (whatever the status filter). */
export function summaryOrders(orders: readonly PlacedOrder[], r: DateRange, supplier: string | null): PlacedOrder[] {
  return sortOrders(orders.filter((o) => !o.cancelled && inRange(o, r) && matchesSupplier(o, supplier)));
}

export interface Amounts {
  partsCents: number;
  discountCents: number;
  taxCents: number;
  shippingCents: number;
  feesCents: number;
  totalCents: number;
}

export interface SupplierRow extends Amounts {
  supplier: string;
  orders: number;
}

export interface CategoryRow {
  /** The category as the list spells it, or as the line has it when no longer in the list; "Other" for typed lines. */
  category: string;
  partsCents: number;
}

export interface SpendingSummary {
  suppliers: SupplierRow[];
  /** The Total row of the supplier summary. */
  total: SupplierRow;
  /** Parts cost by category (§11 order, then old categories, then Other). */
  categories: CategoryRow[];
}

export const OTHER_CATEGORY = 'Other';

const zero = (): Amounts => ({ partsCents: 0, discountCents: 0, taxCents: 0, shippingCents: 0, feesCents: 0, totalCents: 0 });

function add(a: Amounts, b: Amounts): void {
  a.partsCents += b.partsCents;
  a.discountCents += b.discountCents;
  a.taxCents += b.taxCents;
  a.shippingCents += b.shippingCents;
  a.feesCents += b.feesCents;
  a.totalCents += b.totalCents;
}

/**
 * The spending summary (§21.5) over orders already chosen by `summaryOrders`. Suppliers are in
 * name order, each named as on its newest order. Categories follow the category list; a line's
 * category no longer in the list comes after them (in name order); typed lines are "Other".
 */
export function spendingSummary(orders: readonly PlacedOrder[], categories: readonly Category[]): SpendingSummary {
  const bySupplier = new Map<string, SupplierRow>();
  const total: SupplierRow = { supplier: 'Total', orders: 0, ...zero() };
  for (const o of sortOrders(orders)) {
    if (o.cancelled) continue;
    const key = nameKey(o.supplier);
    let row = bySupplier.get(key);
    if (!row) bySupplier.set(key, (row = { supplier: o.supplier, orders: 0, ...zero() }));
    const t = orderTotals(o);
    row.orders++;
    total.orders++;
    add(row, t);
    add(total, t);
  }
  const suppliers = [...bySupplier.values()].sort((a, b) => a.supplier.localeCompare(b.supplier, 'en', { sensitivity: 'base' }));

  const listed = [...categories].sort((a, b) => a.order - b.order);
  const listKey = new Map(listed.map((c) => [nameKey(c.name), c.name]));
  const parts = new Map<string, CategoryRow>();
  let other = 0;
  for (const o of orders) {
    if (o.cancelled) continue;
    for (const l of o.lines) {
      const cents = lineTotalCents(l);
      if (l.itemId === '' || l.category.trim() === '') {
        other += cents;
        continue;
      }
      const key = nameKey(l.category);
      let row = parts.get(key);
      if (!row) parts.set(key, (row = { category: listKey.get(key) ?? l.category.trim(), partsCents: 0 }));
      row.partsCents += cents;
    }
  }
  const inList = listed.flatMap((c) => parts.get(nameKey(c.name)) ?? []);
  const gone = [...parts.entries()].filter(([k]) => !listKey.has(k)).map(([, r]) => r).sort((a, b) => a.category.localeCompare(b.category, 'en', { sensitivity: 'base' }));
  const cats = [...inList, ...gone];
  if (other > 0 || orders.some((o) => !o.cancelled && o.lines.some((l) => l.itemId === '' || l.category.trim() === ''))) cats.push({ category: OTHER_CATEGORY, partsCents: other });
  return { suppliers, total, categories: cats };
}

/** The range for a file name or a heading: "This school year (2026-08-01 to 2026-10-29)". */
export function rangeText(kind: RangeKind, r: DateRange): string {
  return `${RANGE_LABEL[kind]} (${r.from} to ${r.to})`;
}

/** What the filters say, for a file's first row and the printed page. */
export function filtersText(f: HistoryFilters): string {
  return `Supplier: ${f.supplier ?? 'any'} · Status: ${STATUS_FILTER_LABEL[f.status].toLowerCase()}`;
}

/** Today on this tablet, for the ranges. */
export const today = (): string => localIsoDate();
