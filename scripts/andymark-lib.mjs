// AndyMark catalog script, the parts that need no network (SPEC §23.7). Facts only: product name,
// part number (SKU), price, product page and category. Never photos or descriptions (Dan, 2026-11-16,
// after the terms check recorded in SPEC §23.7).
//
// AndyMark's store publishes its catalog as public JSON at /products.json (a Shopify store). The
// command-line script (andymark-catalog.mjs) fetches it politely; everything else is here so it can be
// tested offline.
import { COLUMNS, buildCatalogZip as commonBuildCatalogZip, categoriesCsv, priceText, robotsAllows, shopifyImageFor, shopifyRows, suppliersCsv as commonSuppliersCsv, toCsv } from './catalog-common.mjs';

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
export const imageFor = (product) => shopifyImageFor(product, IMAGE_WIDTH);

// The parts every vendor script shares live in catalog-common.mjs; they are re-exported here so this
// library keeps the same names.
export { COLUMNS, priceText, toCsv, categoriesCsv, robotsAllows };

/** What differs for AndyMark: its rules, its category table, its supplier name. */
const ANDYMARK = {
  supplier: { name: SUPPLIER, website: SITE },
  site: SITE,
  skipTypes: SKIP_TYPES,
  imageWidth: IMAGE_WIDTH,
  exclude: (product, include) => exclusionReason(product, { include }),
  categoryFor(product) {
    const type = String(product?.product_type ?? '').trim();
    const found = isAssembly(String(product?.title ?? '').trim()) ? { category: 'Assemblies', subcategory: '', mapped: true } : mapCategory(type);
    return { ...found, key: type === '' ? '(no type)' : type };
  },
};

/**
 * One row per variant of each product (a configurator with more than `collapseOver` variants is one row).
 * @returns {{ rows: object[], skipped: { title: string, reason: string }[], unmapped: Map<string, number> }}
 */
export function productRows(products, today, options = {}) {
  return shopifyRows(products, today, ANDYMARK, options);
}

export const suppliersCsv = () => commonSuppliersCsv(ANDYMARK.supplier);

/** The catalog ZIP (inventory.csv, categories.csv, suppliers.csv, photos/) for Add items from a file. */
export const buildCatalogZip = (rows, photos = new Map()) => commonBuildCatalogZip(rows, photos, ANDYMARK.supplier);
