// Builds a catalog ZIP of AndyMark parts for More › Backup, restore & price import › Add items from a
// file (SPEC §23.7). Run on a computer with Node; the app never does this itself.
//
//   node scripts/andymark-catalog.mjs <output folder> [--delay 2000] [--max-pages 40] [--max-products N]
//   node scripts/andymark-catalog.mjs <output folder> --from-json <saved products.json>   (offline)
//
// Facts only: product name, part number (SKU), price, product page and category. It copies no photos and
// no descriptions (AndyMark's terms limit copying of site content; see SPEC §23.7 for the check made on
// 2026-11-16). It reads AndyMark's public /products.json feed, never signs in, checks robots.txt first,
// waits between requests (default 2 seconds), stops at a page limit, and gives up at the first error
// instead of retrying hard. Run it once when you want a fresh list, not on a schedule.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SITE, buildCatalogZip, productRows, robotsAllows } from './andymark-lib.mjs';

const USER_AGENT = 'frc2408-andymark-catalog-script';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i === -1 ? fallback : args[i + 1];
};
const out = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
if (!out) {
  console.error('Usage: node scripts/andymark-catalog.mjs <output folder> [--delay ms] [--max-pages n] [--max-products n] [--from-json file]');
  process.exit(2);
}
const delay = Math.max(1000, Number(flag('--delay', 2000)) || 2000);
const maxPages = Math.max(1, Number(flag('--max-pages', 40)) || 40);
const maxProducts = Number(flag('--max-products', 0)) || Infinity;
const fromJson = flag('--from-json', null);
const today = new Date().toISOString().slice(0, 10);

async function get(path) {
  const res = await fetch(SITE + path, { headers: { 'User-Agent': USER_AGENT, Accept: path.endsWith('.json') || path.includes('.json?') ? 'application/json' : 'text/plain' } });
  if (!res.ok) {
    const wait = res.headers.get('retry-after');
    throw new Error(`AndyMark answered ${res.status} ${res.statusText} for ${path}${wait ? ` (it asks to wait ${wait} seconds)` : ''}. Stopping without retrying; try again in a while${res.status === 429 ? ', and with a longer --delay' : ''}.`);
  }
  return res;
}

// A failure prints its message, not a stack trace.
for (const event of ['unhandledRejection', 'uncaughtException']) {
  process.on(event, (e) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
}

let products = [];
if (fromJson) {
  products = JSON.parse(readFileSync(fromJson, 'utf8')).products ?? [];
  console.log(`Read ${products.length} products from ${fromJson}`);
} else {
  const robots = await (await get('/robots.txt')).text();
  if (!robotsAllows(robots, '/products.json')) {
    console.error('robots.txt no longer allows /products.json for everyone. Not going further; check AndyMark’s terms again.');
    process.exit(1);
  }
  for (let page = 1; page <= maxPages && products.length < maxProducts; page++) {
    await sleep(delay);
    const batch = (await (await get(`/products.json?limit=250&page=${page}`)).json()).products ?? [];
    console.log(`page ${page}: ${batch.length} products`);
    if (batch.length === 0) break;
    products.push(...batch);
  }
  if (Number.isFinite(maxProducts)) products = products.slice(0, maxProducts);
}

const { rows, skipped, unmapped } = productRows(products, today);
if (rows.length === 0) {
  console.error('No parts found; nothing written.');
  process.exit(1);
}
mkdirSync(out, { recursive: true });
const file = join(out, `andymark-catalog-${today}.zip`);
writeFileSync(file, await buildCatalogZip(rows));

console.log(`\nWrote ${file}`);
console.log(`${rows.length} parts from ${products.length} products; ${skipped.length} products left out.`);
if (unmapped.size > 0) {
  const top = [...unmapped].sort((a, b) => b[1] - a[1]);
  console.log(`\n${top.length} AndyMark product types aren't in the category table and went to Misc (most common first).`);
  console.log('Add the ones you want to CATEGORY_MAP in scripts/andymark-lib.mjs and run again:');
  for (const [t, n] of top.slice(0, 40)) console.log(`  ${n}  ${t}`);
}
console.log('\nNext: More › Backup, restore & price import › Add items from a file. Prices are dated today; check them before ordering (F14).');
