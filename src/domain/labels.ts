// QR label layouts and sheet geometry (SPEC §9). Layouts are data: another sheet can be
// added here without code changes. Sizes are in inches, nudges in millimetres.
//
// VERIFY AGAINST PACKAGE (SPEC §9, §15 Q2): the margins and pitches below come from the
// published Avery templates for 5160 and 5163. For 22805 the 4 × 6 grid of 1½ in squares
// is centred on the page. Check each against a real sheet with a test print before relying
// on it; the alignment nudge corrects small offsets.
import type { Item } from './types';

export type LabelContent = 'name-location' | 'name-location-part' | 'short-name' | 'name';

export interface LabelLayout {
  id: string;
  name: string;
  short: string;
  desc: string;
  cols: number;
  rows: number;
  /** Label width and height. */
  w: number;
  h: number;
  /** Top-left corner of the first label, from the page's top-left corner. */
  left: number;
  top: number;
  /** Distance from one label's left (top) edge to the next one's. */
  pitchX: number;
  pitchY: number;
  /** QR code side. */
  qr: number;
  content: LabelContent;
  /** QR beside the text (row) or above it (column). */
  flow: 'row' | 'column';
  /** Plain paper: no start position, dashed cut lines. */
  plain: boolean;
  /** Name text size in points; other lines are a little smaller. */
  textPt: number;
}

export const PAGE = { w: 8.5, h: 11 } as const;

export const SHEET_LAYOUTS: readonly LabelLayout[] = [
  { id: 'avery-5160', name: 'Avery 5160-compatible', short: 'Avery 5160', desc: '1 × 2⅝ in · 30 per sheet · small QR, name, location', cols: 3, rows: 10, w: 2.625, h: 1, left: 0.1875, top: 0.5, pitchX: 2.75, pitchY: 1, qr: 0.8, content: 'name-location', flow: 'row', plain: false, textPt: 8 },
  { id: 'avery-5163', name: 'Avery 5163-compatible', short: 'Avery 5163', desc: '2 × 4 in · 10 per sheet · large QR, name, location, part #', cols: 2, rows: 5, w: 4, h: 2, left: 0.15625, top: 0.5, pitchX: 4.1875, pitchY: 2, qr: 1.7, content: 'name-location-part', flow: 'row', plain: false, textPt: 13 },
  { id: 'avery-22805', name: 'Avery 22805-compatible', short: 'Avery 22805', desc: '1½ in square · 24 per sheet · QR, short name', cols: 4, rows: 6, w: 1.5, h: 1.5, left: 0.6875, top: 0.6875, pitchX: 1.875, pitchY: 1.625, qr: 1.05, content: 'short-name', flow: 'column', plain: false, textPt: 8 },
];

export const PLAIN_ID = 'plain';
export const PLAIN_QR_SIZES = [1, 1.5, 2] as const;
export type PlainQrSize = (typeof PLAIN_QR_SIZES)[number];

/** Printable area kept clear on plain paper (most printers can't print the outer ¼–½ in). */
const PLAIN_AREA = { w: 7.5, h: 10 };

/** Plain paper grid for a QR size: cells with the name under the QR, centred on the page. */
export function plainLayout(qr: PlainQrSize): LabelLayout {
  const w = qr + 0.6;
  const h = qr + 0.55;
  const cols = Math.floor(PLAIN_AREA.w / w);
  const rows = Math.floor(PLAIN_AREA.h / h);
  const label = qr === 1 ? '1' : qr === 1.5 ? '1½' : '2';
  return {
    id: PLAIN_ID,
    name: 'Plain paper grid',
    short: `plain paper, ${label} in QR`,
    desc: 'Any printer paper · QR 1, 1½ or 2 in · name · dashed cut lines',
    cols,
    rows,
    w,
    h,
    left: (PAGE.w - cols * w) / 2,
    top: (PAGE.h - rows * h) / 2,
    pitchX: w,
    pitchY: h,
    qr,
    content: 'name',
    flow: 'column',
    plain: true,
    textPt: qr === 1 ? 8 : 10,
  };
}

export function layoutById(id: string, plainQr: PlainQrSize = 1): LabelLayout | null {
  if (id === PLAIN_ID) return plainLayout(plainQr);
  return SHEET_LAYOUTS.find((l) => l.id === id) ?? null;
}

export const perSheet = (l: LabelLayout) => l.cols * l.rows;

// ── Alignment nudge (SPEC §9: 0.5 mm steps, saved per layout) ──

export interface Nudge {
  /** + moves everything down. */
  top: number;
  /** + moves everything right. */
  left: number;
}
export const NO_NUDGE: Nudge = { top: 0, left: 0 };
export const NUDGE_STEP_MM = 0.5;
export const NUDGE_MAX_MM = 10;

/** One nudge step; kept on the 0.5 mm grid and within ±10 mm. */
export function stepNudge(value: number, direction: 1 | -1): number {
  const next = Math.round((value + direction * NUDGE_STEP_MM) / NUDGE_STEP_MM) * NUDGE_STEP_MM;
  return Math.max(-NUDGE_MAX_MM, Math.min(NUDGE_MAX_MM, next)) + 0; // + 0 turns -0 into 0
}

/** A stored nudge, cleaned: unknown shapes and off-grid or out-of-range values are fixed. */
export function cleanNudge(v: unknown): Nudge {
  const o = (typeof v === 'object' && v !== null ? v : {}) as Record<string, unknown>;
  const fix = (x: unknown) => {
    if (typeof x !== 'number' || !Number.isFinite(x)) return 0;
    const snapped = Math.round(x / NUDGE_STEP_MM) * NUDGE_STEP_MM;
    return Math.max(-NUDGE_MAX_MM, Math.min(NUDGE_MAX_MM, snapped)) + 0;
  };
  return { top: fix(o.top), left: fix(o.left) };
}

export const mmToIn = (mm: number) => mm / 25.4;

// ── Sheets ──

/** A label position on a page, in inches, nudge included. */
export interface LabelBox {
  /** Position on its sheet, 0-based, numbered left to right then down (as on the package). */
  slot: number;
  row: number;
  col: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SheetPlan {
  /** Labels to print, page by page; label i of `count` is pages[p].labels[k] in order. */
  pages: { labels: LabelBox[]; skipped: LabelBox[] }[];
  /** First slot used on the first sheet (0 when starting at label 1). */
  start: number;
}

export function boxAt(l: LabelLayout, slot: number, nudge: Nudge = NO_NUDGE): LabelBox {
  const row = Math.floor(slot / l.cols);
  const col = slot % l.cols;
  return { slot, row, col, x: l.left + col * l.pitchX + mmToIn(nudge.left), y: l.top + row * l.pitchY + mmToIn(nudge.top), w: l.w, h: l.h };
}

/** Clamps a start position to the sheet; plain paper always starts at the first cell. */
export function clampStart(l: LabelLayout, start: number): number {
  if (l.plain || !Number.isInteger(start) || start < 0) return 0;
  return Math.min(start, perSheet(l) - 1);
}

/**
 * Lays out `count` labels. The first sheet skips `start` used labels (SPEC §9 start
 * position); later sheets start at label 1.
 */
export function planSheets(l: LabelLayout, count: number, start = 0, nudge: Nudge = NO_NUDGE): SheetPlan {
  const per = perSheet(l);
  const s = clampStart(l, start);
  const pages: SheetPlan['pages'] = [];
  let left = Math.max(0, Math.floor(count));
  let first = s;
  while (left > 0) {
    const n = Math.min(left, per - first);
    pages.push({
      labels: Array.from({ length: n }, (_, k) => boxAt(l, first + k, nudge)),
      skipped: Array.from({ length: first }, (_, k) => boxAt(l, k, nudge)),
    });
    left -= n;
    first = 0;
  }
  return { pages, start: s };
}

/** Number of sheets `count` labels need from start position `start`. */
export const sheetsNeeded = (l: LabelLayout, count: number, start = 0) => (count <= 0 ? 0 : Math.ceil((count + clampStart(l, start)) / perSheet(l)));

// ── Label text (SPEC §9 "Label content") ──

/** The text printed next to the QR: the name, then the extra lines the layout has room for. */
export function labelText(item: Item, content: LabelContent): { name: string; extra: string[] } {
  const extra: string[] = [];
  if (content === 'name-location' || content === 'name-location-part') {
    if (item.location) extra.push(item.location);
  }
  if (content === 'name-location-part') {
    const v = item.vendors[item.preferredVendor - 1] ?? item.vendors.find((x) => x !== null) ?? null;
    if (v?.partNo) extra.push(`${v.supplier} ${v.partNo}`);
  }
  return { name: item.name, extra };
}
