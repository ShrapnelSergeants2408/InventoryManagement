// The parts of a catalog run the Shopify and REV command-line scripts share: polite requests, and writing
// the ZIP, left-out.csv and the summary. (andymark-catalog.mjs predates this and keeps its own copy.)
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildCatalogZip, robotsAllows, robotsCrawlDelay } from './catalog-common.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Requests spaced per host: `delay` ms for the store itself (raised to its robots.txt Crawl-delay), at most
 * `cdnDelay` for any other host (a photo CDN). A 429 or 503 is waited out as long as the host asks (up to 5
 * minutes), the host's delay is doubled, and the request is tried again up to 3 times; any other error stops.
 */
export function makeFetcher({ userAgent, siteHost, delay, cdnDelay = 3000, log = console.log }) {
  const lastByHost = new Map();
  const delayByHost = new Map();
  const robots = new Map();
  const hostDelay = (host) => delayByHost.get(host) ?? (host === siteHost ? delay : Math.min(delay, cdnDelay));
  async function fetchPolite(url, accept = '*/*') {
    const where = new URL(url);
    for (let attempt = 1; ; attempt++) {
      const wait = (lastByHost.get(where.host) ?? 0) + hostDelay(where.host) - Date.now();
      if (wait > 0) await sleep(wait);
      lastByHost.set(where.host, Date.now());
      const res = await fetch(url, { headers: { 'User-Agent': userAgent, Accept: accept } });
      if (res.ok) return res;
      if ((res.status === 429 || res.status === 503) && attempt <= 3) {
        const asked = Number(res.headers.get('retry-after'));
        const seconds = Math.min(300, Number.isFinite(asked) && asked > 0 ? asked : 30 * attempt);
        delayByHost.set(where.host, Math.min(hostDelay(where.host) * 2, 120000));
        log(`${where.host} answered ${res.status}; waiting ${seconds} s, then slowing to one request every ${hostDelay(where.host) / 1000} s (try ${attempt} of 3)`);
        await sleep(seconds * 1000);
        continue;
      }
      throw new Error(`${where.host} answered ${res.status} ${res.statusText} for ${where.pathname}. Stopping; try again in a while with a longer --delay.`);
    }
  }
  /** robots.txt for the URL's host (fetched once; its Crawl-delay is honoured), then whether the path is allowed. */
  async function allowed(url) {
    const u = new URL(url);
    if (!robots.has(u.origin)) {
      let text = '';
      try {
        text = await (await fetchPolite(`${u.origin}/robots.txt`, 'text/plain')).text();
      } catch (e) {
        // No robots.txt at all (404 or 410) means nothing is restricted, as the standard says; any other error stops the run.
        if (!/answered (404|410) /.test(String(e instanceof Error ? e.message : e))) throw e;
      }
      robots.set(u.origin, text);
      const crawl = robotsCrawlDelay(text) * 1000;
      if (crawl > hostDelay(u.host)) {
        delayByHost.set(u.host, crawl);
        log(`${u.host} asks for a Crawl-delay of ${crawl / 1000} s; using it`);
      }
    }
    return robotsAllows(robots.get(u.origin), u.pathname + u.search);
  }
  return { fetchPolite, allowed };
}

/** Downloads photos (file in the ZIP → address), one request each, skipping what robots.txt doesn't allow. */
export async function downloadPhotos(urls, { fetchPolite, allowed }, log = console.log) {
  const photos = new Map();
  const refused = new Set();
  let n = 0;
  for (const [file, url] of urls) {
    n++;
    if (!(await allowed(url))) {
      log(`robots.txt doesn't allow ${new URL(url).pathname}; skipped`);
      refused.add(file);
      continue;
    }
    const res = await fetchPolite(url, 'image/*');
    photos.set(file, new Uint8Array(await res.arrayBuffer()));
    if (n % 10 === 0 || n === urls.size) log(`photos: ${n} of ${urls.size}`);
  }
  return { photos, refused };
}

/** Writes the ZIP and left-out.csv and prints the summary. Returns the ZIP's path. */
export async function writeRun({ out, key, supplier, today, rows, skipped, unmapped, photos, productCount, images, noPhoto = 0, log = console.log }) {
  mkdirSync(out, { recursive: true });
  const file = join(out, `${key}-catalog-${today}${images ? '-with-photos' : ''}.zip`);
  writeFileSync(file, await buildCatalogZip(rows, photos, supplier));
  const why = new Map();
  for (const s of skipped) why.set(s.reason.replace(/ \(.*\)$/, ''), (why.get(s.reason.replace(/ \(.*\)$/, '')) ?? 0) + 1);
  log(`\nWrote ${file}`);
  log(`${rows.length} parts from ${productCount - skipped.length} products; ${skipped.length} products left out (${[...why].map(([r, n]) => `${n} ${r}`).join(', ') || 'none'}).`);
  const cell = (s) => `"${String(s).replace(/"/g, '""')}"`;
  writeFileSync(join(out, `${key}-left-out.csv`), '﻿title,reason\r\n' + skipped.map((s) => `${cell(s.title)},${cell(s.reason)}`).join('\r\n') + '\r\n');
  const once = rows.filter((r) => r.name.endsWith('(multiple variants)')).map((r) => r.name.replace(' (multiple variants)', ''));
  if (once.length > 0) log(`\n${once.length} products listed once as "(multiple variants)": ${once.slice(0, 12).join(', ')}${once.length > 12 ? ', …' : ''}.`);
  if (images) {
    const bytes = [...photos.values()].reduce((n, b) => n + b.length, 0);
    log(`${photos.size} photos (${(bytes / 1024 / 1024).toFixed(1)} MB)${noPhoto ? `; ${noPhoto} products had no photo` : ''}. Keep them off the public repository.`);
  }
  if (unmapped.size > 0) {
    const top = [...unmapped].sort((a, b) => b[1] - a[1]);
    log(`\n${top.length} products or types couldn't be placed in a team category and went to Misc (${key}-left-out.csv lists what was left out, not these):`);
    for (const [t, n] of top.slice(0, 25)) log(`  ${n}  ${t}`);
    if (top.length > 25) log(`  … and ${top.length - 25} more`);
  }
  log('\nNext: More › Backup, restore & price import › Add items from a file. Prices are dated today; check them before ordering (F14).');
  return file;
}
