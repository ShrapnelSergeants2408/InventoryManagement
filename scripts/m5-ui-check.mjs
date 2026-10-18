// M5 real-browser check: backup (full and data only, share and download), reminder banner,
// restore (ZIP, CSV, bad file, PIN cancelled, back up first), price-update import.
// Usage: npm run build && node scripts/m5-ui-check.mjs <chrome.exe> <screenshot dir>
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PIN_H } from './pin-helpers.mjs';

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
${PIN_H}
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


// Direct IndexedDB edits (as time passing or another session would), file picking, toasts.
const EDIT = `
  const idbTx = (store, fn) => new Promise((res, rej) => {
    const r = indexedDB.open('frc2408-inventory');
    r.onsuccess = () => {
      const db = r.result;
      const t = db.transaction(store, 'readwrite');
      let out;
      Promise.resolve(fn(t.objectStore(store))).then((v) => (out = v));
      t.oncomplete = () => { db.close(); res(out); };
      t.onerror = () => rej(t.error);
    };
  });
  const idbEdit = (store, fn) => idbTx(store, (s) => { const q = s.openCursor(); q.onsuccess = () => { const c = q.result; if (!c) return; const v = fn(c.value); if (v) c.update(v); c.continue(); }; });
  const idbPut = (store, value) => idbTx(store, (s) => void s.put(value));
  const idbDelete = (store, key) => idbTx(store, (s) => void s.delete(key));
  const idbCount = (store) => new Promise((res) => idbTx(store, (s) => { const q = s.count(); q.onsuccess = () => res(q.result); }));
  // Hands a file to one of the screen's hidden file inputs (0 = restore, 1 = price CSV), as the picker would.
  const choose = async (index, name, data, type) => {
    const input = document.querySelectorAll('input[type=file]')[index];
    const dt = new DataTransfer();
    dt.items.add(new File([data], name, { type }));
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await settle(300);
  };
  const waitDlg = async (label, ms = 30000) => { const end = Date.now() + ms; while (Date.now() < end) { const d = dlg(label); if (d) return d; await settle(100); } throw new Error('no dialog ' + label); };
  const waitGone = async (sel, ms = 30000) => { const end = Date.now() + ms; while (Date.now() < end && document.querySelector(sel)) await settle(100); };
  const toast = () => norm(document.querySelector('.toast span')?.textContent ?? '');
  const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const cmpRows = () => [...document.querySelectorAll('.cmp tbody tr')].map((r) => [...r.cells].map((c) => norm(c.textContent)));
`;
const reload = async () => {
  await send('Page.reload');
  await waitFor(`document.querySelector('.bkcard') || document.querySelectorAll('.cathdr').length >= 12`, 60000);
  await sleep(600);
};
// Downloads land in window.__files (bytes kept, so a ZIP can be restored later).
const CAPTURE = `
  window.__files = window.__files ?? [];
  HTMLAnchorElement.prototype.click = function () { if (this.download) fetch(this.href).then((r) => r.arrayBuffer()).then((b) => window.__files.push({ via: 'download', name: this.download, bytes: new Uint8Array(b) })); };
`;

try {
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await size(1280, 800);
  await send('Page.navigate', { url: 'http://localhost:4321/' });
  await waitFor(`document.querySelector('.setup')`, 60000);
  await js(`await doSetup();`);
  await waitFor(`document.querySelectorAll('.cathdr').length >= 12`, 60000);

  // ── Boot records the setup time; no reminder on day 1 (D7) ──
  check('setup time recorded at the starter load; no banner on day 1', await js(`const s = await idb('settings', 'setupDoneAt'); return [typeof s?.value, !document.querySelector('.banner')]`), ['number', true]);
  await js(`await go('#/more');`);
  check('More: Backup row is live, last backup "never"', await js(`const a = [...document.querySelectorAll('a.mrow')].find((e) => e.textContent.includes('Backup, restore')); return [a?.getAttribute('href'), norm(a?.querySelector('.small').textContent ?? '')]`), ['#/more/backup', 'Last backup: never · full or data only']);
  await js(`await go('#/more/backup');`);
  await waitFor(`document.querySelector('.bkcard')`);
  await sleep(800);
  check('Backup screen (8a): three cards, last backup Never, 128 photos', await js(`return [document.querySelector('.top .h1').textContent, [...document.querySelectorAll('.bkcard .h2')].map((h) => h.textContent.trim()), norm(document.querySelector('.bk-last').textContent), norm(document.querySelectorAll('.bkopt')[0].textContent).includes('128 photos')]`), ['Backup & restore', ['Back up', 'Restore', 'Price update import'], 'Last backup: Never', true]);
  check('sizes shown: full about 5–7 MB, CSV in KB', await js(`const t = [...document.querySelectorAll('.bkopt .small')].map((e) => e.textContent); return [/about [5-7]\\.\\d MB/.test(t[0]), /about \\d+ KB/.test(t[1])]`), [true, true]);
  check('storage status note (§2)', await js(`return /Persistent storage (granted|not granted|unknown)/.test(document.querySelector('.bk-store').textContent)`), true);
  await shot('01-backup');

  // ── Reminder (F16): 8 days since setup ──
  await js(`await idbPut('settings', { key: 'setupDoneAt', value: Date.now() - 8 * 86400000 });`);
  await reload();
  check('banner on Backup after the reminder period', await js(`return norm(document.querySelector('.banner .grow').textContent)`), 'No backup yet. Share a full or data-only backup to clear this reminder.');
  await js(`await go('#/inventory');`);
  check('banner on Inventory with Back up now and Later', await js(`return [norm(document.querySelector('.banner .grow').textContent).startsWith('No backup yet.'), document.querySelector('.banner a').getAttribute('href'), !!byText('.banner button', 'Later')]`), [true, '#/more/backup', true]);
  await shot('02-inventory-banner');
  await js(`await go('#/order');`);
  check('no backup banner on other screens (S4)', await js(`return [...document.querySelectorAll('.banner')].some((b) => b.textContent.includes('backup'))`), false);
  await js(`await go('#/inventory'); await click('.banner button', 'Later');`);
  check('Later hides it on Inventory and on Backup', await js(`const a = !document.querySelector('.banner'); await go('#/more/backup'); return [a, !document.querySelector('.banner')]`), [true, true]);
  await reload();
  check('a reload brings it back (Q10)', await js(`return !!document.querySelector('.banner')`), true);

  // ── Data to round-trip: a count, tricky notes, a location ──
  await js(`await idbEdit('items', (r) => r.id === 'st-0001' ? { ...r, onHand: 5, lastCounted: '2026-10-18', location: 'Bin "A", top', notes: 'Line 1, with comma\\nLine 2 "quoted" — ünï 🤖' } : null);
            await idbPut('locations', { key: 'bin "a", top', name: 'Bin "A", top', notes: '', order: 0 });`);
  await reload();
  const original = await js(`return (await idb('items')).map(({ updatedAt, ...r }) => r)`);

  // ── Full backup: no share sheet in headless Chrome → download (Q1); the clock resets ──
  await js(CAPTURE + `window.__files = []; document.querySelectorAll('.bkopt')[0].click(); for (let i = 0; i < 150 && !window.__files.length; i++) await settle(100); await settle(400);`);
  const full = await js(`const f = window.__files[0]; return f && { name: f.name, size: f.bytes.length, pk: f.bytes[0] === 0x50 && f.bytes[1] === 0x4b, b64: b64(f.bytes) }`);
  check('full backup downloads as inventory-backup-…zip (> 4 MB)', [/^inventory-backup-\d{4}-\d{2}-\d{2}-\d{4}\.zip$/.test(full?.name ?? ''), full?.pk, full?.size > 4_000_000], [true, true, true]);
  check('toast says Downloads; banner gone; Last backup today', await js(`return [toast().startsWith('Saved inventory-backup-') && toast().includes('Downloads'), !document.querySelector('.banner'), norm(document.querySelector('.bk-last').textContent).startsWith('Last backup: today')]`), [true, true, true]);
  check('lastBackupAt stored', await js(`return Date.now() - (await idb('settings', 'lastBackupAt')).value < 60000`), true);

  // ── Data only with a share sheet: shared as text/csv ──
  await js(`navigator.canShare = (d) => d.files.every((f) => f.type === 'text/csv');
            navigator.share = async (d) => { window.__files.push({ via: 'share', name: d.files[0].name, type: d.files[0].type, bytes: new Uint8Array(await d.files[0].arrayBuffer()) }); };
            document.querySelectorAll('.bkopt')[1].click(); await settle(900);`);
  const csvFile = await js(`const f = window.__files.at(-1); return { via: f.via, type: f.type, name: f.name, text: new TextDecoder().decode(f.bytes) }`);
  check('data-only backup shared as text/csv with the §7 header', [csvFile.via, csvFile.type, /^inventory-backup-.*\.csv$/.test(csvFile.name), csvFile.text.startsWith('id,name,category,subcategory,location,unit,on_hand'), await js(`return toast().startsWith('Shared inventory-backup-')`)], ['share', 'text/csv', true, true, true]);
  await js(`navigator.share = () => Promise.reject(new DOMException('closed', 'AbortError')); await idbPut('settings', { key: 'lastBackupAt', value: 1 }); document.querySelectorAll('.bkopt')[1].click(); await settle(900);`);
  check('a closed share sheet is not a backup', await js(`return (await idb('settings', 'lastBackupAt')).value`), 1);

  // ── Change the tablet, then restore the full backup (F17, 8c) ──
  await js(`await idbDelete('items', 'st-0002'); await idbEdit('items', (r) => r.id === 'st-0001' ? { ...r, onHand: 99 } : null);`);
  await reload();
  await js(`await choose(0, 'inventory-backup-2026-10-10-1535.zip', unb64(${JSON.stringify(full.b64)}), 'application/zip'); await waitDlg('Replace all inventory with this backup?');`);
  await sleep(300);
  check('restore dialog compares tablet and backup (backup column)', await js(`const r = cmpRows(); return [r[0][2], r[1][2], r[2][2], r[3][2].startsWith('today ')]`), ['129', '128', '9', true]);
  check('tablet column: 128 items now, changed today', await js(`return [cmpRows()[0][1], cmpRows()[3][1].startsWith('changed today')]`), ['128', true]);
  check('Replace everything is disabled until the tick', await js(`const b = byText('.dlg button', 'Replace everything'); const before = b.disabled; document.querySelector('.tick input').click(); await settle(200); return [before, b.disabled, b.classList.contains('danger')]`), [true, false, true]);
  await shot('03-restore-dialog');
  await js(`await click('.dlg button', 'Replace everything'); await answerGate(false);`);
  check('PIN cancelled → nothing replaced, dialog still open', await js(`return [await idbCount('items'), !!dlg('Replace all inventory with this backup?')]`), [128, true]);
  await js(`await click('.dlg button', 'Replace everything'); await answerGate(true); await waitGone('.dlg'); await settle(800);`);
  const restored = await js(`return (await idb('items')).map(({ updatedAt, ...r }) => r)`);
  check('restored: 129 items equal to the backed-up ones (counts, notes, location)', [restored.length, JSON.stringify(restored) === JSON.stringify(original)], [129, true]);
  check('restored: 128 photos, location list, toast', await js(`return [await idbCount('photos'), (await idb('locations')).map((l) => l.name), toast().startsWith('Restored 129 items and 128 photos')]`), [128, ['Bin "A", top'], true]);
  check('PIN and settings untouched by restore (lastBackupAt still 1)', await js(`return (await idb('settings', 'lastBackupAt')).value`), 1);
  await js(`await go('#/inventory'); await settle(800);`);
  check('Inventory shows the restored data (thumbnails render)', await js(`return [norm(document.querySelector('.top .small').textContent).startsWith('129 items'), document.querySelectorAll('img').length > 0]`), [true, true]);
  await js(`await go('#/more/backup'); await settle(500);`);

  // ── CSV-only restore keeps photos for matching ids ──
  await js(`await choose(0, 'inventory-backup-2026-10-11-0900.csv', new TextEncoder().encode(${JSON.stringify(csvFile.text)}), 'text/csv'); await waitDlg('Replace all inventory with this backup?');`);
  check('CSV restore: photos kept from this tablet; saved date from the file name', await js(`return [cmpRows()[1][2], cmpRows()[3][2]]`), ['128 kept from this tablet', 'Oct 11, 2026 9:00 AM (from the file name)']);
  await js(`document.querySelector('.tick input').click(); await settle(150); await click('.dlg button', 'Replace everything'); await answerGate(true); await waitGone('.dlg'); await settle(600);`);
  check('CSV restore applied: 129 items, 128 photos kept', await js(`return [await idbCount('items'), await idbCount('photos'), (await idb('items', 'st-0001')).onHand]`), [129, 128, 5]);

  // ── Back up this tablet first (from the restore dialog) ──
  await js(CAPTURE + `window.__files = []; await choose(0, 'x.zip', unb64(${JSON.stringify(full.b64)}), 'application/zip'); await waitDlg('Replace all inventory with this backup?'); await click('.dlg button', 'Back up this tablet first'); for (let i = 0; i < 150 && !window.__files.length; i++) await settle(100); await settle(500);`);
  check('Back up first: downloads a full backup, noted in the dialog, dialog stays', await js(`return [window.__files.length, /inventory-backup-.*\\.zip/.test(window.__files[0]?.name), norm(document.querySelector('.dlg').textContent).includes('Backed up first'), !!dlg('Replace all inventory with this backup?')]`), [1, true, true, true]);
  await js(`await click('.dlg button', 'Cancel');`);

  // ── A bad restore file: problems listed, nothing changes ──
  await js(`await choose(0, 'bad.csv', new TextEncoder().encode('id,name,category,unit,on_hand,desired,v1_supplier,v1_pack_size\\nx1,A,Motors,each,1,1,REV,1\\nx2,B,Motors,each,-1,1,REV,1\\n'), 'text/csv'); await waitDlg('Can’t restore this file — nothing was changed');`);
  check('bad restore file: row-numbered problem, nothing changed', await js(`return [norm(document.querySelector('.problems li').textContent), await idbCount('items')]`), ['Row 3: on hand can\'t be negative', 129]);
  await shot('04-restore-problem');
  await js(`await click('.dlg button', 'OK');`);

  // ── Price-update import (F18, 8d, 8e) ──
  const priceCsv = 'id,v1_pack_price,v1_price_checked,v1_supplier,on_hand\r\nst-0001,123.45,11/02/2026,,77\r\nst-0003,,2026-11-02,FIRST Storefront,\r\nst-0200,1.00,,,\r\n';
  const pickPrices = `await choose(1, 'prices-2026-11-02.csv', new TextEncoder().encode(${JSON.stringify(priceCsv)}), 'text/csv'); await waitDlg('Check the price update');`;
  const vendorsBefore = await js(`return [(await idb('items', 'st-0001')).vendors[0], (await idb('items', 'st-0003')).vendors[0]]`);
  check('price preview before the PIN: changes listed, supplier change flagged, no PIN yet', await js(pickPrices + `const d = dlg('Check the price update'); return [norm(d.querySelector('.pv-warn').textContent).startsWith('1 change besides prices and dates'), [...d.querySelectorAll('.pv-flag')].map((e) => norm(e.textContent)).some((t) => t.startsWith('! supplier:') && t.endsWith('→ FIRST Storefront')), d.querySelectorAll('.pv-list > li').length, !pinDlg()]`), [true, true, 2, true]);
  await shot('05a-price-preview');
  check('preview Cancel: nothing changed, no PIN asked', await js(`await click('.dlg button', 'Cancel'); await settle(300); return [!dlg('Check the price update'), !pinDlg(), JSON.stringify([(await idb('items', 'st-0001')).vendors[0], (await idb('items', 'st-0003')).vendors[0]])]`), [true, true, JSON.stringify(vendorsBefore)]);
  await js(pickPrices + `await click('.dlg button', 'Import changes'); await answerGate(true); await waitDlg('Price update imported');`);
  check('price import summary (8d)', await js(`return [...document.querySelectorAll('.sumt tr')].map((r) => norm(r.textContent))`), [
    '2vendor options updated — price, pack size, link, price-checked date',
    '0vendor options already up to date',
    '0counts changed — imports never touch on hand, desired or spares',
    '1ids not found, skipped: st-0200',
    '1new supplier added to the list: FIRST Storefront',
  ]);
  check('ignored columns listed', await js(`return norm(document.querySelector('.dlg').textContent).includes('Ignored columns (not price fields): on_hand')`), true);
  await shot('05-price-done');
  check('price saved; on hand untouched; supplier added', await js(`const a = await idb('items', 'st-0001'); const b = await idb('items', 'st-0003'); return [a.vendors[0].packPriceCents, a.vendors[0].priceChecked, a.onHand, b.vendors[0].supplier, (await idb('suppliers')).some((s) => s.name === 'FIRST Storefront')]`), [12345, '2026-11-02', 5, 'FIRST Storefront', true]);
  await js(`await click('.dlg button', 'See the order list'); await settle(600);`);
  check('See the order list opens Order', await js(`return location.hash`), '#/order');
  await js(`await go('#/more/backup');`);
  const before13 = await js(`return JSON.stringify((await idb('items', 'st-0013')).vendors)`);
  await js(`await choose(1, 'prices-bad.csv', new TextEncoder().encode('id,v1_pack_size,v4_pack_price\\nst-0013,2.5,\\n'), 'text/csv'); await waitDlg('Couldn’t import — nothing was changed');`);
  check('bad price file (8e): every problem by row, no PIN asked', await js(`return [[...document.querySelectorAll('.problems li')].map((l) => norm(l.textContent)), !document.querySelector('[aria-label="Mentor PIN"]')]`), [['Row 1: column “v4_pack_price” isn’t recognized — items have at most 3 vendor options (v1_, v2_, v3_)'], true]);
  await js(`await click('.dlg button', 'OK');`);
  await js(`await choose(1, 'prices-bad2.csv', new TextEncoder().encode('id,v1_pack_size\\nst-0013,2.5\\n'), 'text/csv'); await waitDlg('Couldn’t import — nothing was changed');`);
  check('bad row named with row number and id', await js(`return norm(document.querySelector('.problems li').textContent)`), 'Row 2 (st-0013): v1_pack_size "2.5" must be a whole number ≥ 1');
  await shot('06-price-error');
  await js(`await click('.dlg button', 'OK');`);
  check('nothing changed by the bad files', await js(`return JSON.stringify((await idb('items', 'st-0013')).vendors)`), before13);

  // ── Portrait, targets, text ──
  await size(800, 1280);
  await sleep(400);
  check('portrait: one column', await js(`return getComputedStyle(document.querySelector('.bk')).gridTemplateColumns.split(' ').length`), 1);
  await shot('07-backup-portrait');
  await size(1280, 800);
  await sleep(300);
  check('touch targets ≥ 48 px', await js(`return [...document.querySelectorAll('.main button, .main a, .main input:not([type=file])')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.height < 47.5 || r.width < 47.5); }).map((e) => (e.getAttribute('aria-label') || e.textContent.trim()) + ' ' + Math.round(e.getBoundingClientRect().height))`), []);
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
