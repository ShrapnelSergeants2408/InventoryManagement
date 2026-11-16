// Builds a catalog ZIP of REV Robotics parts for More › Backup, restore & price import › Add items from a
// file (SPEC §23.7). Run on a computer with Node; the app never does this itself.
//
//   node scripts/rev-catalog.mjs <output folder> [options]
//
//   --delay ms            between requests to REV (default 2000; never under 1000). In a test on 2026-11-16 REV
//                         answered 36 product pages in a row without throttling down to one a second, so the
//                         default is twice the fastest pace tried. A full run is about 390 pages: about 13 minutes.
//   --no-images           leave the photos out (by default each product's first photo is added, for the team's own
//                         tablet: keep the ZIP off the public repository, and ask REV before relying on them)
//   --max-products n      stop after n product pages (for a small test)
//   --save-pages dir      keep each page's HTML in dir      --from-pages dir   build from saved pages (offline)
//   --include a,b,...     keep what is left out by default: discontinued, programs, merchandise, game, tools, bundles
//   --collapse-over n     list a product with more than n choices once, "(multiple variants)" (default 65; 0 = never)
//
// REV has no product feed, so this reads the product pages named in its sitemap, one request per page, never
// signs in, checks robots.txt first (for the photo host too, and honours any Crawl-delay), and waits between
// requests. If a host answers "too many requests" (429) it waits as long as it is asked, slows down and tries
// again, up to 3 times. Run it when a fresh list is wanted, not on a schedule.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { COLLAPSE_OVER, fileStem } from './catalog-common.mjs';
import { downloadPhotos, makeFetcher, writeRun } from './catalog-run.mjs';
import { SITE, SUPPLIER, parseProductPage, revRows, sitemapUrls } from './rev-lib.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i === -1 ? fallback : args[i + 1];
};
const VALUE_FLAGS = new Set(['--delay', '--max-products', '--save-pages', '--from-pages', '--include', '--collapse-over']);
const out = args.find((a, i) => !a.startsWith('--') && !VALUE_FLAGS.has(args[i - 1]));
if (!out) {
  console.error('Usage: node scripts/rev-catalog.mjs <output folder> [--delay ms] [--no-images] [--max-products n] [--save-pages dir | --from-pages dir] [--include list] [--collapse-over n]');
  process.exit(2);
}
const delay = Math.max(1000, Number(flag('--delay', 2000)) || 2000);
const maxProducts = Number(flag('--max-products', 0)) || Infinity;
const savePages = flag('--save-pages', null);
const fromPages = flag('--from-pages', null);
const images = !args.includes('--no-images');
const include = new Set(String(flag('--include', '')).split(',').map((x) => x.trim()).filter(Boolean));
const collapseOver = Math.max(0, Number(flag('--collapse-over', COLLAPSE_OVER)) || 0);
const today = new Date().toISOString().slice(0, 10);

for (const event of ['unhandledRejection', 'uncaughtException']) {
  process.on(event, (e) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
}

const fetcher = makeFetcher({ userAgent: 'frc2408-rev-catalog-script', siteHost: new URL(SITE).host, delay });
const pages = [];
let unreadable = 0;
const URL_COMMENT = /^<!-- url: (\S+) -->\n/;

if (fromPages) {
  for (const f of readdirSync(fromPages).filter((n) => n.endsWith('.html')).slice(0, maxProducts)) {
    const text = readFileSync(join(fromPages, f), 'utf8');
    const url = URL_COMMENT.exec(text)?.[1] ?? `${SITE}/${f.replace(/\.html$/, '')}/`;
    const page = parseProductPage(text);
    if (page) pages.push({ url, page });
    else unreadable++;
  }
  console.log(`Read ${pages.length} product pages from ${fromPages}`);
} else {
  const index = await (await fetcher.fetchPolite(`${SITE}/xmlsitemap.php`, 'application/xml')).text();
  let urls = [];
  for (const sm of sitemapUrls(index).filter((u) => /type=products/.test(u))) urls.push(...sitemapUrls(await (await fetcher.fetchPolite(sm, 'application/xml')).text()));
  urls = [...new Set(urls)];
  console.log(`${urls.length} product pages in REV's sitemap`);
  if (savePages) mkdirSync(savePages, { recursive: true });
  let n = 0;
  for (const url of urls) {
    if (pages.length + unreadable >= maxProducts) break;
    if (!(await fetcher.allowed(url))) {
      console.log(`robots.txt doesn't allow ${new URL(url).pathname}; skipped`);
      continue;
    }
    let html;
    try {
      html = await (await fetcher.fetchPolite(url, 'text/html')).text();
    } catch (e) {
      if (/answered (404|410) /.test(String(e instanceof Error ? e.message : e))) {
        unreadable++;
        continue;
      }
      throw e;
    }
    if (savePages) writeFileSync(join(savePages, `${fileStem(new URL(url).pathname) || 'page'}.html`), `<!-- url: ${url} -->\n${html}`);
    const page = parseProductPage(html);
    if (page) pages.push({ url, page });
    else unreadable++;
    if (++n % 25 === 0) console.log(`pages: ${n} of ${urls.length}`);
  }
}
if (unreadable > 0) console.log(`${unreadable} pages had no product on them (removed, or not a product) and were skipped.`);

const { rows, skipped, unmapped } = revRows(pages, today, { images, include, collapseOver });
if (rows.length === 0) {
  console.error('No parts found; nothing written.');
  process.exit(1);
}

let photos = new Map();
let noPhoto = 0;
if (images) {
  const urls = new Map(rows.filter((r) => r._image_url).map((r) => [r.photo_file, r._image_url]));
  noPhoto = new Set(rows.filter((r) => !r._image_url).map((r) => r.v1_url)).size;
  if (fromPages) {
    console.log('--from-pages: nothing is downloaded, so no photos are added.');
    for (const r of rows) r.photo_file = '';
  } else {
    const got = await downloadPhotos(urls, fetcher);
    photos = got.photos;
    for (const r of rows) if (got.refused.has(r.photo_file)) r.photo_file = '';
  }
}

await writeRun({ out, key: 'rev', supplier: SUPPLIER, today, rows, skipped, unmapped, photos, productCount: pages.length, images: images && photos.size > 0, noPhoto });
