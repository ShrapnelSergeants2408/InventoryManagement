// M4 real-browser check: order list, totals, banners, stale prices, CSV export (share and download).
// Usage: npm run build && node scripts/m4-ui-check.mjs <chrome.exe> <screenshot dir>
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [chrome, outDir] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const preview = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', '4321', '--strictPort'], { stdio: 'ignore' });
const port = 9337;
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
  const r = await send('Runtime.evaluate', { expression: `(async () => { ${H} ${EDIT} ${expr} })()`, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 600));
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
  const settle = (ms = 350) => new Promise((r) => setTimeout(r, ms));
  const norm = (s) => s.replace(/\\s+/g, ' ').trim();
  const byText = (sel, t) => $$(sel).find((b) => norm(b.textContent).includes(t));
  const click = async (sel, t) => { const b = byText(sel, t); if (!b) throw new Error('nothing like ' + sel + ' with text ' + t); b.click(); await settle(); return b; };
  const type = async (el, v) => { if (typeof el === 'string') el = $(el); el.focus(); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); await settle(120); };
  const pick = async (el, v) => { if (typeof el === 'string') el = $(el); el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); await settle(200); };
  const gateDlg = () => $('[aria-label="Mentor PIN needed"]');
  const answerGate = async (yes) => {
    for (let i = 0; i < 30 && !gateDlg(); i++) await settle(100);
    if (!gateDlg()) throw new Error('the PIN gate did not appear');
    byText('[aria-label="Mentor PIN needed"] button', yes ? 'Continue' : 'Cancel').click();
    await settle(450);
  };
  const dlg = (label) => $('[role=dialog][aria-label="' + label + '"], [role=alertdialog][aria-label="' + label + '"]');
  const idb = (store, key) => new Promise((res, rej) => {
    const r = indexedDB.open('frc2408-inventory');
    r.onsuccess = () => {
      const db = r.result;
      const s = db.transaction(store).objectStore(store);
      const q = key === undefined ? s.getAll() : s.get(key);
      q.onsuccess = () => { res(q.result); db.close(); };
      q.onerror = () => rej(q.error);
    };
    r.onerror = () => rej(r.error);
  });
  const go = async (h) => { location.hash = h; await settle(600); };
  const gates = () => window.__gates ?? -1;
`;


// Edits stored rows directly (as a restore or a later date would), then the page is reloaded.
const EDIT = `
  const idbEdit = (store, fn) => new Promise((res, rej) => {
    const r = indexedDB.open('frc2408-inventory');
    r.onsuccess = () => {
      const db = r.result;
      const t = db.transaction(store, 'readwrite');
      const s = t.objectStore(store);
      const q = s.openCursor();
      q.onsuccess = () => { const c = q.result; if (!c) return; const v = fn(c.value); if (v) c.update(v); c.continue(); };
      t.oncomplete = () => { db.close(); res(); };
      t.onerror = () => rej(t.error);
    };
  });
  const idbPut = (store, value) => new Promise((res, rej) => {
    const r = indexedDB.open('frc2408-inventory');
    r.onsuccess = () => { const db = r.result; const t = db.transaction(store, 'readwrite'); t.objectStore(store).put(value); t.oncomplete = () => { db.close(); res(); }; t.onerror = () => rej(t.error); };
  });
  const money = (s) => Math.round(Number(s.replace(/[^0-9.]/g, '')) * 100);
  const tile = (k) => [...document.querySelectorAll('.tile')].find((t) => t.querySelector('.k')?.textContent === k)?.querySelector('.v').textContent;
  const subtotals = () => [...document.querySelectorAll('.shdr .subtotal')].map((e) => money(e.textContent)).reduce((a, b) => a + b, 0);
`;
const reload = async () => {
  await send('Page.reload');
  await waitFor(`document.querySelector('.tile .v') || document.querySelector('.state h2')`, 60000);
  await sleep(500);
};

try {
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await size(1280, 800);
  await send('Page.navigate', { url: 'http://localhost:4321/' });
  await waitFor(`document.querySelectorAll('.cathdr').length >= 12`, 60000);
  await js(`location.hash = '#/order';`);
  await waitFor(`document.querySelector('.tile .v')`);
  await sleep(800);

  // ── Starter catalog at on hand 0 (§12) ──
  check('title, grouping note and date', await js(`return [document.querySelector('.top .h1').textContent, document.querySelector('.top .small').textContent.startsWith('Grouped by preferred supplier · ')]`), ['Order list', true]);
  check('grand total, lines, suppliers (§12: 124 lines, $8,413.66)', await js(`return [tile('Grand total'), tile('Lines'), tile('Suppliers')]`), ['$8,413.66', '124', '7']);
  check('chips: none without price, none stale', await js(`return [...document.querySelectorAll('.tile.chips .chip')].map((c) => norm(c.textContent))`), ['0 without price', '0 stale (>90 days)']);
  check('rows on screen: 124 lines in 7 supplier groups, A–Z with other last', await js(`return [document.querySelectorAll('.olist .line').length, [...document.querySelectorAll('.oname')].map((e) => e.textContent)]`), [124, ['Amazon', 'AndyMark', 'CTRE', 'REV', 'Thrifty Bot', 'WCP', 'other']]);
  check('subtotals on screen add up to the grand total', await js(`return [subtotals(), money(tile('Grand total')), money(document.querySelector('.gt-v').textContent)]`), [841366, 841366, 841366]);
  check('every line: qty = packs × pack, line total = packs × price', await js(`return [...document.querySelectorAll('.olist .line')].filter((l) => { const n = [...l.querySelectorAll('.n')].map((e) => e.firstChild.textContent.trim()); const [need, pack, packs, qty, price, total] = n; return !(Number(qty) === Number(packs) * Number(pack) && Number(qty) >= Number(need) && money(total) === Number(packs) * money(price)); }).length`), 0);
  check('lines in catalog order (Amazon: Ethernet cable st-0096 first)', await js(`return [...document.querySelectorAll('section')][0].querySelectorAll('.lt')[0].textContent`), 'Ethernet cable, Cat6, 1 ft');
  check('count-in banner (F12, Q7 wording)', await js(`return [norm(document.querySelector('.banner .grow').textContent), document.querySelector('.banner a').getAttribute('href')]`), ['Count-in: 0 of 129 items counted. 129 not counted yet — their on-hand numbers may be wrong (starter items begin at 0), so this list may order too much.', '#/count']);
  check('no stale banner when prices are fresh', await js(`return !document.querySelector('.banner.warm')`), true);
  await shot('01-order');

  // ── Live update: covering an item removes its line ──
  await js(`await click('a.lname', 'NEO 2.0 Brushless Motor'); await settle(500); const box = document.querySelector('.dright input[aria-label="On hand"]'); box.focus(); box.value = '8'; box.dispatchEvent(new Event('input', { bubbles: true })); box.blur(); await settle(500); document.querySelector('.top button').click(); await settle(600);`);
  check('line tap opened the card; Back returned; covering NEO 2.0 removes $440.00 and its line', await js(`return [location.hash, tile('Lines'), tile('Grand total')]`), ['#/order', '123', '$7,973.66']);

  // ── Stale prices (F14): 290 days old ──
  await js(`await idbEdit('items', (r) => ({ ...r, vendors: r.vendors.map((v) => v && { ...v, priceChecked: '2026-01-01' }) }));`);
  await reload();
  check('stale banner when more than half of the priced lines are stale', await js(`return norm(document.querySelector('.banner.warm').textContent).startsWith('123 of 123 prices were checked more than 90 days ago')`), true);
  check('each line says how old its price is', await js(`const d = Math.round((Date.UTC(...(() => { const t = new Date(); return [t.getFullYear(), t.getMonth(), t.getDate()]; })()) - Date.UTC(2026, 0, 1)) / 86400000); return [document.querySelectorAll('.line .chip.stale').length, norm(document.querySelector('.line .chip.stale').textContent) === 'Price ' + d + ' days old']`), [123, true]);
  await js(`await click('.banner.warm button', 'Price refresh steps');`);
  check('price refresh steps (§10)', await js(`const d = dlg('Price refresh steps'); const ok = !!d && d.querySelectorAll('.steps li').length === 3; await click('.dlg button', 'OK'); return ok`), true);
  await shot('02-order-stale');
  await js(`await idbPut('settings', { key: 'staleDays', value: 400 });`);
  await reload();
  check('the stale age comes from the setting (400 days → nothing stale)', await js(`return [!document.querySelector('.banner.warm'), document.querySelectorAll('.line .chip.stale').length, norm(document.querySelectorAll('.tile.chips .chip')[1].textContent)]`), [true, 0, '0 stale (>400 days)']);

  // ── No price (§4): listed, out of the totals, counted ──
  await js(`await idbEdit('items', (r) => r.id === 'st-0096' ? { ...r, vendors: r.vendors.map((v, i) => (i === r.preferredVendor - 1 ? { ...v, packPriceCents: null } : v)) } : null);`);
  await reload();
  check('an item without a price stays listed, out of the totals, with a count', await js(`const line = [...document.querySelectorAll('.line')].find((l) => l.textContent.includes('Ethernet cable')); return [tile('Lines'), tile('Grand total'), norm(document.querySelector('.tile.chips .chip').textContent), norm(line.querySelector('.chip.np').textContent), line.querySelector('.n.l').textContent, norm(document.querySelector('.shdr .small').textContent), subtotals() === money(tile('Grand total'))]`), ['123', '$7,956.67', '1 without price', 'NO PRICE — not in total', '—', '9 lines · 1 without price (not in subtotal)', true]);

  // ── Export (F13) ──
  const CAPTURE = `
    window.__files = [];
    HTMLAnchorElement.prototype.click = function () { if (this.download) fetch(this.href).then((r) => r.text()).then((text) => window.__files.push({ via: 'download', name: this.download, text })); };
  `;
  await js(CAPTURE + `await click('.top button', 'Export CSV');`);
  check('export dialog: file name, summary, preview with totals', await js(`const d = dlg('Export order list'); return [/^order-list-\\d{4}-\\d{2}-\\d{2}-\\d{4}\\.csv$/.test(d.querySelector('strong.mono').textContent), norm(d.querySelector('.small.muted').textContent).startsWith('123 lines · 7 supplier groups'), [...d.querySelectorAll('tr.tot')].map((r) => r.cells[0].textContent)]`), [true, true, ['Amazon subtotal', 'Grand total', '1 item without a price']]);
  await shot('03-export');
  await js(`await click('.dlg button', 'Share CSV…'); await settle(800);`);
  const dl = await js(`return window.__files[0]`);
  const rows = dl ? dl.text.replace(/^﻿/, '').trim().split('\r\n') : [];
  check('no share sheet here → the CSV downloads (Q1) with a toast', [dl?.via, dl?.name?.startsWith('order-list-'), await js(`return norm(document.querySelector('.toast span').textContent).startsWith('Saved order-list-')`)], ['download', true, true]);
  check('downloaded CSV: F13 header, grand total and no-price rows', [rows[0], rows.at(-2)?.split(',')[0], rows.at(-2)?.split(',')[9], rows.at(-1)?.split(',')[0], rows.some((r) => r.startsWith('Amazon,B00K2E4X2U,"Ethernet cable, Cat6, 1 ft",each,4,10,1,10,NO PRICE,,'))], ['Supplier,Part #,Item,Unit,Need,Pack size,Packs,Order qty,Pack price,Line total,Price checked,URL,Notes', 'Grand total', '7956.67', '1 item without a price', true]);

  // Share sheet available: shared; closed: stays open.
  await js(`
    navigator.canShare = () => true;
    navigator.share = async (d) => { window.__files.push({ via: 'share', name: d.files[0].name, type: d.files[0].type, text: await d.files[0].text() }); };
    await click('.top button', 'Export CSV'); await click('.dlg button', 'Share CSV…'); await settle(600);`);
  check('with a share sheet the CSV is shared as text/csv', await js(`const f = window.__files.at(-1); return [f.via, f.type, f.text.includes('Grand total'), !dlg('Export order list')]`), ['share', 'text/csv', true, true]);
  await js(`navigator.share = () => Promise.reject(new DOMException('closed', 'AbortError')); await click('.top button', 'Export CSV'); await click('.dlg button', 'Share CSV…'); await settle(500);`);
  check('closing the share sheet keeps the dialog open, no download', await js(`const n = window.__files.length; return [!!dlg('Export order list'), n]`), [true, 2]);
  await js(`await click('.dlg button', 'Cancel');`);

  // ── Count-in banner goes when everything is counted; empty state ──
  await js(`await idbEdit('items', (r) => ({ ...r, lastCounted: '2026-10-18' }));`);
  await reload();
  check('no count-in banner once every item is counted', await js(`return !document.querySelector('.banner:not(.warm)')`), true);
  await js(`await idbEdit('items', (r) => ({ ...r, onHand: r.desired + r.spares }));`);
  await reload();
  check('empty state: Nothing to order, Export disabled (mockup 4d)', await js(`return [document.querySelector('.state h2').textContent, byText('.top button', 'Export CSV').disabled, !!byText('.state a', 'Back to inventory')]`), ['Nothing to order', true, true]);

  // ── Portrait, targets, text ──
  await js(`await idbEdit('items', (r) => ({ ...r, onHand: 0, lastCounted: '' })); await idbPut('settings', { key: 'staleDays', value: 90 });`);
  await reload();
  await size(800, 1280);
  await sleep(400);
  check('portrait: two-line rows with the summary line, no column header', await js(`const l = document.querySelector('.line'); return [getComputedStyle(document.querySelector('.colh')).display, getComputedStyle(l.querySelector('.pmeta')).display, norm(l.querySelector('.pmeta').textContent)]`), ['none', 'block', 'B00K2E4X2U · need 4 · 1 × pack of 10 · No price → —']);
  await shot('04-order-portrait');
  await size(1280, 800);
  await sleep(300);
  check('touch targets ≥ 48 px', await js(`return [...document.querySelectorAll('.main button, .main a, .main input')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.height < 47.5 || r.width < 47.5); }).map((e) => (e.getAttribute('aria-label') || e.textContent.trim()) + ' ' + Math.round(e.getBoundingClientRect().height))`), []);
  check('text ≥ 15 px', await js(`const bad = new Set(); for (const e of document.querySelectorAll('.main *')) { if (![...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue; const fs = parseFloat(getComputedStyle(e).fontSize); if (fs < 15 && e.getBoundingClientRect().width > 0) bad.add(e.className + ' ' + fs); } return [...bad]`), []);
} catch (e) {
  results.push('FAIL  script error: ' + e.message);
  await shot('zz-error').catch(() => {});
} finally {
  console.log(results.join('\n'));
  console.log(problems.length ? 'Console problems:\n' + problems.join('\n') : 'No console errors or warnings');
  ws.close();
  proc.kill();
  preview.kill();
}
