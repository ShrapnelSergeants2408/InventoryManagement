// What every vendor catalog script shares (SPEC §23.7): the CSV and ZIP the Add items from a file
// importer reads, the robots.txt check, pack sizes, category keywords, and the one-row-per-variant
// logic for stores built on Shopify (AndyMark, Thrifty Bot, CTRE). Nothing here uses the network.
import JSZip from 'jszip';

export const COLUMNS = ['name', 'category', 'subcategory', 'unit', 'notes', 'preferred_vendor', 'v1_supplier', 'v1_part_no', 'v1_url', 'v1_pack_size', 'v1_pack_price', 'v1_price_checked'];

/** A product with more than this many variants is listed once, as "(multiple variants)" (Dan, 2026-11-16: 65). */
export const COLLAPSE_OVER = 65;

/** Product types that are not parts at all; left out of the file. */
export const SKIP_TYPES = new Set(['gift card', 'gift cards', 'shipping', 'donation', 'donations', 'service', 'services']);

/** "9.00" → "9.00"; "1,234.5" → "1234.50"; zero, blank or not a number → '' (no price). */
export function priceText(raw) {
  const n = Number(String(raw ?? '').replace(/[$,\s]/g, ''));
  return Number.isFinite(n) && n > 0 ? n.toFixed(2) : '';
}

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

/** @param {{ name: string, website: string, notes?: string }} supplier */
export const suppliersCsv = (supplier) => toCsv(['name', 'website', 'notes'], [{ name: supplier.name, website: supplier.website, notes: supplier.notes ?? '' }]);

/**
 * The catalog ZIP (inventory.csv, categories.csv, suppliers.csv, photos/), ready for Add items from a file.
 * `photos` (file name in the ZIP → bytes) is empty unless photos were asked for; the photo_file column is
 * written only when some row has a photo.
 */
export async function buildCatalogZip(rows, photos, supplier) {
  const zip = new JSZip();
  const columns = rows.some((r) => r.photo_file) ? [...COLUMNS, 'photo_file'] : COLUMNS;
  zip.file('inventory.csv', toCsv(columns, rows));
  for (const [file, bytes] of photos ?? []) zip.file(file, bytes);
  zip.file('categories.csv', categoriesCsv(rows));
  zip.file('suppliers.csv', suppliersCsv(supplier));
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

/** The Crawl-delay (seconds) the "User-agent: *" group asks for, or 0. */
export function robotsCrawlDelay(text) {
  let inStar = false;
  let prevWasAgent = false;
  let delay = 0;
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(raw.replace(/#.*/, '').trim());
    if (!m) continue;
    const key = m[1].toLowerCase();
    if (key === 'user-agent') {
      inStar = prevWasAgent ? inStar || m[2].trim() === '*' : m[2].trim() === '*';
      prevWasAgent = true;
      continue;
    }
    prevWasAgent = false;
    if (inStar && key === 'crawl-delay') delay = Math.max(delay, Number(m[2]) || 0);
  }
  return delay;
}

/**
 * Units in a multi-pack (Dan, 2026-11-16: "QTY 4 - 2 Inch Solid Urethane Wheel", "(5-Pack)", "- 10 Pack",
 * a part number ending -PK2): the price is for the pack, so the pack size is what the app records.
 * 1 when nothing says otherwise.
 */
export function packSizeFrom(title, sku = '') {
  const t = String(title ?? '');
  const hit = /^\s*QTY\s*:?\s*(\d+)\b/i.exec(t) ?? /\((\d+)[- ]?(?:pack|pk)\)/i.exec(t) ?? /[-–]\s*(\d+)[- ]?pack\b/i.exec(t) ?? /\b(\d+)[- ]pack\b/i.exec(t) ?? /-PK(\d+)$/i.exec(String(sku ?? '').trim());
  const n = hit ? Number(hit[1]) : 1;
  return Number.isSafeInteger(n) && n >= 1 ? n : 1;
}

/** A name safe for a file name in the ZIP. */
export const fileStem = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);

/** Photos for Shopify stores: a product's first image, asked for at most `width` wide (Shopify's CDN resizes with ?width=). */
export function shopifyImageFor(product, width = 1024) {
  const src = String(product?.images?.[0]?.src ?? '').trim();
  if (!/^https:\/\//i.test(src)) return null;
  const ext = (/\.(jpe?g|png|webp)(?:\?|$)/i.exec(src)?.[1] ?? 'jpg').toLowerCase().replace('jpeg', 'jpg');
  const stem = fileStem(product.handle);
  if (stem === '') return null;
  return { url: `${src}${src.includes('?') ? '&' : '?'}width=${width}`, file: `photos/${stem}.${ext}` };
}

/**
 * Words in a product name (and its tags or breadcrumb) → the team's categories (SPEC §11), for vendors
 * that give no usable product type. The first match wins, so the order matters. A guess to be edited:
 * the scripts list what it couldn't place.
 */
export const KEYWORD_CATEGORIES = [
  [/\bswerve (module|drive)s?\b|\bswerve\b.*\bmodule\b/i, 'Assemblies', ''],
  [/\bgearbox|planetary|\bmaxplanetary|\bultraplanetary|\btoughbox|\bgear box/i, 'Power Transfer', 'Gear Boxes'],
  [/\b(spur |bevel |hex bore |splinexs? )?gears?\b|\bpinion/i, 'Power Transfer', 'Gears'],
  [/\b(timing )?belts?\b|\bhtd\b|\btread\b/i, 'Power Transfer', 'Belts'],
  [/\bpulleys?\b/i, 'Power Transfer', 'Pulleys'],
  [/\bsprockets?\b/i, 'Power Transfer', 'Sprockets'],
  [/\bchain\b|\bconnecting links?\b|\btensioner/i, 'Power Transfer', 'Chains'],
  [/\bbearings?\b/i, 'Mechanical', 'Bearings'],
  [/\bbushings?\b/i, 'Mechanical', 'Bushings'],
  [/\bwheels?\b|\bcasters?\b/i, 'Mechanical', 'Wheels'],
  [/\bcollars?\b|\bclamps?\b/i, 'Mechanical', 'Collars'],
  [/\bspacers?\b|\bstandoffs?\b/i, 'Mechanical', 'Spacers'],
  [/\bhubs?\b/i, 'Mechanical', 'Hubs'],
  [/\bshafts?\b|\bcouplers?\b/i, 'Mechanical', 'Shafts'],
  [/\badapters?\b/i, 'Mechanical', 'Adapters'],
  [/\bgussets?\b|\bbrackets?\b|\bplates?\b|\bmegaplate\b/i, 'Mechanical', 'Brackets & Plates'],
  [/\bextrusion|\btubing\b|\btube\b|\bbox tube\b/i, 'Mechanical', 'Structure'],
  [/\bbumpers?\b/i, 'Mechanical', 'Bumpers'],
  [/\bsheets?\b|\bpolycarbonate\b/i, 'Mechanical', 'Sheet Material'],
  [/\bscrews?\b|\bcap screw/i, 'Fasteners', 'Screws'],
  [/\bbolts?\b/i, 'Fasteners', 'Bolts'],
  [/\bnuts?\b/i, 'Fasteners', 'Nuts'],
  [/\bwashers?\b/i, 'Fasteners', 'Washers'],
  [/\brivets?\b/i, 'Fasteners', 'Rivets'],
  [/\bretaining (rings?|clips?)\b|\bclips?\b/i, 'Fasteners', 'Retaining Clips'],
  [/\bpins?\b/i, 'Fasteners', 'Pins'],
  [/\bcable ties?\b|\bzip ties?\b/i, 'Fasteners', 'Cable Ties'],
  [/\bmotor controllers?\b|\bspark\b|\btalon\b|\bvictor\b|\bnova\b/i, 'Electrical', 'Speed Controllers'],
  [/\bmotors?\b|\bgearmotors?\b|\bkraken\b|\bfalcon\b|\bneo\b/i, 'Electrical', 'Motors'],
  [/\bencoders?\b|\bsensors?\b|\bgyro|\bimu\b|\blidar\b|\bswitch(es)?\b/i, 'Electrical', 'Sensors'],
  [/\bcameras?\b|\bvision\b|\blimelight\b/i, 'Electrical', 'Cameras'],
  [/\bbatter(y|ies)\b|\bcharger/i, 'Electrical', 'Batteries'],
  [/\bcables?\b|\bwires?\b|\bwiring\b/i, 'Electrical', 'Cables/Wires'],
  [/\bconnectors?\b|\bwago\b|\bpowerpole\b|\bmolex\b|\banderson\b|\bterminals?\b/i, 'Electrical', 'Connectors'],
  [/\bbreakers?\b|\bfuses?\b|\bpower distribution\b|\bpdp\b|\bpdh\b/i, 'Electrical', 'Power Distribution'],
  [/\bcylinders?\b/i, 'Pneumatics', 'Cylinders'],
  [/\bsolenoids?\b/i, 'Pneumatics', 'Solenoids'],
  [/\bpneumatic/i, 'Pneumatics', 'Fittings'],
  [/\bservos?\b/i, 'Electrical', 'Servos'],
];

/** The team's category for some text, or null. */
export function keywordCategory(text) {
  const t = String(text ?? '');
  for (const [re, category, subcategory] of KEYWORD_CATEGORIES) if (re.test(t)) return { category, subcategory };
  return null;
}

/** A single assembly, sold complete: a title that ends "in a Box", "Assembly" or "Cart", not a kit of parts and not a part for one. */
export const isAssembly = (title) => /\b(in a box|assembly|cart)\s*$/i.test(String(title ?? '').trim()) && !/\bkits?\b/i.test(String(title ?? ''));

/**
 * The reasons shared by the vendors that have no tags to go on (Thrifty Bot, CTRE, REV), decided from the
 * title, the tags, the type and, for REV, the breadcrumb (`text`). `cfg` holds one regular expression (or
 * null) for each group; `include` is a Set of group names to keep anyway. Order matters: the first that
 * applies is the reason given.
 * @returns {string | null}
 */
export function commonExclusion(product, include, cfg) {
  const title = String(product?.title ?? '');
  const tags = Array.isArray(product?.tags) ? product.tags.map((t) => String(t)) : [];
  const type = String(product?.product_type ?? '');
  const all = [title, type, ...tags, String(product?.crumbs ?? '')].join(' | ');
  const test = (re, text) => re && re.test(text);
  if (!include.has('discontinued') && test(cfg.discontinued, all)) return 'discontinued';
  if (!include.has('programs') && test(cfg.programs, all) && !test(cfg.frc, all)) return 'ftc, fll or robits';
  if (!include.has('software') && test(cfg.software, all)) return 'software or license';
  if (!include.has('merchandise') && test(cfg.merchandise, all)) return 'merchandise';
  if (!include.has('game') && test(cfg.game, all)) return 'game piece or pre-order';
  if (!include.has('tools') && test(cfg.tools, all)) return 'tool';
  if (!include.has('bundles') && !isAssembly(title)) {
    if (test(cfg.bundleGroup, [type, ...tags, String(product?.crumbs ?? '')].join(' | '))) return 'bundle';
    if (/\b(bundles?|kits?|builder|combo)\b/i.test(title)) return 'bundle or kit';
  }
  return null;
}

/**
 * One row per variant of each Shopify product (one row in all for a configurator with more than
 * `collapseOver` variants). `vendor` supplies what differs between stores:
 *   { supplier: { name, website }, site, skipTypes?, exclude(product, include) → reason | null,
 *     categoryFor(product) → { category, subcategory, mapped, key }, packSize?(title, sku) → number,
 *     imageWidth? }.
 * Reads only title, handle, product_type, tags, options and each variant's title, sku, price and id.
 * @returns {{ rows: object[], skipped: { title: string, reason: string }[], unmapped: Map<string, number> }}
 */
export function shopifyRows(products, today, vendor, { images = false, include = new Set(), collapseOver = COLLAPSE_OVER } = {}) {
  const rows = [];
  const skipped = [];
  const unmapped = new Map();
  const site = vendor.site;
  for (const p of products ?? []) {
    const title = String(p?.title ?? '').trim();
    const type = String(p?.product_type ?? '').trim();
    if (title === '') {
      skipped.push({ title: '(no title)', reason: 'no title' });
      continue;
    }
    if ((vendor.skipTypes ?? SKIP_TYPES).has(type.toLowerCase())) {
      skipped.push({ title, reason: `not a part (${type})` });
      continue;
    }
    const why = vendor.exclude(p, include);
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
    const { category, subcategory, mapped, key } = vendor.categoryFor(p);
    if (!mapped) unmapped.set(key || '(none)', (unmapped.get(key || '(none)') ?? 0) + 1);
    const many = variants.length > 1;
    const image = images ? shopifyImageFor(p, vendor.imageWidth ?? 1024) : null;
    const photo = images ? { photo_file: image?.file ?? '', _image_url: image?.url ?? '' } : {};
    const row = (name, partNo, url, packSize, price, notes) => ({
      name,
      category,
      subcategory,
      unit: 'each',
      preferred_vendor: '1',
      v1_supplier: vendor.supplier.name,
      v1_part_no: partNo,
      v1_url: url,
      v1_pack_size: String(packSize),
      v1_pack_price: price,
      v1_price_checked: today,
      notes,
      ...photo,
    });
    if (many && collapseOver > 0 && variants.length > collapseOver) {
      const prices = variants.map((v) => Number(priceText(v?.price))).filter((n) => n > 0);
      const options = (Array.isArray(p.options) ? p.options : []).map((o) => String(o?.name ?? '').trim()).filter((n) => n !== '' && n.toLowerCase() !== 'title');
      const notes = `${variants.length} variants${options.length > 0 ? ` (${options.join(', ')})` : ''}; choose on the product page.${prices.length > 0 ? ' The price is the lowest of them.' : ''}`;
      rows.push(row(`${title} (multiple variants)`, '', `${site}/products/${handle}`, 1, prices.length > 0 ? Math.min(...prices).toFixed(2) : '', notes));
      continue;
    }
    for (const v of variants) {
      const vt = String(v?.title ?? '').trim();
      const label = many && vt !== '' && vt.toLowerCase() !== 'default title' ? ` - ${vt}` : '';
      const sku = String(v?.sku ?? '').trim();
      rows.push(row(title + label, sku, `${site}/products/${handle}${many && v?.id ? `?variant=${v.id}` : ''}`, vendor.packSize ? vendor.packSize(title + label, sku) : 1, priceText(v?.price), ''));
    }
  }
  return { rows, skipped, unmapped };
}
