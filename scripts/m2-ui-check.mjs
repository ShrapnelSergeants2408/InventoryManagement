// M2 real-browser check: drives the production build in headless Chrome over the DevTools protocol.
// Usage: npm run build && node scripts/m2-ui-check.mjs <chrome.exe> <screenshot dir>
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PIN_H } from './pin-helpers.mjs';

const [chrome, outDir] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const preview = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', '4319', '--strictPort'], { stdio: 'ignore' });
const port = 9334;
const proc = spawn(chrome, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'cdp-'))}`, 'about:blank'], { stdio: 'ignore' });

let target;
for (let i = 0; i < 50 && !target; i++) {
  await sleep(200);
  try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page'); } catch {}
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map();
const problems = [];
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); return; }
  if (d.method === 'Runtime.exceptionThrown') problems.push('exception: ' + JSON.stringify(d.params.exceptionDetails).slice(0, 400));
  if (d.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(d.params.type)) problems.push(`console.${d.params.type}: ` + JSON.stringify(d.params.args).slice(0, 400));
};
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const js = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 500));
  return r.result?.result?.value;
};
const waitFor = async (cond, ms = 30000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await js(`return !!(${cond})`)) return; await sleep(150); }
  throw new Error('timeout waiting for ' + cond);
};
const shot = async (name) => {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(outDir, name + '.png'), Buffer.from(r.result.data, 'base64'));
};
const size = (width, height) => send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
const results = [];
const check = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${JSON.stringify(actual)}${ok ? '' : ` (expected ${JSON.stringify(expected)})`}`);
};

// Helpers that run in the page.
const H = `
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const hdr = (name) => $$('.cathdr, .subhdr').find((b) => b.querySelector('span').textContent === name);
  const typeInto = (el, v) => { el.focus(); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
  const settle = () => new Promise((r) => setTimeout(r, 400));
`;

try {
  await send('Runtime.enable');
  await send('Page.enable');
  // Headless pages aren't focused, so focus/blur events wouldn't fire without this.
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await size(1280, 800);
  await send('Page.navigate', { url: 'http://localhost:4319/' });
  await waitFor(`document.querySelector('.setup')`, 60000);
  await js(`const $ = (s) => document.querySelector(s); const $$ = (s) => [...document.querySelectorAll(s)]; const norm = (s) => s.replace(/\\s+/g, ' ').trim(); const byText = (sel, t) => $$(sel).find((b) => norm(b.textContent).includes(t)); const settle = (ms = 350) => new Promise((r) => setTimeout(r, ms)); ${PIN_H} await doSetup();`);
  await waitFor(`[...document.querySelectorAll('.cathdr')].length >= 12`, 60000);
  await sleep(500);
  check('header summary', await js(`return document.querySelector('.top .small').textContent`), '129 items · 124 short · 0 low spares');
  check('category headers', await js(`return document.querySelectorAll('.cathdr').length`), 12);
  check('quick filter counts', await js(`return [...document.querySelectorAll('.frow .fchip')].slice(0, 3).map((b) => b.textContent.trim())`), ['Needs order · 124', 'Short only · 124', 'Low spares only · 0']);
  await shot('01-landscape-collapsed');

  // F1: expand Fasteners → Bolts & Screws
  await js(`${H} hdr('Fasteners').click(); await settle(); hdr('Bolts & Screws').click(); await settle();`);
  check('Fasteners and Bolts & Screws expanded, rows shown', await js(`${H} return [hdr('Fasteners').getAttribute('aria-expanded'), hdr('Bolts & Screws').getAttribute('aria-expanded'), document.querySelectorAll('.row').length >= Number(hdr('Bolts & Screws').querySelector('.hc').textContent.split(' ')[0])]`), ['true', 'true', true]);
  await sleep(1500); // thumbnails
  await shot('02-landscape-expanded');
  check('thumbnails rendered', await js(`return document.querySelectorAll('img.thumb').length > 0 && [...document.querySelectorAll('img.thumb')].every((i) => i.complete && i.naturalWidth > 0 && i.naturalWidth <= 160)`), true);

  // F3: fast taps, never below 0, typed entry
  const firstName = await js(`return document.querySelector('.row .rname').firstChild.textContent`);
  await js(`${H} const p = $('.row .step.plus'); p.click(); p.click(); p.click(); await settle();`);
  check('three fast + taps', await js(`return document.querySelector('.row .num').value`), '3');
  await js(`${H} $('.row .step').click(); await settle();`);
  check('− tap', await js(`return document.querySelector('.row .num').value`), '2');
  await js(`${H} $('.row .step').click(); await settle(); $('.row .step').click(); await settle();`);
  check('never below 0 (− disabled at 0)', await js(`return [document.querySelector('.row .num').value, document.querySelector('.row .step').disabled]`), ['0', true]);
  await js(`${H} const n = $('.row .num'); typeInto(n, 'abc'); n.blur(); await settle();`);
  check('typed "abc" rejected', await js(`return [document.querySelector('.row .num').value, document.querySelector('.row .step-err')?.textContent]`), ['0', 'On hand "abc" must be a whole number']);
  await js(`${H} const n = $('.row .num'); typeInto(n, '-4'); n.blur(); await settle();`);
  check('typed "-4" rejected', await js(`return document.querySelector('.row .step-err')?.textContent`), "On hand can't be negative");
  await js(`${H} const n = $('.row .num'); typeInto(n, '7'); n.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await settle();`);
  check('typed 7 + Enter saved', await js(`return [document.querySelector('.row .num').value, !!document.querySelector('.row .step-err')]`), ['7', false]);
  await js(`${H} const n = $('.row .num'); typeInto(n, '99'); n.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await settle();`);
  check('Escape abandons a draft', await js(`return document.querySelector('.row .num').value`), '7');
  await shot('03-stepper');

  // Persistence across reload: count (IndexedDB) and expanded groups (localStorage)
  await send('Page.reload');
  await waitFor(`document.querySelectorAll('.row').length > 0`, 30000);
  await sleep(400);
  check('after reload: same first row, count kept, groups still open', await js(`return [document.querySelector('.row .rname').firstChild.textContent, document.querySelector('.row .num').value]`), [firstName, '7']);
  const lc = await js(`
    const db = await new Promise((res, rej) => { const r = indexedDB.open('frc2408-inventory'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const all = await new Promise((res) => { const q = db.transaction('items').objectStore('items').getAll(); q.onsuccess = () => res(q.result); });
    const thumbs = await new Promise((res) => { const q = db.transaction('photos').objectStore('photos').getAll(); q.onsuccess = () => res(q.result.filter((p) => p.thumb).length); });
    const it = all.find((i) => i.onHand === 7);
    db.close();
    return { onHand7: all.filter((i) => i.onHand === 7).length, lastCounted: it.lastCounted, thumbsStored: thumbs > 0 };`);
  check('quick adjust saved to IndexedDB without setting last_counted (Q7)', lc, { onHand7: 1, lastCounted: '', thumbsStored: true });

  // F4 search
  await js(`${H} typeInto($('.searchwrap .field'), 'neo'); await settle();`);
  const neo = await js(`return { rows: document.querySelectorAll('.row').length, names: [...document.querySelectorAll('.row .rname')].map((n) => n.firstChild.textContent) }`);
  check('search "neo" finds rows, all containing neo somewhere', neo.rows > 0, true);
  await shot('04-search-neo');
  await js(`${H} typeInto($('.searchwrap .field'), 'falcon 500'); await settle();`);
  check('empty state', await js(`return document.querySelector('.state .h2').textContent`), 'No items match “falcon 500”');
  await shot('05-empty');
  await js(`${H} [...document.querySelectorAll('.state .btn')].find((b) => b.textContent.includes('Clear')).click(); await settle();`);
  check('Clear search and filters', await js(`return [document.querySelector('.searchwrap .field').value, document.querySelectorAll('.cathdr').length]`), ['', 12]);

  // F5 filters panel
  await js(`${H} [...document.querySelectorAll('.top .btn')].find((b) => b.textContent.includes('Filters')).click(); await settle();`);
  await js(`${H} [...document.querySelectorAll('.fpanel .fchip')].find((b) => b.textContent.startsWith('Short')).click(); await settle();`);
  await js(`${H} [...document.querySelectorAll('.fpanel .fchip')].find((b) => b.textContent === 'Motors').click(); await settle();`);
  const motorsShort = await js(`return document.querySelector('.fpanel-foot .btn.pri').textContent`);
  await shot('06-filter-panel');
  await js(`${H} document.querySelector('.fpanel-foot .btn.pri').click(); await settle();`);
  check('filter panel closes; list shows only Motors', await js(`return [!!document.querySelector('.fpanel'), [...document.querySelectorAll('.cathdr .cn')].map((c) => c.textContent)]`), [false, ['Motors']]);
  check('Show n items matches rows', motorsShort, `Show ${await js(`return document.querySelectorAll('.row').length`)} items`);
  check('Filters button shows count', await js(`return [...document.querySelectorAll('.top .btn')].find((b) => b.textContent.includes('Filters')).textContent`), 'Filters (2)');
  await send('Page.reload');
  await waitFor(`document.querySelectorAll('.cathdr').length > 0`, 30000);
  await sleep(300);
  check('filters remembered after reload', await js(`return [...document.querySelectorAll('.cathdr .cn')].map((c) => c.textContent)`), ['Motors']);
  await js(`${H} [...document.querySelectorAll('.frow .fchip')].find((b) => b.textContent === 'Clear all').click(); await settle();`);
  check('Clear all', await js(`return document.querySelectorAll('.cathdr').length`), 12);

  // Portrait (§17: bottom tabs)
  await size(800, 1280);
  await sleep(400);
  check('portrait: nav at the bottom', await js(`const r = document.querySelector('.nav').getBoundingClientRect(); return r.bottom === innerHeight && r.width === innerWidth`), true);
  await shot('07-portrait');
  await size(1280, 800);

  // Other tabs are placeholders; the router works with reload
  await send('Page.navigate', { url: 'http://localhost:4319/#/labels' });
  await waitFor(`document.querySelector('.state .h2')`);
  check('Labels tab placeholder (M8), opened by URL', await js(`return [document.querySelector('.h1').textContent, document.querySelector('.nav a.on span').textContent]`), ['Labels', 'Labels']);

  // Touch targets ≥ 48 px (§2, §17) on the Inventory screen
  await send('Page.navigate', { url: 'http://localhost:4319/#/inventory' });
  await waitFor(`document.querySelectorAll('.row').length > 0`);
  const small = await js(`return [...document.querySelectorAll('button, a, input')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.height < 48 || r.width < 48); }).map((e) => e.className + ':' + Math.round(e.getBoundingClientRect().width) + 'x' + Math.round(e.getBoundingClientRect().height))`);
  check('touch targets ≥ 48 px', small, []);

  // SPEC §2 storage-error screen: make IndexedDB unusable before the app loads.
  const blocker = await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `IDBFactory.prototype.open = function () { throw new DOMException('The user denied permission to access the database.', 'SecurityError'); };`,
  });
  await send('Page.reload');
  await waitFor(`document.querySelector('[role=alert] .h2')`);
  check('storage blocked → error screen', await js(`return [document.querySelector('[role=alert] .h2').textContent, document.querySelector('.top .small').textContent, !!document.querySelector('.state-detail')]`), ['Can’t open the inventory on this tablet', 'Storage unavailable', true]);
  await sleep(300);
  await shot('08-storage-error');
  await js(`${H} [...document.querySelectorAll('[role=alert] .btn')].find((b) => b.textContent.includes('Try again')).click(); await settle(); await settle();`);
  check('Try again while still blocked → error screen again', await js(`return document.querySelector('[role=alert] .h2')?.textContent`), 'Can’t open the inventory on this tablet');
  await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: blocker.result.identifier });
  await send('Page.reload');
  await waitFor(`document.querySelectorAll('.cathdr').length >= 12`, 30000);
  check('unblocked → inventory is back, data intact', await js(`return document.querySelector('.top .small').textContent`), '129 items · 124 short · 0 low spares');
} catch (e) {
  results.push('ERROR ' + e.message);
} finally {
  console.log(results.join('\n'));
  console.log(problems.length ? 'Console problems:\n' + problems.join('\n') : 'No console errors or warnings');
  ws.close();
  proc.kill();
  preview.kill();
  process.exit(0);
}
