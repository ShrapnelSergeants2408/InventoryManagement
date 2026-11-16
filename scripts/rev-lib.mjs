// REV Robotics (SPEC §23.7). REV's store is BigCommerce, which has no product feed, so the script reads
// each product page: the schema.org Product and BreadcrumbList that every page carries as JSON-LD (name,
// part number, price, photo, REV's own category path) and the option choices in the page's add-to-cart form.
// One request per product page. Nothing here uses the network.
import { COLLAPSE_OVER, commonExclusion, fileStem, isAssembly, keywordCategory, packSizeFrom, priceText } from './catalog-common.mjs';

export const SITE = 'https://www.revrobotics.com';
export const SUPPLIER = { name: 'REV', website: 'https://www.revrobotics.com', notes: '' };

const entities = { '&amp;': '&', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&lt;': '<', '&gt;': '>', '&nbsp;': ' ' };
const decode = (s) => String(s ?? '').replace(/&(amp|quot|#39|apos|lt|gt|nbsp);/g, (m) => entities[m] ?? m).replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/\s+/g, ' ').trim();

/** A part number at the end of an option's label: "Shaft Collars - 10 Pack (REV-41-1327-PK10)". */
const SKU_IN_LABEL = /\s*\(([A-Za-z0-9][A-Za-z0-9]*(?:-[A-Za-z0-9]+)+)\)\s*$/;

/**
 * The product on a REV product page, or null when the page has none (a category page, an error page).
 * @returns {{ name: string, sku: string, price: string, availability: string, image: string, crumbs: string[], options: { name: string, values: { label: string, sku: string }[] }[] } | null}
 */
export function parseProductPage(html) {
  const blocks = [];
  for (const m of String(html ?? '').matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
    try {
      const j = JSON.parse(m[1]);
      for (const x of Array.isArray(j) ? j : j['@graph'] ?? [j]) blocks.push(x);
    } catch {
      /* a block that isn't JSON is ignored */
    }
  }
  const isType = (b, t) => (Array.isArray(b?.['@type']) ? b['@type'].includes(t) : b?.['@type'] === t);
  const product = blocks.find((b) => isType(b, 'Product'));
  if (!product || !String(product.name ?? '').trim()) return null;
  const crumbBlock = blocks.find((b) => isType(b, 'BreadcrumbList'));
  const crumbs = (crumbBlock?.itemListElement ?? []).map((i) => decode(i?.item?.name ?? i?.name ?? '')).filter(Boolean);
  const offer = Array.isArray(product.offers) ? product.offers[0] : product.offers;
  const rawSku = typeof product.sku === 'string' ? product.sku.trim() : '';
  const image = Array.isArray(product.image) ? product.image[0] : product.image;
  return {
    name: decode(product.name),
    // BigCommerce puts the product's numeric id where an option page has no part number of its own: not a part number.
    sku: /^\d+$/.test(rawSku) ? '' : rawSku,
    price: priceText(offer?.price ?? offer?.lowPrice),
    availability: String(offer?.availability ?? '').replace(/^https?:\/\/schema\.org\//, ''),
    image: typeof image === 'string' ? image : '',
    crumbs,
    options: parseOptions(html),
  };
}

/** The option groups in the add-to-cart form (radio buttons, a drop-down or swatches), with each choice's label and part number. */
export function parseOptions(html) {
  const out = [];
  const parts = String(html ?? '').split('data-product-attribute="').slice(1);
  for (const part of parts) {
    const end = part.search(/<div class="form-field"|<div class="productView-qtyAddWrapper"|<\/form>/);
    const block = end > 0 ? part.slice(0, end) : part.slice(0, 6000);
    const name = decode((/<label[^>]*class="form-label[^"]*"[^>]*>([\s\S]*?)<\/label>/.exec(block)?.[1] ?? '').replace(/<[^>]*>/g, ' ').replace(/\*/g, '').replace(/:\s*$/, ''));
    const labels = [...block.matchAll(/data-product-attribute-value="[^"]*"[^>]*>([\s\S]*?)<\/label>/g)].map((m) => decode(m[1].replace(/<[^>]*>/g, ' ')));
    const selects = [...block.matchAll(/<option[^>]*value="(\d+)"[^>]*>([\s\S]*?)<\/option>/g)].map((m) => decode(m[2]));
    const values = [...labels, ...selects].filter((l) => l !== '' && !/^(please )?(choose|select)\b/i.test(l));
    if (values.length === 0) continue;
    out.push({ name: name === '' ? 'Option' : name, values: values.map((label) => ({ label: label.replace(SKU_IN_LABEL, '').trim(), sku: SKU_IN_LABEL.exec(label)?.[1] ?? '' })) });
  }
  return out;
}

/** REV's category path without the noise: no Home, no catch-all names, and not the product itself. */
const NOISE = /^(home|shop all|new products|competition|education|education resources)$/i;
export const meaningfulCrumbs = (crumbs) => crumbs.slice(0, -1).filter((c) => !NOISE.test(c));

const FRC = /\bFRC\b|FIRST Robotics Competition|REV ION/i;
const CFG = {
  discontinued: /\bdiscontinued\b/i,
  programs: /\bFIRST Tech Challenge\b|\bFTC\b|\bFLL\b|\bLEGO\b/i,
  frc: FRC,
  software: null,
  merchandise: /\b(t-?shirts?|hoodies?|apparel|merchandise|swag|stickers?|gift cards?)\b/i,
  game: /\bpre-?orders?\b|\bgame pieces?\b|\bscoring elements?\b|\bfield carpet\b|\b20\d\d (REBUILT|REEFSCAPE|CRESCENDO|CHARGED UP|INFINITE RECHARGE)\b/i,
  // "Hardware & Tools" is where REV files its fasteners, so a "Tools" that follows "& " is part of that name.
  tools: /(?<!& )\btools?\b/i,
  bundleGroup: /\bbundles?\b/i,
};

/** Why a parsed page is left out, or null. The breadcrumb stands in for a store's tags and type. */
export function exclusionReason(page, include = new Set()) {
  return commonExclusion({ title: page.name, tags: [], product_type: '', crumbs: page.crumbs.slice(0, -1).join(' > ') }, include, CFG);
}

/** The team's category: words in the name first, else REV's own category path as a subcategory of Misc. */
export function categoryFor(page) {
  if (isAssembly(page.name)) return { category: 'Assemblies', subcategory: '', mapped: true, key: page.name };
  const found = keywordCategory(page.name) ?? keywordCategory(meaningfulCrumbs(page.crumbs).join(' '));
  if (found) return { ...found, mapped: true, key: page.name };
  const path = meaningfulCrumbs(page.crumbs).slice(-2).join(' › ');
  return { category: 'Misc', subcategory: path, mapped: false, key: path === '' ? '(no category)' : path };
}

/** Photos: REV's photo address asked for at 1024 px (BigCommerce resizes by the size in the address). */
export function revImage(page, url) {
  if (!/^https:\/\//i.test(page.image)) return null;
  const sized = page.image.replace(/\/stencil\/\d+x\d+\//, '/stencil/1024x1024/');
  const ext = (/\.(jpe?g|png|webp)(?:\?|$)/i.exec(sized)?.[1] ?? 'jpg').toLowerCase().replace('jpeg', 'jpg');
  const stem = fileStem(new URL(url).pathname) || fileStem(page.name);
  return stem === '' ? null : { url: sized, file: `photos/${stem}.${ext}` };
}

/**
 * Rows for the parsed pages. `pages` is [{ url, page }]. A page with no options is one row; a page with one
 * option group is a row per choice (its part number from the label when it has one); a page with two or more
 * groups, or a group with more than `collapseOver` choices, is one row "(multiple variants)". The price is the
 * page's price: an option's own price isn't on the page, so those rows say so.
 */
export function revRows(pages, today, { images = false, include = new Set(), collapseOver = COLLAPSE_OVER } = {}) {
  const rows = [];
  const skipped = [];
  const unmapped = new Map();
  for (const { url, page } of pages) {
    const why = exclusionReason(page, include);
    if (why) {
      skipped.push({ title: page.name, reason: why });
      continue;
    }
    const { category, subcategory, mapped, key } = categoryFor(page);
    if (!mapped) unmapped.set(key, (unmapped.get(key) ?? 0) + 1);
    const image = images ? revImage(page, url) : null;
    const photo = images ? { photo_file: image?.file ?? '', _image_url: image?.url ?? '' } : {};
    const row = (name, partNo, packSize, price, notes) => ({
      name,
      category,
      subcategory,
      unit: 'each',
      preferred_vendor: '1',
      v1_supplier: SUPPLIER.name,
      v1_part_no: partNo,
      v1_url: url,
      v1_pack_size: String(packSize),
      v1_pack_price: price,
      v1_price_checked: today,
      notes,
      ...photo,
    });
    const groups = page.options;
    const choices = groups.length === 1 ? groups[0].values : [];
    if (groups.length === 0 || (groups.length === 1 && choices.length === 1)) {
      // No choice to make (or only one): the part number is the page's, or the one in the single choice's label.
      const sku = page.sku || choices[0]?.sku || '';
      rows.push(row(page.name, sku, packSizeFrom(page.name, sku), page.price, ''));
    } else if (groups.length === 1 && choices.length >= 2 && (collapseOver === 0 || choices.length <= collapseOver)) {
      for (const c of choices) {
        const label = c.label === '' ? '' : ` - ${c.label}`;
        rows.push(row(page.name + label, c.sku, packSizeFrom(c.label, c.sku), page.price, `${groups[0].name} option. The price is the page's; the option may change it.`));
      }
    } else {
      const total = groups.reduce((n, g) => n * g.values.length, 1);
      const names = groups.map((g) => `${g.name} (${g.values.length})`).join(', ');
      rows.push(row(`${page.name} (multiple variants)`, page.sku, 1, page.price, `${total} combinations of ${names}; choose on the product page. The price is the page's; options may change it.`));
    }
  }
  return { rows, skipped, unmapped };
}

/** The product page addresses in a BigCommerce sitemap. */
export const sitemapUrls = (xml) => [...String(xml ?? '').matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)].map((m) => decode(m[1]));
