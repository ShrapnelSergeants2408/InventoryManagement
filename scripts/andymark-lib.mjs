// AndyMark catalog script, the parts that need no network (SPEC §23.7). Facts only: product name,
// part number (SKU), price, product page and category. Never photos or descriptions (Dan, 2026-11-16,
// after the terms check recorded in SPEC §23.7).
//
// AndyMark's store publishes its catalog as public JSON at /products.json (a Shopify store). The
// command-line script (andymark-catalog.mjs) fetches it politely; everything else is here so it can be
// tested offline.
import JSZip from 'jszip';

export const SUPPLIER = 'AndyMark';
export const SITE = 'https://www.andymark.com';

/**
 * AndyMark product type (lower case) → [category, subcategory] in the team's categories (SPEC §11).
 * A type that isn't here goes to Misc; the script prints the types it couldn't place so this table can
 * grow. Edit it freely: it is the only place the team's structure meets AndyMark's.
 */
export const CATEGORY_MAP = {
  bushings: ['Mechanical', 'Bushings'],
  bearings: ['Mechanical', 'Bearings'],
  wheels: ['Mechanical', 'Wheels'],
  spacers: ['Mechanical', 'Spacers'],
  hubs: ['Mechanical', 'Hubs'],
  collars: ['Mechanical', 'Collars'],
  keys: ['Mechanical', 'Keys'],
  shafts: ['Mechanical', 'Shafts'],
  adapters: ['Mechanical', 'Adapters'],
  tubing: ['Mechanical', 'Structure'],
  'aluminum tube': ['Mechanical', 'Structure'],
  'sheet material': ['Mechanical', 'Sheet Material'],
  brackets: ['Mechanical', 'Brackets & Plates'],
  plates: ['Mechanical', 'Brackets & Plates'],
  bumpers: ['Mechanical', 'Bumpers'],
  nuts: ['Fasteners', 'Nuts'],
  bolts: ['Fasteners', 'Bolts'],
  screws: ['Fasteners', 'Screws'],
  washers: ['Fasteners', 'Washers'],
  rivets: ['Fasteners', 'Rivets'],
  pins: ['Fasteners', 'Pins'],
  'retaining rings': ['Fasteners', 'Retaining Clips'],
  'cable ties': ['Fasteners', 'Cable Ties'],
  gears: ['Power Transfer', 'Gears'],
  sprockets: ['Power Transfer', 'Sprockets'],
  pulleys: ['Power Transfer', 'Pulleys'],
  belts: ['Power Transfer', 'Belts'],
  chain: ['Power Transfer', 'Chains'],
  gearboxes: ['Power Transfer', 'Gear Boxes'],
  'gear boxes': ['Power Transfer', 'Gear Boxes'],
  motors: ['Electrical', 'Motors'],
  batteries: ['Electrical', 'Batteries'],
  connectors: ['Electrical', 'Connectors'],
  cables: ['Electrical', 'Cables/Wires'],
  wire: ['Electrical', 'Cables/Wires'],
  sensors: ['Electrical', 'Sensors'],
  cameras: ['Electrical', 'Cameras'],
  'speed controllers': ['Electrical', 'Speed Controllers'],
  servos: ['Electrical', 'Servos'],
  cylinders: ['Pneumatics', 'Cylinders'],
  fittings: ['Pneumatics', 'Fittings'],
  solenoids: ['Pneumatics', 'Solenoids'],
  compressors: ['Pneumatics', 'Compressors'],
  'pneumatic tubing': ['Pneumatics', 'Tubing'],
  'safety glasses': ['Safety', 'Safety Glasses'],
  gloves: ['Safety', 'Gloves'],
  tools: ['Tools', 'Specialty Tools'],
  wrenches: ['Tools', 'Wrenches'],
};

/** Product types that are not parts at all; left out of the file. */
export const SKIP_TYPES = new Set(['gift card', 'gift cards', 'shipping', 'donation', 'donations', 'service', 'services']);

/** @returns {{ category: string, subcategory: string, mapped: boolean }} */
export function mapCategory(productType) {
  const hit = CATEGORY_MAP[String(productType ?? '').trim().toLowerCase()];
  return hit ? { category: hit[0], subcategory: hit[1], mapped: true } : { category: 'Misc', subcategory: '', mapped: false };
}

/** "9.00" → "9.00"; "1,234.5" → "1234.50"; zero, blank or not a number → '' (no price). */
export function priceText(raw) {
  const n = Number(String(raw ?? '').replace(/[$,\s]/g, ''));
  return Number.isFinite(n) && n > 0 ? n.toFixed(2) : '';
}

/**
 * One row per variant of each product. Reads only title, handle, product_type and each variant's
 * title, sku, price and id; nothing else in the feed is touched.
 * @returns {{ rows: object[], skipped: { title: string, reason: string }[], unmapped: Map<string, number> }}
 */
export function productRows(products, today) {
  const rows = [];
  const skipped = [];
  const unmapped = new Map();
  for (const p of products ?? []) {
    const title = String(p?.title ?? '').trim();
    const type = String(p?.product_type ?? '').trim();
    if (title === '') {
      skipped.push({ title: '(no title)', reason: 'no title' });
      continue;
    }
    if (SKIP_TYPES.has(type.toLowerCase())) {
      skipped.push({ title, reason: `not a part (${type})` });
      continue;
    }
    const handle = String(p?.handle ?? '').trim();
    if (handle === '') {
      skipped.push({ title, reason: 'no product page' });
      continue;
    }
    const variants = Array.isArray(p.variants) ? p.variants : [];
    if (variants.length === 0) {
      skipped.push({ title, reason: 'no variants' });
      continue;
    }
    const { category, subcategory, mapped } = mapCategory(type);
    if (!mapped) unmapped.set(type === '' ? '(no type)' : type, (unmapped.get(type === '' ? '(no type)' : type) ?? 0) + 1);
    const many = variants.length > 1;
    for (const v of variants) {
      const vt = String(v?.title ?? '').trim();
      const label = many && vt !== '' && vt.toLowerCase() !== 'default title' ? ` - ${vt}` : '';
      rows.push({
        name: title + label,
        category,
        subcategory,
        unit: 'each',
        preferred_vendor: '1',
        v1_supplier: SUPPLIER,
        v1_part_no: String(v?.sku ?? '').trim(),
        v1_url: `${SITE}/products/${handle}${many && v?.id ? `?variant=${v.id}` : ''}`,
        v1_pack_size: '1',
        v1_pack_price: priceText(v?.price),
        v1_price_checked: today,
      });
    }
  }
  return { rows, skipped, unmapped };
}

export const COLUMNS = ['name', 'category', 'subcategory', 'unit', 'preferred_vendor', 'v1_supplier', 'v1_part_no', 'v1_url', 'v1_pack_size', 'v1_pack_price', 'v1_price_checked'];

const cell = (s) => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
export const toCsv = (columns, rows) => '﻿' + [columns.join(','), ...rows.map((r) => columns.map((c) => cell(String(r[c] ?? ''))).join(','))].join('\r\n') + '\r\n';

/** The categories.csv for the categories and subcategories the rows use, in the order they first appear. */
export function categoriesCsv(rows) {
  const cats = new Map();
  for (const r of rows) {
    if (!cats.has(r.category)) cats.set(r.category, new Set());
    if (r.subcategory !== '') cats.get(r.category).add(r.subcategory);
  }
  const out = [];
  let order = 1;
  for (const [c, subs] of cats) {
    out.push({ category: c, subcategory: '', order: String(order) });
    let n = 1;
    for (const s of subs) out.push({ category: c, subcategory: s, order: String(n++) });
    order++;
  }
  return toCsv(['category', 'subcategory', 'order'], out);
}

export const suppliersCsv = () => toCsv(['name', 'website', 'notes'], [{ name: SUPPLIER, website: SITE, notes: '' }]);

/** The catalog ZIP (inventory.csv, categories.csv, suppliers.csv; no photos), ready for Add items from a file. */
export async function buildCatalogZip(rows) {
  const zip = new JSZip();
  zip.file('inventory.csv', toCsv(COLUMNS, rows));
  zip.file('categories.csv', categoriesCsv(rows));
  zip.file('suppliers.csv', suppliersCsv());
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

/**
 * robots.txt check for the groups that apply to everyone ("User-agent: *"): the longest matching
 * Allow or Disallow wins, Allow on a tie. Anything unreadable counts as allowed, as the standard says.
 */
export function robotsAllows(text, path) {
  let inStar = false;
  let prevWasAgent = false;
  const rules = [];
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    if (line === '') continue;
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === 'user-agent') {
      inStar = prevWasAgent ? inStar || value === '*' : value === '*';
      prevWasAgent = true;
      continue;
    }
    prevWasAgent = false;
    if (inStar && (key === 'allow' || key === 'disallow') && value !== '') rules.push({ allow: key === 'allow', value });
  }
  let best = null;
  for (const r of rules) {
    const pattern = r.value.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$');
    if (!new RegExp('^' + pattern).test(path)) continue;
    if (!best || r.value.length > best.value.length || (r.value.length === best.value.length && r.allow)) best = r;
  }
  return best ? best.allow : true;
}
