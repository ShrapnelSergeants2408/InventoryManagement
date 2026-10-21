// M14 real-browser check: order-list search and Export shown lines only (F12, F13; SPEC v0.8 §19 Order search).
// Usage: npm run build && node scripts/m14-ui-check.mjs <chrome.exe> <screenshot dir>
import { tempDir, track } from './tmp-cleanup.mjs';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PIN_H } from './pin-helpers.mjs';

const [chrome, outDir] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const preview = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', '4334', '--strictPort'], { stdio: 'ignore' });
const port = 9350;
const proc = spawn(chrome, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${port}`, `--user-data-dir=${tempDir('cdp-')}`, 'about:blank'], { stdio: 'ignore' });
track(proc);

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

const ORIGIN = 'http://localhost:4334';
const PAGE = `const $ = (s) => document.querySelector(s); const $$ = (s) => [...document.querySelectorAll(s)]; const norm = (s) => s.replace(/\\s+/g, ' ').trim(); const byText = (sel, t) => $$(sel).find((b) => norm(b.textContent).includes(t)); const settle = (ms = 350) => new Promise((r) => setTimeout(r, ms)); ${PIN_H}`;
const P = (expr) => js(`${PAGE} ${expr}`);
const search = (q) => P(`{ const s = $('.searchwrap input'); s.focus(); s.value = ${JSON.stringify(q)}; s.dispatchEvent(new Event('input', { bubbles: true })); await settle(400); }`);
// Tile label and value, with a space between them.
const tiles = `return $$('.sum .tile').map((t) => norm([...t.children].map((c) => c.textContent).join(' ')))`;
const lineNames = `return $$('.ogrid.line .lt').map((e) => e.textContent)`;
const shownIds = `return $$('.ogrid.line a.lname').map((a) => decodeURIComponent(a.getAttribute('href').split('/').at(-1))).sort()`;
const idbItems = `return await new Promise((res, rej) => { const r = indexedDB.open('frc2408-inventory'); r.onsuccess = () => { const q = r.result.transaction('items').objectStore('items').getAll(); q.onsuccess = () => { r.result.close(); res(q.result); }; q.onerror = () => rej(q.error); }; r.onerror = () => rej(r.error); })`;
// What F12 should show for a search, worked out here from the stored items: order lines
// (need > 0 via the preferred vendor) whose name, part #, supplier or notes contain every word.
const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const expectedIds = (items, q) => {
  const terms = fold(q).split(' ');
  return items
    .filter((i) => {
      const v = i.vendors[i.preferredVendor - 1];
      if (!v || i.desired + i.spares - i.onHand <= 0) return false;
      const text = fold([i.name, v.partNo, v.supplier, i.notes].join(' \n '));
      return terms.every((t) => text.includes(t));
    })
    .map((i) => i.id)
    .sort();
};
const money = (s) => +s.replace(/[^0-9.]/g, '');
const lastFile = `return window.__files.at(-1)`;

try {
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await size(1280, 800);
  await send('Page.navigate', { url: ORIGIN + '/' });
  await waitFor(`document.querySelector('.setup')`, 60000);
  await P(`await doSetup();`);
  await waitFor(`document.querySelectorAll('.cathdr').length >= 11`, 60000);
  await send('Page.navigate', { url: ORIGIN + '/#/order' });
  await waitFor(`document.querySelectorAll('.ogrid.line').length > 0`, 30000);
  // Exports go to a stand-in share sheet that keeps the file.
  await js(`window.__files = []; navigator.canShare = () => true; navigator.share = async (d) => { window.__files.push({ name: d.files[0].name, text: await d.files[0].text() }); };`);

  // ── No search: as before ──
  check('no search: Grand total $8,413.66, 124 lines, one Export button', await P(`return [${tiles.replace('return ', '')}.slice(0, 2), $$('.top .btn').filter((b) => norm(b.textContent).startsWith('Export')).map((b) => norm(b.textContent))]`), [['Grand total $8,413.66', 'Lines 124'], ['Export CSV']]);

  // ── Search (F12) ──
  const items = await js(idbItems);
  await search('neo');
  const shownNames = await P(lineNames);
  check('search "neo": exactly the lines whose name, part #, supplier or notes mention it', [shownNames.length > 0 && shownNames.length < 124, await P(shownIds)], [true, expectedIds(items, 'neo')]);
  check('…including a line matched only by its notes', (await P(lineNames)).some((n) => !/neo/i.test(n)), true);
  const t = await P(tiles);
  check('"Showing n of 124 lines"; the grand total of the whole list stays', [t[0], t[1]], ['Grand total $8,413.66', `Showing ${shownNames.length} of 124 lines`]);
  const lineTotals = await P(`return $$('.ogrid.line').map((l) => l.querySelectorAll('.n')[5]?.textContent ?? '—')`);
  const sumShown = lineTotals.filter((x) => x !== '—').reduce((s, x) => s + money(x), 0);
  check('"Total shown" is the sum of the lines shown', money(t[2].replace('Total shown', '')).toFixed(2), sumShown.toFixed(2));
  check('footer: total shown, and the whole list\'s grand total in the note', await P(`return [norm($('.gt-v').textContent), norm($('.gt .muted').textContent).endsWith('Grand total of the whole list $8,413.66')]`), [t[2], true]);
  check('suppliers tile: shown of all', t[3], `Suppliers ${await P(`return $$('.oname').length`)} of 7`);
  check('supplier subtotals add up to the total shown', (await P(`return $$('.subtotal').map((s) => s.textContent)`)).reduce((s, x) => s + money(x), 0).toFixed(2), sumShown.toFixed(2));
  await shot('01-order-search');

  // Part #, supplier and notes are searched too.
  await search('rev-21-1653');
  check('search by part #', await P(lineNames), ['NEO 2.0 Brushless Motor (15T spline shaft)']);
  await search('thrifty');
  check('search by supplier: the Thrifty Bot lines, plus lines whose notes mention Thrifty', [await P(`return $$('.oname').map((e) => e.textContent).includes('Thrifty Bot')`), await P(shownIds)], [true, expectedIds(items, 'thrifty')]);
  await search('THRIFTY   swerve');
  check('capitals and extra spaces ignored; every word must match', await P(shownIds), expectedIds(items, 'thrifty swerve'));

  // ── Export CSV always exports every line ──
  await search('neo');
  await P(`byText('.top .btn', 'Export CSV').click(); await settle(); byText('.dlg button', 'Share CSV').click(); await settle(700);`);
  const full = await js(lastFile);
  const fullRows = full.text.replace(/^﻿/, '').trim().split('\r\n');
  check('Export CSV during a search: every line, the plain file name, no note', [fullRows[0].startsWith('Supplier,Part #,'), fullRows.find((r) => r.startsWith('Grand total')).split(',')[9], /^order-list-\d{4}-\d{2}-\d{2}-\d{4}\.csv$/.test(full.name)], [true, '8413.66', true]);

  // ── Export shown lines only ──
  await P(`byText('.top .btn', 'Export shown lines only').click(); await settle();`);
  check('dialog: title, filtered file name, the note it will write', await P(`return [norm($('.dlg .h2').textContent), /^order-list-filtered-neo-\\d{4}-\\d{2}-\\d{2}-\\d{4}\\.csv$/.test($('.dlg strong.mono').textContent), norm($('.xnote').textContent).startsWith('First row: Filtered order list: only the ${shownNames.length} of 124 lines matching "neo".')]`), ['Export shown lines only (CSV)', true, true]);
  await shot('02-export-shown');
  await P(`byText('.dlg button', 'Share CSV').click(); await settle(700);`);
  const part = await js(lastFile);
  const rows = part.text.replace(/^﻿/, '').trim().split('\r\n');
  const lines = rows.slice(2).filter((r) => !/^("?[^,]* subtotal|Grand total|\d+ items? without)/.test(r));
  check('file: the note row first, then the F13 header', [rows[0].startsWith('"Filtered order list: only the'), rows[1].startsWith('Supplier,Part #,Item,')], [true, true]);
  check('file: exactly the lines shown', lines.length, shownNames.length);
  check('file: its grand total is the total shown', money(rows.find((r) => r.startsWith('Grand total')).split(',')[9]).toFixed(2), sumShown.toFixed(2));

  // ── No match; clearing ──
  await search('zzzz');
  check('no match: message and Clear search; Export shown lines only is off', await P(`return [norm($('.state h2, .state .h2')?.textContent ?? ''), !!byText('.state .btn', 'Clear search'), byText('.top .btn', 'Export shown lines only').disabled]`), ['No lines match “zzzz”', true, true]);
  await P(`byText('.state .btn', 'Clear search').click(); await settle(400);`);
  check('cleared: all 124 lines and one Export button again', await P(`return [$$('.ogrid.line').length, $$('.top .btn').filter((b) => norm(b.textContent).startsWith('Export')).length]`), [124, 1]);

  // ── §17: touch targets; portrait ──
  await search('neo');
  const small = `return [...document.querySelectorAll('.top button, .top input, .top a')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.height < 47.5 || r.width < 47.5); }).map((e) => (e.className || e.tagName) + ':' + Math.round(e.getBoundingClientRect().width) + 'x' + Math.round(e.getBoundingClientRect().height))`;
  check('landscape: touch targets ≥ 48 px in the top bar', await js(small), []);
  await size(800, 1280);
  await sleep(400);
  check('portrait: touch targets ≥ 48 px; nothing wider than the screen', [await js(small), await js(`return document.documentElement.scrollWidth <= innerWidth`)], [[], true]);
  await shot('03-portrait-search');
} catch (e) {
  results.push('ERROR ' + e.message);
  await shot('error').catch(() => {});
} finally {
  console.log(results.join('\n'));
  console.log(problems.length ? 'Console problems:\n' + problems.join('\n') : 'No console errors or warnings');
  ws.close();
  proc.kill();
  preview.kill();
  process.exit(0);
}
