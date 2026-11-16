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

/**
 * Why a product is left out, or null to keep it (Dan, 2026-11-16: no discontinued products and no
 * bundles; a part that comes in several sizes or ratings is kept, one row per size or rating).
 * Discontinued is AndyMark's own "Discontinued" tag. A bundle is a product whose type or a tag says
 * "bundle", or whose title says bundle, kit, builder or combo: those hold several different products.
 * A "pack" of the same part is not a bundle. Pass { discontinued: true } or { bundles: true } to keep them.
 * { maxVariants: N } also leaves out a product with more than N variants (a configurator such as a swerve
 * module with ratio, wheel and encoder choices makes hundreds of rows); 0, the default, keeps them all.
 */
export function exclusionReason(product, { discontinued = false, bundles = false, maxVariants = 0 } = {}) {
  const tags = Array.isArray(product?.tags) ? product.tags.map((t) => String(t)) : [];
  if (!discontinued && tags.some((t) => t.trim().toLowerCase() === 'discontinued')) return 'discontinued';
  if (!bundles) {
    const type = String(product?.product_type ?? '');
    if (/\bbundles?\b/i.test(type) || tags.some((t) => /\bbundles?\b/i.test(t))) return 'bundle';
    if (/\b(bundles?|kits?|builder|combo)\b/i.test(String(product?.title ?? ''))) return 'bundle or kit';
  }
  const count = Array.isArray(product?.variants) ? product.variants.length : 0;
  if (maxVariants > 0 && count > maxVariants) return `too many variants (${count})`;
  return null;
}

/** Product types that are not parts at all; left out of the file. */
export const SKIP_TYPES = new Set(['gift card', 'gift cards', 'shipping', 'donation', 'donations', 'service', 'services']);

/**
 * The team's category for a vendor product type. AndyMark's feed has only a flat product type (its 215
 * collections have no parent/child structure), so a type the table doesn't know keeps the vendor's own
 * name as the subcategory under Misc, and the script lists it so it can be mapped.
 * @returns {{ category: string, subcategory: string, mapped: boolean }}
 */
export function mapCategory(productType) {
  const type = String(productType ?? '').trim();
  const hit = CATEGORY_MAP[type.toLowerCase()];
  return hit ? { category: hit[0], subcategory: hit[1], mapped: true } : { category: 'Misc', subcategory: type, mapped: false };
}

/** Photos: a product's first image, asked for at most this wide (Shopify's CDN resizes with ?width=). */
export const IMAGE_WIDTH = 1024;

/** The first image's address with the size asked for, and the file name it gets in the ZIP; null when none. */
export function imageFor(product) {
  const src = String(product?.images?.[0]?.src ?? '').trim();
  if (!/^https:\/\//i.test(src)) return null;
  const ext = (/\.(jpe?g|png|webp)(?:\?|$)/i.exec(src)?.[1] ?? 'jpg').toLowerCase().replace('jpeg', 'jpg');
  const stem = String(product.handle ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
  if (stem === '') return null;
  return { url: `${src}${src.includes('?') ? '&' : '?'}width=${IMAGE_WIDTH}`, file: `photos/${stem}.${ext}` };
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
export function productRows(products, today, { images = false, discontinued = false, bundles = false, maxVariants = 0 } = {}) {
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
    const why = exclusionReason(p, { discontinued, bundles, maxVariants });
    if (why) {
      skipped.push({ title, reason: why });
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
    const image = images ? imageFor(p) : null;
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
        ...(images ? { photo_file: image?.file ?? '', _image_url: image?.url ?? '' } : {}),
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

/**
 * The catalog ZIP (inventory.csv, categories.csv, suppliers.csv), ready for Add items from a file.
 * `photos` (file name in the ZIP → bytes) is empty unless the script was asked for images; the
 * photo_file column is written only when some row has a photo.
 */
export async function buildCatalogZip(rows, photos = new Map()) {
  const zip = new JSZip();
  const columns = rows.some((r) => r.photo_file) ? [...COLUMNS, 'photo_file'] : COLUMNS;
  zip.file('inventory.csv', toCsv(columns, rows));
  for (const [file, bytes] of photos) zip.file(file, bytes);
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
