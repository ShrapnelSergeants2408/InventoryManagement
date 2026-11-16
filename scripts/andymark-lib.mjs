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
  // The product types AndyMark actually uses (seen in its feed, 2026-11-16).
  'brackets & plates': ['Mechanical', 'Brackets & Plates'],
  'cables & wires': ['Electrical', 'Cables/Wires'],
  'machine keys': ['Mechanical', 'Keys'],
  encoders: ['Electrical', 'Sensors'],
  'inertial measurement unit (imu) - gyroscope - accelerometer': ['Electrical', 'Sensors'],
  vision: ['Electrical', 'Cameras'],
  'batteries & chargers': ['Electrical', 'Batteries'],
  'fuses breakers & distribution': ['Electrical', 'Power Distribution'],
  gearmotors: ['Electrical', 'Motors'],
  'metal & plastic sheet': ['Mechanical', 'Sheet Material'],
  'traction wheels': ['Mechanical', 'Wheels'],
  'mecanum & omni wheels': ['Mechanical', 'Wheels'],
  tread: ['Mechanical', 'Wheels'],
  'rollers & casters': ['Mechanical', 'Wheels'],
  'collar clamps': ['Mechanical', 'Collars'],
  'shaft adapters': ['Mechanical', 'Adapters'],
  standoffs: ['Mechanical', 'Spacers'],
  'extrusion & structure': ['Mechanical', 'Structure'],
  'bumpers & accessories': ['Mechanical', 'Bumpers'],
  'retaining clips': ['Fasteners', 'Retaining Clips'],
  'pneumatics fittings': ['Pneumatics', 'Fittings'],
  'pneumatic accumulation': ['Pneumatics', 'Accumulation'],
  'pneumatic cylinders': ['Pneumatics', 'Cylinders'],
  'solenoids & controllers': ['Pneumatics', 'Solenoids'],
  'planetary gearboxes': ['Power Transfer', 'Gear Boxes'],
  'spur gearboxes': ['Power Transfer', 'Gear Boxes'],
  'banebots gearboxes and parts': ['Power Transfer', 'Gear Boxes'],
  // Complete units (SPEC §11 Assemblies): swerve modules, and anything titled "in a Box", "Assembly" or "Cart".
  'swerve modules': ['Assemblies', ''],
  'swerve drive specialties': ['Assemblies', ''],
};

/** A single assembly, sold complete: a title that ends "in a Box", "Assembly" or "Cart" ("Climber in a Box", "Turret Assembly"), not a "kit" of parts and not a part for one ("Launcher in a Box Side Plate"). */
export const isAssembly = (title) => /\b(in a box|assembly|cart)\s*$/i.test(String(title ?? '').trim()) && !/\bkits?\b/i.test(String(title ?? ''));

const TAG_COMBINED_PARENT = /^combined listing parent$/i;
const TAG_COMBINED = /^combinedlisting-/i;
const OTHER_PROGRAMS = /\b(FTC|FIRST® Tech Challenge)\b|\bLEGO\b|\bFLL\b|\bRobits\b/i;
const FRC = /\bFRC\b|FIRST® Robotics Competition/i;

/** A product AndyMark groups as a "combined listing": the parent lists every option combination as a variant. */
export const isCombinedParent = (product) => (Array.isArray(product?.tags) ? product.tags : []).some((t) => TAG_COMBINED_PARENT.test(String(t).trim()));

/**
 * Why a product is left out, or null to keep it. Dan, 2026-11-16: no discontinued products, no
 * bundles, no tools, no merchandise, game pieces or pre-orders, no parts shipped from outside the US,
 * no FTC, FLL or Robits products unless also tagged FRC; a part that comes in several
 * sizes or ratings is kept, one row each; assemblies ("Climber in a Box") come in.
 *  - discontinued: AndyMark's own "Discontinued" tag.
 *  - ftc, fll or robits: the type, a tag or the title names one of those programs, and no tag or type
 *    says FRC (a tag like "Release - 2026 Other FRC Kickoff" counts as FRC).
 *  - tool: the type or a tag says "tools" (AndyMark's own "Mechanical Tools", "Electrical Tools").
 *  - part of a combined listing: a child product of a swerve module or gearbox listing. The parent lists
 *    every option combination already (and is collapsed to one row), so the child would repeat it.
 *  - bundle: the type or a tag says "bundle", or the title says bundle, kit, builder or combo (those hold
 *    several different products). A single assembly ("in a Box", "Assembly", "Cart") is not left out for
 *    that, unless its title also says kit. A "pack" of the same part is not a bundle.
 *  - outside the US, merchandise, game piece or pre-order: see isOutsideUS, isGameItem, and a type of "Merchandise".
 * `include` is a Set of 'discontinued', 'international', 'merchandise', 'game', 'programs' (FTC, FLL, Robits),
 * 'tools' and 'bundles': the groups to keep anyway.
 */
export function exclusionReason(product, { include = new Set() } = {}) {
  const tags = Array.isArray(product?.tags) ? product.tags.map((t) => String(t)) : [];
  const type = String(product?.product_type ?? '');
  const title = String(product?.title ?? '');
  const mentions = (re) => re.test(type) || tags.some((t) => re.test(t));
  if (!include.has('discontinued') && tags.some((t) => t.trim().toLowerCase() === 'discontinued')) return 'discontinued';
  if (!include.has('international') && isOutsideUS(product)) return 'outside the US';
  if (!include.has('programs') && (mentions(OTHER_PROGRAMS) || /\bRobits\b/i.test(title)) && !mentions(FRC)) return 'ftc, fll or robits';
  if (!include.has('merchandise') && /\bmerchandise\b/i.test(type)) return 'merchandise';
  if (!include.has('game') && isGameItem(product)) return 'game piece or pre-order';
  if (!include.has('tools') && mentions(/\btools?\b/i)) return 'tool';
  if (tags.some((t) => TAG_COMBINED.test(t.trim())) && !isCombinedParent(product)) return 'part of a combined listing';
  if (!include.has('bundles')) {
    if (!isAssembly(title)) {
      if (mentions(/\bbundles?\b/i)) return 'bundle';
      if (/\b(bundles?|kits?|builder|combo)\b/i.test(title)) return 'bundle or kit';
    }
  }
  return null;
}

/**
 * Parts that ship from outside the US (Dan, 2026-11-16): AndyMark's Australian store lists its parts as
 * "Ships from Sydney - <title>", with part numbers ending in AUS. Either marker is enough.
 */
export function isOutsideUS(product) {
  const variants = Array.isArray(product?.variants) ? product.variants : [];
  return /^ships from\b/i.test(String(product?.title ?? '').trim()) || (variants.length > 0 && variants.every((v) => /AUS$/.test(String(v?.sku ?? '').trim())));
}

/**
 * Game pieces and pre-orders (Dan, 2026-11-16): a product type that names a season or a year ("FIRST®
 * Robotics Competition 2026 REBUILT™", "2027 FIRST® … season BIOCORE™"), or a title that says game piece,
 * scoring element, pre-order or field carpet.
 */
export function isGameItem(product) {
  return /\b(19|20)\d\d\b|\bseason\b/i.test(String(product?.product_type ?? '')) || /\b(game pieces?|scoring elements?|pre-?orders?|field carpet)\b/i.test(String(product?.title ?? ''));
}

/** A product with more than this many variants is listed once, as "(multiple variants)" (Dan, 2026-11-16: 65). */
export const COLLAPSE_OVER = 65;

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
export function productRows(products, today, { images = false, include = new Set(), collapseOver = COLLAPSE_OVER } = {}) {
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
    const why = exclusionReason(p, { include });
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
    // A complete assembly goes under Assemblies whatever AndyMark calls its type.
    const { category, subcategory, mapped } = isAssembly(title) ? { category: 'Assemblies', subcategory: '', mapped: true } : mapCategory(type);
    if (!mapped) unmapped.set(type === '' ? '(no type)' : type, (unmapped.get(type === '' ? '(no type)' : type) ?? 0) + 1);
    const many = variants.length > 1;
    const image = images ? imageFor(p) : null;
    const photo = images ? { photo_file: image?.file ?? '', _image_url: image?.url ?? '' } : {};
    // A configurator (a swerve module with ratio, wheel and encoder choices; a gearbox with ratio, shaft
    // and hardware choices) is one row, not hundreds: AndyMark's combined-listing parents, and any product
    // with more than `collapseOver` variants (Dan, 2026-11-16). Its part number is left blank, the price is
    // the lowest of its variants, and the notes say so.
    if (many && collapseOver > 0 && variants.length > collapseOver) {
      const prices = variants.map((v) => Number(priceText(v?.price))).filter((n) => n > 0);
      const options = (Array.isArray(p.options) ? p.options : []).map((o) => String(o?.name ?? '').trim()).filter((n) => n !== '' && n.toLowerCase() !== 'title');
      rows.push({
        name: `${title} (multiple variants)`,
        category,
        subcategory,
        unit: 'each',
        preferred_vendor: '1',
        v1_supplier: SUPPLIER,
        v1_part_no: '',
        v1_url: `${SITE}/products/${handle}`,
        v1_pack_size: '1',
        v1_pack_price: prices.length > 0 ? Math.min(...prices).toFixed(2) : '',
        v1_price_checked: today,
        notes: `${variants.length} variants${options.length > 0 ? ` (${options.join(', ')})` : ''}; choose on the product page.${prices.length > 0 ? ' The price is the lowest of them.' : ''}`,
        ...photo,
      });
      continue;
    }
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
        notes: '',
        ...photo,
      });
    }
  }
  return { rows, skipped, unmapped };
}

export const COLUMNS = ['name', 'category', 'subcategory', 'unit', 'notes', 'preferred_vendor', 'v1_supplier', 'v1_part_no', 'v1_url', 'v1_pack_size', 'v1_pack_price', 'v1_price_checked'];

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
