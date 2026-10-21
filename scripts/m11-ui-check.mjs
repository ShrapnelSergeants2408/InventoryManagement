// M11 real-browser check: filter order (F5, SPEC v0.8: Supplier last) in the quick-filter row and the Filters panel.
// Usage: npm run build && node scripts/m11-ui-check.mjs <chrome.exe> <screenshot dir>
import { tempDir, track } from './tmp-cleanup.mjs';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PIN_H } from './pin-helpers.mjs';

const [chrome, outDir] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const preview = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', '4331', '--strictPort'], { stdio: 'ignore' });
const port = 9347;
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

const ROW = `return [...document.querySelectorAll('.frow .fchip')].map((b) => b.textContent.replace(/\\s+/g, ' ').trim())`;
const PANEL = `return [...document.querySelectorAll('.fpanel .fsec h3')].map((h) => h.textContent)`;
const openPanel = `${H} [...document.querySelectorAll('.top .btn')].find((b) => b.textContent.includes('Filters')).click(); await settle();`;
const closePanel = `${H} document.querySelector('.fpanel-foot .btn.pri').click(); await settle();`;

try {
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await size(1280, 800);
  await send('Page.navigate', { url: 'http://localhost:4331/' });
  await waitFor(`document.querySelector('.setup')`, 60000);
  await js(`const $ = (s) => document.querySelector(s); const $$ = (s) => [...document.querySelectorAll(s)]; const norm = (s) => s.replace(/\\s+/g, ' ').trim(); const byText = (sel, t) => $$(sel).find((b) => norm(b.textContent).includes(t)); const settle = (ms = 350) => new Promise((r) => setTimeout(r, ms)); ${PIN_H} await doSetup();`);
  await waitFor(`document.querySelectorAll('.cathdr').length > 0`, 60000);
  await sleep(500);

  // Quick-filter row: Needs order · Short only · Low spares only · Category · Location · Supplier
  check('quick-filter row order', await js(ROW), ['Needs order · 124', 'Short only · 124', 'Low spares only · 0', 'Category: All', 'Location: All', 'Supplier: All']);
  await shot('01-quick-row');

  // Filters panel: Stock (needs order, short, low spares) · Category · Location · Preferred supplier
  await js(openPanel);
  check('panel section order', await js(PANEL), ['Stock', 'Category', 'Location', 'Preferred supplier']);
  check('panel stock chips', await js(`return [...document.querySelectorAll('.fpanel .fsec')][0].querySelectorAll('.fchip').length`), 3);
  check('panel location chips present', await js(`return [...document.querySelectorAll('.fpanel .fsec')][2].querySelectorAll('.fchip').length > 0`), true);
  await shot('02-panel-landscape');

  // The moved sections still filter: Location "No location" (every starter item), then supplier REV.
  await js(`${H} [...document.querySelectorAll('.fpanel .fsec')][2].querySelector('.fchip').click(); await settle();`);
  const afterLoc = await js(`return document.querySelector('.fpanel-foot .btn.pri').textContent`);
  check('Location filter (No location) keeps all 129', afterLoc, 'Show 129 items');
  await js(`${H} [...[...document.querySelectorAll('.fpanel .fsec')][3].querySelectorAll('.fchip')].find((b) => b.textContent === 'REV').click(); await settle();`);
  const afterRev = await js(`return document.querySelector('.fpanel-foot .btn.pri').textContent`);
  await js(closePanel);
  const rows = await js(`return document.querySelectorAll('.row').length`);
  check('Supplier filter: Show n matches rows', afterRev, `Show ${rows} items`);
  check('Supplier filter narrows the list', rows > 0 && rows < 129, true);
  check('quick row shows both, in order', await js(ROW + `.slice(3, 6)`), ['Category: All', 'Location: No location', 'Supplier: REV']);
  check('Filters button shows count', await js(`return [...document.querySelectorAll('.top .btn')].find((b) => b.textContent.includes('Filters')).textContent`), 'Filters (2)');
  await js(`${H} [...document.querySelectorAll('.frow .fchip')].find((b) => b.textContent === 'Clear all').click(); await settle();`);

  // Portrait: same order in the bottom sheet, and nothing under 48 px in the panel (§17).
  await size(800, 1280);
  await sleep(400);
  check('portrait: quick-filter row order', await js(ROW), ['Needs order · 124', 'Short only · 124', 'Low spares only · 0', 'Category: All', 'Location: All', 'Supplier: All']);
  await js(openPanel);
  check('portrait: panel section order', await js(PANEL), ['Stock', 'Category', 'Location', 'Preferred supplier']);
  const small = await js(`return [...document.querySelectorAll('.fpanel button')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.height < 48 || r.width < 48); }).map((e) => e.className + ':' + Math.round(e.getBoundingClientRect().width) + 'x' + Math.round(e.getBoundingClientRect().height))`);
  check('panel touch targets ≥ 48 px', small, []);
  await shot('03-panel-portrait');
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
