// M12 real-browser check: the §11 categories from the 2026-10-21 starter catalog (SPEC v0.8 §11, §12, F22, F9).
// Usage: npm run build && node scripts/m12-ui-check.mjs <chrome.exe> <screenshot dir>
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PIN_H } from './pin-helpers.mjs';

const [chrome, outDir] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const preview = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', '4332', '--strictPort'], { stdio: 'ignore' });
const port = 9348;
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

// SPEC v0.8 §11, in order.
const CATS = ['Electrical', 'Pneumatics', 'Mechanical', 'Fasteners', 'Power Transfer', 'Assemblies', 'Public Relations', 'Programming', 'Tools', 'Safety', 'Misc'];
const ORIGIN = 'http://localhost:4332';
const PAGE = `const $ = (s) => document.querySelector(s); const $$ = (s) => [...document.querySelectorAll(s)]; const norm = (s) => s.replace(/\\s+/g, ' ').trim(); const byText = (sel, t) => $$(sel).find((b) => norm(b.textContent).includes(t)); const settle = (ms = 350) => new Promise((r) => setTimeout(r, ms)); ${PIN_H}`;
const catNames = `return [...document.querySelectorAll('.cathdr .cn')].map((c) => c.textContent)`;
const idbAll = (store) => `return await new Promise((res, rej) => { const r = indexedDB.open('frc2408-inventory'); r.onsuccess = () => { const q = r.result.transaction('${store}').objectStore('${store}').getAll(); q.onsuccess = () => { r.result.close(); res(q.result); }; q.onerror = () => rej(q.error); }; r.onerror = () => rej(r.error); })`;

try {
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await size(1280, 800);

  // ── First launch, Load the starter catalog (F22, §12) ──
  await send('Page.navigate', { url: ORIGIN + '/' });
  await waitFor(`document.querySelector('.setup')`, 60000);
  check('setup step 3 still says 129 parts', await js(`${PAGE} for (let i = 0; i < 300 && !$('.setup'); i++) await settle(100); await enterPin('2408'); await enterPin('2408'); $('.recovery input[type=checkbox]').click(); await settle(150); byText('.recovery button', 'Next').click(); for (let i = 0; i < 100 && !$('.sopts'); i++) await settle(100); return norm($('.sopts .sopt').textContent).includes('129 FRC parts')`), true);
  await js(`${PAGE} byText('.setup-acts .btn', 'Load starter catalog').click(); for (let i = 0; i < 600 && !$('.sdone'); i++) await settle(100); byText('.setup-acts .btn', 'Go to inventory').click(); await settle(800);`);
  await waitFor(`document.querySelectorAll('.cathdr').length >= 11`, 60000);
  await sleep(400);
  check('Inventory: the 11 §11 categories in order, empty ones included', await js(catNames), CATS);
  check('header summary unchanged: 129 items · 124 short', await js(`return document.querySelector('.top .small').textContent`), '129 items · 124 short · 0 low spares');
  check('empty categories show 0 items (Public Relations, Programming)', await js(`return ['Public Relations', 'Programming'].map((n) => [...document.querySelectorAll('.cathdr')].find((b) => b.querySelector('.cn').textContent === n)?.querySelector('.hc').textContent)`), ['0 items · 0 counted', '0 items · 0 counted']);
  await shot('01-inventory-categories');

  // Subcategory order inside a category, as in §11 (only those with items show in the list).
  await js(`[...document.querySelectorAll('.cathdr')].find((b) => b.querySelector('.cn').textContent === 'Electrical').click(); await new Promise((r) => setTimeout(r, 400));`);
  check('Electrical subcategories with items, in §11 order', await js(`return [...document.querySelectorAll('.subhdr')].map((b) => b.querySelector('span').textContent)`), ['Control System', 'Sensors', 'Cameras', 'Speed Controllers', 'Motors', 'Batteries', 'Connectors', 'Cables/Wires', 'Power Distribution']);
  await shot('02-electrical');

  // IndexedDB: the list, its order, and every subcategory, empty ones too.
  const cats = await js(idbAll('categories'));
  const sorted = [...cats].sort((a, b) => a.order - b.order);
  check('IndexedDB categories: §11 names and order 0–10', sorted.map((c) => [c.name, c.order]), CATS.map((n, i) => [n, i]));
  check('IndexedDB: 58 subcategories; Public Relations keeps Labels and Buttons', [sorted.reduce((n, c) => n + c.subcategories.length, 0), sorted.find((c) => c.name === 'Public Relations').subcategories], [58, ['Labels', 'Buttons']]);
  const items = await js(idbAll('items'));
  check('every item is in a listed category and subcategory', items.filter((i) => { const c = sorted.find((x) => x.name === i.category); return !c || (i.subcategory !== '' && !c.subcategories.includes(i.subcategory)); }).map((i) => i.id), []);

  // More › Categories (F9): same order, counts per category.
  await send('Page.navigate', { url: ORIGIN + '/#/more/categories' });
  await waitFor(`document.querySelectorAll('.crow').length >= 11`);
  check('Categories screen: §11 order', await js(`return [...document.querySelectorAll('.crow .cn')].map((c) => c.textContent)`), CATS);
  check('Categories screen: Programming has 0 items and 0 subcategories', await js(`const r = [...document.querySelectorAll('.crow')].find((x) => x.querySelector('.cn').textContent === 'Programming'); return r.querySelector('.small').textContent.replace(/\\s+/g, ' ').trim()`), '0 items · 0 subcategories');
  await shot('03-categories-screen');

  // Labels and count-in group by the same list (only groups with items).
  await send('Page.navigate', { url: ORIGIN + '/#/labels' });
  await waitFor(`document.querySelectorAll('.lgrow').length > 0`);
  check('Labels by category: §11 order, groups with items only', await js(`return [...document.querySelectorAll('.lgrow strong')].map((s) => s.textContent)`), CATS.filter((c) => c !== 'Public Relations' && c !== 'Programming'));

  // ── An item stored with other capitals by an older build (Stage 5 finding 2; M12 independent review 1) ──
  // Written straight into IndexedDB, as the pre-M12 restore could have left it; then the editor must open and save it.
  await js(`await new Promise((res, rej) => { const r = indexedDB.open('frc2408-inventory'); r.onsuccess = () => { const db = r.result; const t = db.transaction('items', 'readwrite'); const s = t.objectStore('items'); const g = s.get('st-0001'); g.onsuccess = () => { s.put({ ...g.result, category: 'mechanical', subcategory: 'STRUCTURE' }); }; t.oncomplete = () => { db.close(); res(); }; t.onerror = () => rej(t.error); }; });`);
  await send('Page.navigate', { url: ORIGIN + '/#/item/st-0001/edit' });
  await send('Page.reload');
  await waitFor(`document.querySelector('#cat') && document.querySelector('#nt')`, 30000);
  await sleep(400);
  check('editor: the stored "mechanical › STRUCTURE" shows as Mechanical › Structure', await js(`return [document.querySelector('#cat').value, document.querySelector('#sub').value]`), ['Mechanical', 'Structure']);
  await js(`${PAGE} const t = $('#nt'); t.focus(); t.value = 'edited after the M12 fix'; t.dispatchEvent(new Event('input', { bubbles: true })); await settle(150); byText('.top button', 'Save').click(); await settle(700);`);
  const saved = (await js(idbAll('items'))).find((i) => i.id === 'st-0001');
  check('editor: a notes edit saves, with the list spelling', [saved.category, saved.subcategory, saved.notes], ['Mechanical', 'Structure', 'edited after the M12 fix']);
  check('editor: no duplicate subcategory added', (await js(idbAll('categories'))).find((c) => c.name === 'Mechanical').subcategories.filter((s) => s.toLowerCase() === 'structure'), ['Structure']);

  // ── A fresh tablet: Start empty gets the §11 list too (9h) ──
  await send('Page.navigate', { url: 'about:blank' });
  await send('Storage.clearDataForOrigin', { origin: ORIGIN, storageTypes: 'all' });
  await send('Page.navigate', { url: ORIGIN + '/' });
  await waitFor(`document.querySelector('.setup')`, 60000);
  await js(`${PAGE} for (let i = 0; i < 300 && !$('.setup'); i++) await settle(100); await enterPin('2408'); await enterPin('2408'); $('.recovery input[type=checkbox]').click(); await settle(150); byText('.recovery button', 'Next').click(); for (let i = 0; i < 100 && !$('.sopts'); i++) await settle(100); byText('.sopts .sopt', 'Start empty').click(); await settle(200); byText('.setup-acts .btn', 'Start empty').click(); for (let i = 0; i < 300 && !$('.sdone'); i++) await settle(100); byText('.setup-acts .btn', 'Go to inventory').click(); await settle(800);`);
  const emptyCats = (await js(idbAll('categories'))).sort((a, b) => a.order - b.order);
  check('Start empty: no items; the §11 categories with their subcategories', [(await js(idbAll('items'))).length, emptyCats.map((c) => c.name), emptyCats.reduce((n, c) => n + c.subcategories.length, 0)], [0, CATS, 58]);
  await send('Page.navigate', { url: ORIGIN + '/#/more/categories' });
  await waitFor(`document.querySelectorAll('.crow').length >= 11`);
  check('Start empty: Categories screen in §11 order', await js(`return [...document.querySelectorAll('.crow .cn')].map((c) => c.textContent)`), CATS);
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
