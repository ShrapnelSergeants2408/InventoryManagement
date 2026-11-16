// Builds a catalog ZIP of AndyMark parts for More › Backup, restore & price import › Add items from a
// file (SPEC §23.7). Run on a computer with Node; the app never does this itself.
//
//   node scripts/andymark-catalog.mjs <output folder> [--delay 3000] [--max-pages 40] [--max-products N]
//   --include discontinued,international,merchandise,game,programs,tools,bundles   keep what is left out by default (see exclusionReason in andymark-lib.mjs)
//   --collapse-over N    list a product with more than N variants once, "(multiple variants)" (default 65; 0 = never)
//   node scripts/andymark-catalog.mjs <output folder> --save-json feed.json   (also keep the feed it fetched)
//   node scripts/andymark-catalog.mjs <output folder> --from-json <saved products.json>   (offline)
//   node scripts/andymark-catalog.mjs <output folder> --max-products 12 --images          (a small pilot with photos)
//
// By default: facts only (product name, part number (SKU), price, product page, category), no photos and
// no descriptions. AndyMark's terms limit copying of site content (SPEC §23.7), so --images is opt-in:
// it adds each product's first photo, kept in the ZIP for the team's own tablet. Don't publish those
// photos (they must not go in the public repository) and ask AndyMark before relying on them.
//
// It reads AndyMark's public /products.json feed, never signs in, checks robots.txt first (for the
// photo host too), and waits between requests (--delay, default 3 seconds, never under 1). If AndyMark
// answers "too many requests" (429) it waits as long as it is asked, up to 5 minutes, slows down for
// the rest of the run, and tries again up to 3 times before giving up. Run it when a fresh list is
// wanted, not on a schedule.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { COLLAPSE_OVER, SITE, buildCatalogZip, productRows, robotsAllows } from './andymark-lib.mjs';

const USER_AGENT = 'frc2408-andymark-catalog-script';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i === -1 ? fallback : args[i + 1];
};
const VALUE_FLAGS = new Set(['--delay', '--max-pages', '--max-products', '--from-json', '--save-json', '--include', '--collapse-over']);
const out = args.find((a, i) => !a.startsWith('--') && !VALUE_FLAGS.has(args[i - 1]));
if (!out) {
  console.error('Usage: node scripts/andymark-catalog.mjs <output folder> [--delay ms] [--max-pages n] [--max-products n] [--images] [--from-json file]');
  process.exit(2);
}
let delay = Math.max(1000, Number(flag('--delay', 3000)) || 3000);
const maxPages = Math.max(1, Number(flag('--max-pages', 40)) || 40);
const maxProducts = Number(flag('--max-products', 0)) || Infinity;
const fromJson = flag('--from-json', null);
const saveJson = flag('--save-json', null);
const images = args.includes('--images');
const include = new Set(String(flag('--include', '')).split(',').map((x) => x.trim()).filter(Boolean));
const collapseOver = Math.max(0, Number(flag('--collapse-over', COLLAPSE_OVER)) || 0);
const today = new Date().toISOString().slice(0, 10);

// A failure prints its message, not a stack trace.
for (const event of ['unhandledRejection', 'uncaughtException']) {
  process.on(event, (e) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
}

/** One request, spaced from the last by `delay`; a 429 or 503 is waited out (see the header) before trying again. */
let last = 0;
async function fetchPolite(url, accept) {
  for (let attempt = 1; ; attempt++) {
    const wait = last + delay - Date.now();
    if (wait > 0) await sleep(wait);
    last = Date.now();
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: accept } });
    if (res.ok) return res;
    const where = new URL(url);
    if ((res.status === 429 || res.status === 503) && attempt <= 3) {
      const asked = Number(res.headers.get('retry-after'));
      const seconds = Math.min(300, Number.isFinite(asked) && asked > 0 ? asked : 30 * attempt);
      delay = Math.min(delay * 2, 30000);
      console.log(`${where.host} answered ${res.status}; waiting ${seconds} s, then slowing to one request every ${delay / 1000} s (try ${attempt} of 3)`);
      await sleep(seconds * 1000);
      continue;
    }
    throw new Error(`${where.host} answered ${res.status} ${res.statusText} for ${where.pathname}. Stopping; try again in a while with a longer --delay.`);
  }
}

const robotsCache = new Map();
async function allowed(url) {
  const u = new URL(url);
  if (!robotsCache.has(u.origin)) robotsCache.set(u.origin, await (await fetchPolite(`${u.origin}/robots.txt`, 'text/plain')).text());
  return robotsAllows(robotsCache.get(u.origin), u.pathname);
}

let products = [];
if (fromJson) {
  products = JSON.parse(readFileSync(fromJson, 'utf8')).products ?? [];
  console.log(`Read ${products.length} products from ${fromJson}`);
} else {
  if (!(await allowed(`${SITE}/products.json`))) {
    console.error('robots.txt no longer allows /products.json for everyone. Not going further; check AndyMark’s terms again.');
    process.exit(1);
  }
  for (let page = 1; page <= maxPages && products.length < maxProducts; page++) {
    const limit = Number.isFinite(maxProducts) ? Math.min(250, maxProducts - products.length) : 250;
    const batch = (await (await fetchPolite(`${SITE}/products.json?limit=${limit}&page=${page}`, 'application/json')).json()).products ?? [];
    console.log(`page ${page}: ${batch.length} products`);
    if (batch.length === 0) break;
    products.push(...batch);
  }
  if (Number.isFinite(maxProducts)) products = products.slice(0, maxProducts);
}

if (saveJson && !fromJson) {
  mkdirSync(dirname(saveJson), { recursive: true });
  writeFileSync(saveJson, JSON.stringify({ products }));
}

const { rows, skipped, unmapped } = productRows(products, today, { images, include, collapseOver });
if (rows.length === 0) {
  console.error('No parts found; nothing written.');
  process.exit(1);
}

// Photos (opt-in): one request per product, never repeated for variants that share it.
const photos = new Map();
let noPhoto = 0;
if (images) {
  const urls = new Map(rows.filter((r) => r._image_url).map((r) => [r.photo_file, r._image_url]));
  noPhoto = new Set(rows.filter((r) => !r._image_url).map((r) => r.v1_url.split('?')[0])).size;
  if (fromJson) {
    console.log('--images with --from-json: nothing is downloaded, so no photos are added.');
    for (const r of rows) r.photo_file = '';
  } else {
    let n = 0;
    for (const [file, url] of urls) {
      n++;
      if (!(await allowed(url))) {
        console.log(`robots.txt doesn't allow ${new URL(url).pathname}; skipped`);
        for (const r of rows) if (r.photo_file === file) r.photo_file = '';
        continue;
      }
      const res = await fetchPolite(url, 'image/*');
      photos.set(file, new Uint8Array(await res.arrayBuffer()));
      if (n % 10 === 0 || n === urls.size) console.log(`photos: ${n} of ${urls.size}`);
    }
  }
}

mkdirSync(out, { recursive: true });
const file = join(out, `andymark-catalog-${today}${images ? '-with-photos' : ''}.zip`);
writeFileSync(file, await buildCatalogZip(rows, photos));

const bytes = [...photos.values()].reduce((n, b) => n + b.length, 0);
console.log(`\nWrote ${file}`);
const why = new Map();
for (const s of skipped) why.set(s.reason.replace(/ \(.*\)$/, ''), (why.get(s.reason.replace(/ \(.*\)$/, '')) ?? 0) + 1);
console.log(`${rows.length} parts from ${products.length - skipped.length} products; ${skipped.length} products left out (${[...why].map(([r, n]) => `${n} ${r}`).join(', ') || 'none'}).`);
// What was left out, so it can be checked (not part of the ZIP).
const cell = (s) => `"${String(s).replace(/"/g, '""')}"`;
writeFileSync(join(out, 'left-out.csv'), '﻿title,reason\r\n' + skipped.map((s) => `${cell(s.title)},${cell(s.reason)}`).join('\r\n') + '\r\n');
// Products listed once as "(multiple variants)", and the products just under the limit (listed by variant), so a mentor can check.
const once = rows.filter((r) => r.name.endsWith('(multiple variants)')).map((r) => r.name.replace(' (multiple variants)', ''));
if (once.length > 0) console.log(`\n${once.length} products listed once as "(multiple variants)": ${once.slice(0, 12).join(', ')}${once.length > 12 ? ', …' : ''}.`);
const perProduct = new Map();
for (const r of rows) perProduct.set(r.v1_url.split('?')[0], (perProduct.get(r.v1_url.split('?')[0]) ?? 0) + 1);
const near = [...perProduct].filter(([, n]) => n > 20).sort((a, b) => b[1] - a[1]);
if (near.length > 0) console.log(`\n${near.length} products with more than 20 variants are listed one row per variant: ${near.slice(0, 8).map(([u, n]) => `${n} ${u.split('/').pop()}`).join(', ')}.`);
if (images) console.log(`${photos.size} photos (${(bytes / 1024 / 1024).toFixed(1)} MB)${noPhoto ? `; ${noPhoto} products had no photo` : ''}. Keep them off the public repository.`);
if (unmapped.size > 0) {
  const top = [...unmapped].sort((a, b) => b[1] - a[1]);
  console.log(`\n${top.length} AndyMark product types aren't in the category table; they went to Misc, with the type as the subcategory (most common first).`);
  console.log('Add the ones you want to CATEGORY_MAP in scripts/andymark-lib.mjs and run again:');
  for (const [t, n] of top.slice(0, 40)) console.log(`  ${n}  ${t}`);
}
console.log('\nNext: More › Backup, restore & price import › Add items from a file. Prices are dated today; check them before ordering (F14).');
