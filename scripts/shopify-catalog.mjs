// Builds a catalog ZIP of Thrifty Bot or CTRE parts for More › Backup, restore & price import › Add items
// from a file (SPEC §23.7). Run on a computer with Node; the app never does this itself.
//
//   node scripts/shopify-catalog.mjs thriftybot|ctre <output folder> [options]
//
//   --no-images           leave the photos out (by default each product's first photo is added, for the team's
//                         own tablet: keep the ZIP off the public repository, and ask the store before relying on them)
//   --delay ms            between requests to the store (default 30000: the pace AndyMark, another Shopify store, was
//                         found to accept; CTRE answered 429 at one every 10 s; never under 1000)
//   --max-pages n         pages of 250 products to read (default 40)       --max-products n   stop after n products
//   --include a,b,...     keep what is left out by default: discontinued, programs, software, merchandise,
//                         game, tools, bundles
//   --collapse-over n     list a product with more than n variants once, "(multiple variants)" (default 65; 0 = never)
//   --save-json file      also keep the feed it fetched              --from-json file   build from a saved feed (offline)
//
// It reads the store's public /products.json feed, never signs in, checks robots.txt first (for the photo
// host too), and waits between requests. If a host answers "too many requests" (429) it waits as long as it is
// asked, slows down and tries again, up to 3 times. Run it when a fresh list is wanted, not on a schedule.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { COLLAPSE_OVER, shopifyRows } from './catalog-common.mjs';
import { downloadPhotos, makeFetcher, writeRun } from './catalog-run.mjs';
import { VENDORS } from './shopify-vendors.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i === -1 ? fallback : args[i + 1];
};
const VALUE_FLAGS = new Set(['--delay', '--max-pages', '--max-products', '--from-json', '--save-json', '--include', '--collapse-over']);
const positional = args.filter((a, i) => !a.startsWith('--') && !VALUE_FLAGS.has(args[i - 1]));
const vendor = VENDORS[positional[0]];
const out = positional[1];
if (!vendor || !out) {
  console.error(`Usage: node scripts/shopify-catalog.mjs ${Object.keys(VENDORS).join('|')} <output folder> [--no-images] [--delay ms] [--max-pages n] [--max-products n] [--include list] [--collapse-over n] [--save-json file] [--from-json file]`);
  process.exit(2);
}
const delay = Math.max(1000, Number(flag('--delay', 30000)) || 30000);
const maxPages = Math.max(1, Number(flag('--max-pages', 40)) || 40);
const maxProducts = Number(flag('--max-products', 0)) || Infinity;
const fromJson = flag('--from-json', null);
const saveJson = flag('--save-json', null);
const images = !args.includes('--no-images');
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

const fetcher = makeFetcher({ userAgent: vendor.userAgent, siteHost: new URL(vendor.site).host, delay });

let products = [];
if (fromJson) {
  products = JSON.parse(readFileSync(fromJson, 'utf8')).products ?? [];
  console.log(`Read ${products.length} products from ${fromJson}`);
} else {
  if (!(await fetcher.allowed(`${vendor.site}/products.json`))) {
    console.error(`robots.txt no longer allows /products.json for everyone. Not going further; check ${vendor.label}’s terms again.`);
    process.exit(1);
  }
  for (let page = 1; page <= maxPages && products.length < maxProducts; page++) {
    const limit = Number.isFinite(maxProducts) ? Math.min(250, maxProducts - products.length) : 250;
    const batch = (await (await fetcher.fetchPolite(`${vendor.site}/products.json?limit=${limit}&page=${page}`, 'application/json')).json()).products ?? [];
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

const { rows, skipped, unmapped } = shopifyRows(products, today, vendor, { images, include, collapseOver });
if (rows.length === 0) {
  console.error('No parts found; nothing written.');
  process.exit(1);
}

let photos = new Map();
let noPhoto = 0;
if (images) {
  const urls = new Map(rows.filter((r) => r._image_url).map((r) => [r.photo_file, r._image_url]));
  noPhoto = new Set(rows.filter((r) => !r._image_url).map((r) => r.v1_url.split('?')[0])).size;
  if (fromJson) {
    console.log('--from-json: nothing is downloaded, so no photos are added.');
    for (const r of rows) r.photo_file = '';
  } else {
    const got = await downloadPhotos(urls, fetcher);
    photos = got.photos;
    for (const r of rows) if (got.refused.has(r.photo_file)) r.photo_file = '';
  }
}

await writeRun({ out, key: vendor.key, supplier: vendor.supplier, today, rows, skipped, unmapped, photos, productCount: products.length, images: images && photos.size > 0, noPhoto });
