// M15 real-browser check: named order lists (F27), their backup and restore (F15, F17), the
// item delete (F8), and the schema guard (Stage 5 finding 6) on the v2 database.
// Usage: npm run build && node scripts/m15-ui-check.mjs <chrome.exe> <screenshot dir>
import { tempDir, track } from './tmp-cleanup.mjs';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PIN_H } from './pin-helpers.mjs';

const [chrome, outDir] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const preview = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', '4335', '--strictPort'], { stdio: 'ignore' });
const port = 9351;
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

const ORIGIN = 'http://localhost:4335';
const PAGE = `
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const norm = (s) => s.replace(/\\s+/g, ' ').trim();
  const byText = (sel, t) => $$(sel).find((b) => norm(b.textContent).includes(t));
  const settle = (ms = 350) => new Promise((r) => setTimeout(r, ms));
  const click = async (sel, t) => { const b = byText(sel, t); if (!b) throw new Error('nothing like ' + sel + ' with text ' + t); b.click(); await settle(); return b; };
  const type = async (el, v) => { if (typeof el === 'string') el = $(el); el.focus(); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); await settle(150); };
  const pick = async (el, v) => { if (typeof el === 'string') el = $(el); el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); await settle(200); };
  const dlg = (label) => $('[role=dialog][aria-label="' + label + '"], [role=alertdialog][aria-label="' + label + '"]');
  const waitDlg = async (label, ms = 15000) => { const end = Date.now() + ms; while (Date.now() < end) { const d = dlg(label); if (d) return d; await settle(100); } throw new Error('no dialog ' + label); };
  const go = async (h) => { location.hash = h; await settle(700); };
  const toast = () => norm($('.toast span')?.textContent ?? '');
  const idbAll = (store) => new Promise((res, rej) => {
    const r = indexedDB.open('frc2408-inventory');
    r.onsuccess = () => { const db = r.result; const q = db.transaction(store).objectStore(store).getAll(); q.onsuccess = () => { res(q.result); db.close(); }; q.onerror = () => rej(q.error); };
    r.onerror = () => rej(r.error);
  });
  const idbPut = (store, value) => new Promise((res, rej) => {
    const r = indexedDB.open('frc2408-inventory');
    r.onsuccess = () => { const db = r.result; const t = db.transaction(store, 'readwrite'); t.objectStore(store).put(value); t.oncomplete = () => { db.close(); res(); }; t.onerror = () => rej(t.error); };
  });
  const idbVersion = () => new Promise((res) => { const r = indexedDB.open('frc2408-inventory'); r.onsuccess = () => { const v = r.result.version; r.result.close(); res(v); }; });
  const invSearch = async (q) => { await type('.top .searchwrap input', q); await settle(300); };
  const rowMenu = async (name) => { const row = $$('.row').find((r) => norm(r.querySelector('.rname').textContent).startsWith(name)); if (!row) throw new Error('no row ' + name); row.querySelector('.rmenu').click(); await settle(); };
  const lineNames = () => $$('.ogrid.line .lt').map((e) => e.textContent);
  const tiles = () => $$('.sum .tile').map((t) => norm([...t.children].map((c) => c.textContent).join(' ')));
  const tabs = () => $$('.ltabs .ltab:not(.sel)').map((t) => norm([...t.childNodes].map((c) => c.textContent).join(' ')));
  ${PIN_H}
`;
const P = (expr) => js(`${PAGE} ${expr}`);
const money = (s) => +s.replace(/[^0-9.]/g, '');
// Expected list numbers worked out here from the stored items (§4): packs = ceil(qty ÷ pack).
const expectLine = (item, qty) => {
  const v = item.vendors[item.preferredVendor - 1];
  const packs = Math.ceil(qty / v.packSize);
  return { packs, orderQty: packs * v.packSize, total: v.packPriceCents === null ? null : packs * v.packPriceCents };
};
const suggested = (item) => {
  const v = item.vendors[item.preferredVendor - 1];
  const need = item.desired + item.spares - item.onHand;
  return need > 0 ? Math.ceil(need / v.packSize) * v.packSize : v.packSize;
};

try {
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await size(1280, 800);
  await send('Page.navigate', { url: ORIGIN + '/' });
  await waitFor(`document.querySelector('.setup')`, 60000);
  await P(`await doSetup();`);
  await waitFor(`document.querySelectorAll('.cathdr').length >= 11`, 60000);

  // ── The database at this build's schema (v2 in M15, v3 since M16a; stage6-plan §3) ──
  check('a new tablet opens at the current schema (v4 since M19): IndexedDB version 40, orderLists store, schemaVersion 4', await P(`const r = indexedDB.open('frc2408-inventory'); const db = await new Promise((res) => (r.onsuccess = () => res(r.result))); const out = [db.version, [...db.objectStoreNames].includes('orderLists')]; db.close(); return [...out, (await idbAll('settings')).find((s) => s.key === 'schemaVersion')?.value]`), [40, true, 4]);

  const items = await P(`return await idbAll('items')`);
  const byName = (n) => items.find((i) => i.name.startsWith(n));
  const neo = byName('NEO 2.0 Brushless Motor (15T');
  const pdh = byName('Power Distribution Hub');
  const before = items.map(({ updatedAt, ...r }) => r);

  // ── Row menu → Add to order list → New list ──
  await P(`await invSearch('rev-21-1653');`);
  await waitFor(`document.querySelector('.row .rmenu')`);
  await shot('01-row-menu-button');
  await P(`await rowMenu('NEO 2.0 Brushless Motor (15T');`);
  check('row menu (⋮): Add to order list, Open details, Print QR label', await P(`return $$('.menu-acts .btn').map((b) => norm(b.textContent))`), ['Add to order list…', 'Open details', 'Print QR label']);
  await P(`await click('.menu-acts .btn', 'Add to order list');`);
  await P(`await waitDlg('Add to order list');`);
  const neoQ = suggested(neo);
  const neoPack = neo.vendors[neo.preferredVendor - 1].packSize;
  check('Add dialog: no lists yet → "+ New list…"; default = suggested order qty', await P(`const d = dlg('Add to order list'); return [d.querySelector('#alist').value === '\\u0000new', norm(d.querySelector('.num').textContent), byText('.dlg .btn', 'Add to list').disabled]`), [true, String(neoQ / neoPack), true]);
  await P(`await type('#aname', 'WCP order — Nov'); await settle(200);`);
  await shot('02-add-dialog');
  await P(`await click('.dlg .btn', 'Add to list'); await settle(500);`);
  check('added: toast names the item and the new list', await P(`return toast()`), `Added “${neo.name}” to WCP order — Nov.`);
  let lists = await P(`return await idbAll('orderLists')`);
  check('stored: one list with one line, quantity = suggested', lists.map((l) => [l.name, l.key, l.lines, l.itemIds]), [['WCP order — Nov', 'wcp order — nov', [{ itemId: neo.id, quantity: neoQ }], [neo.id]]]);

  // ── Detail card: same list remembered; already on it → asks; Change ──
  await P(`await go('#/item/' + encodeURIComponent(${JSON.stringify(neo.id)})); await click('.dacts .btn', 'Add to order list'); await waitDlg('Add to order list');`);
  check('detail card: Add to order list picks the list used last', await P(`return $('#alist').selectedOptions[0].textContent`), 'WCP order — Nov');
  await P(`$$('.dlg .step')[1].click(); await settle(150); await click('.dlg .btn', 'Add to list'); await waitDlg('Already on this list');`);
  check('already on the list: says so, offers Keep / Change', await P(`const d = dlg('Already on this list'); return [norm(d.querySelector('.h2').textContent), $$('.dlg .btn').map((b) => norm(b.textContent))]`), ['Already on WCP order — Nov', [`Keep ${neoQ}`, `Change to ${neoQ + neoPack}`]]);
  await P(`await click('.dlg .btn', 'Keep'); await settle(300);`);
  check('Keep changes nothing', (await P(`return (await idbAll('orderLists'))[0].lines`)), [{ itemId: neo.id, quantity: neoQ }]);
  await P(`await click('.dacts .btn', 'Add to order list'); await waitDlg('Add to order list'); $$('.dlg .step')[1].click(); await settle(150); await click('.dlg .btn', 'Add to list'); await waitDlg('Already on this list'); await click('.dlg .btn', 'Change to'); await settle(400);`);
  const neoQ2 = neoQ + neoPack;
  check('Change replaces the quantity', (await P(`return (await idbAll('orderLists'))[0].lines`)), [{ itemId: neo.id, quantity: neoQ2 }]);

  // ── Scan result: typed code → Add to order list ──
  // No camera in this headless Chrome, so the code goes in the no-camera panel's box.
  await P(`await go('#/scan'); for (let i = 0; i < 50 && !$('#mc') && !byText('.ctop .btn', 'Type a code'); i++) await settle(100);
           if ($('#mc')) { await type('#mc', ${JSON.stringify(pdh.barcode || pdh.id)}); await click('.denied-type button', 'Find'); }
           else { await click('.ctop .btn', 'Type a code'); await type('.spanel input[aria-label=Code]', ${JSON.stringify(pdh.barcode || pdh.id)}); await click('.spanel button[type=submit]', 'Find item'); }
           await settle(500);`);
  check('scan result offers Add to order list', await P(`return !!byText('.sp-foot .btn, .spanel .btn', 'Add to order list')`), true);
  await P(`await click('.sp-foot .btn, .spanel .btn', 'Add to order list'); await waitDlg('Add to order list'); await click('.dlg .btn', 'Add to list'); await settle(500);`);
  const pdhQ = suggested(pdh);
  check('scan → added to the remembered list', (await P(`return (await idbAll('orderLists'))[0].lines`)), [{ itemId: neo.id, quantity: neoQ2 }, { itemId: pdh.id, quantity: pdhQ }]);
  check('lists never changed an item', (await P(`return (await idbAll('items')).map(({ updatedAt, ...r }) => r)`)), before);

  // ── The Order screen: tabs, the list, totals ──
  await P(`await go('#/order');`);
  await waitFor(`document.querySelectorAll('.ogrid.line').length > 0`);
  check('order tabs: Automatic, the list with its count, New list; the automatic list is unchanged', await P(`return [tabs(), tiles().slice(0, 2)]`), [['Automatic', 'WCP order — Nov 2', 'Placed orders', 'New list'], ['Grand total $8,413.66', 'Lines 124']]);
  await P(`await click('.ltabs .ltab', 'WCP order — Nov');`);
  await waitFor(`location.hash.startsWith('#/order/ol-')`);
  await sleep(500);
  const eNeo = expectLine(neo, neoQ2);
  const ePdh = expectLine(pdh, pdhQ);
  const expTotal = (eNeo.total ?? 0) + (ePdh.total ?? 0);
  check('list view: title, header actions, two lines', await P(`return [norm($('.top h1').textContent), $$('.lhead .btn').map((b) => norm(b.textContent)), lineNames().sort()]`), ['WCP order — Nov', ['Rename / notes', 'Duplicate', 'Delete list'], [neo.name, pdh.name].sort()]);
  check('grand total = Σ packs × pack price, worked out from the stored items', await P(`return tiles()[0]`), `Grand total $${(expTotal / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  check('NEO line: wanted, packs, order qty', await P(`const l = $$('.ogrid.line').find((x) => x.querySelector('.lt').textContent === ${JSON.stringify(neo.name)}); return [...l.querySelectorAll('.n')].slice(0, 4).map((n) => norm(n.textContent))`), [String(neoQ2), String(neoPack), String(eNeo.packs), `${eNeo.orderQty} ${neo.unit}`]);
  await shot('03-named-list');

  // +/− on a line, then remove with a confirmation.
  const lineCtl = (n, i) => `$$('.ogrid.line').find((x) => x.querySelector('.lt').textContent === ${JSON.stringify(n)}).querySelectorAll('.lctl button')[${i}]`;
  await P(`${lineCtl(pdh.name, 1)}.click(); await settle(500);`);
  const pdhPack = pdh.vendors[pdh.preferredVendor - 1].packSize;
  check('+ adds one pack', (await P(`return (await idbAll('orderLists'))[0].lines.find((l) => l.itemId === ${JSON.stringify(pdh.id)}).quantity`)), (Math.ceil(pdhQ / pdhPack) + 1) * pdhPack);
  await P(`${lineCtl(pdh.name, 0)}.click(); await settle(500);`);
  check('− takes it back; − is off at one pack', [await P(`return (await idbAll('orderLists'))[0].lines.find((l) => l.itemId === ${JSON.stringify(pdh.id)}).quantity`), await P(`return ${lineCtl(pdh.name, 0)}.disabled`)], [Math.ceil(pdhQ / pdhPack) * pdhPack, Math.ceil(pdhQ / pdhPack) === 1]);

  // ── Search and both exports on a named list ──
  await js(`window.__files = []; navigator.canShare = () => true; navigator.share = async (d) => { window.__files.push({ name: d.files[0].name, text: await d.files[0].text() }); };`);
  await P(`await click('.top .btn', 'Export CSV'); await settle(); await click('.dlg button', 'Share CSV'); await settle(700);`);
  const f1 = await js(`return window.__files.at(-1)`);
  const r1 = f1.text.replace(/^﻿/, '').trim().split('\r\n');
  check('Export CSV: list name in the file name and first row; F13 header; grand total', [/^order-list-wcp-order-nov-\d{4}-\d{2}-\d{2}-\d{4}\.csv$/.test(f1.name), r1[0], r1[1].startsWith('Supplier,Part #,Item,'), money(r1.find((r) => r.startsWith('Grand total')).split(',')[9]).toFixed(2)], [true, 'Order list: WCP order — Nov', true, (expTotal / 100).toFixed(2)]);
  await P(`const s = $('.searchwrap input'); s.focus(); s.value = 'neo'; s.dispatchEvent(new Event('input', { bubbles: true })); await settle(400);`);
  check('search on the list: "Showing 1 of 2 lines"', await P(`return [lineNames(), tiles()[1]]`), [[neo.name], 'Showing 1 of 2 lines']);
  await P(`await click('.top .btn', 'Export shown lines only'); await settle(); await click('.dlg button', 'Share CSV'); await settle(700);`);
  const f2 = await js(`return window.__files.at(-1)`);
  check('Export shown lines only: name + filtered in the file name; both notes in the first row', [/^order-list-wcp-order-nov-filtered-neo-\d{4}-\d{2}-\d{2}-\d{4}\.csv$/.test(f2.name), f2.text.replace(/^﻿/, '').split('\r\n')[0].startsWith('"Order list: WCP order — Nov · Filtered order list: only the 1 of 2 lines matching ""neo"".')], [true, true]);
  await P(`const s = $('.searchwrap input'); s.value = ''; s.dispatchEvent(new Event('input', { bubbles: true })); await settle(300);`);

  // Remove a line (asks first).
  await P(`${lineCtl(pdh.name, 2)}.click(); await waitDlg('Remove from list');`);
  await P(`await click('.dlg .btn', 'Keep it'); await settle(200);`);
  check('Keep it: the line stays', (await P(`return (await idbAll('orderLists'))[0].lines.length`)), 2);
  await P(`${lineCtl(pdh.name, 2)}.click(); await waitDlg('Remove from list'); await click('.dlg .btn', 'Remove'); await settle(500);`);
  check('Remove: the line goes', [await P(`return lineNames()`), await P(`return (await idbAll('orderLists'))[0].lines.map((l) => l.itemId)`)], [[neo.name], [neo.id]]);

  // ── Rename / notes, duplicate, delete ──
  await P(`await click('.lhead .btn', 'Rename'); await waitDlg('Edit list'); await type('#lname', 'wcp order — nov'); await type('#lnotes', 'Ask about\\nthe discount'); await click('.dlg .btn', 'Save'); await settle(400);`);
  check('rename (capitals only) and notes', await P(`return [norm($('.top h1').textContent), $('.lnotes').textContent]`), ['wcp order — nov', 'Ask about\nthe discount']);
  await P(`await click('.lhead .btn', 'Duplicate'); await settle(800);`);
  check('duplicate: opens the copy, with the same line', await P(`return [norm($('.top h1').textContent), lineNames(), tabs()]`), ['wcp order — nov (copy)', [neo.name], ['Automatic', 'wcp order — nov 1', 'wcp order — nov (copy) 1', 'Placed orders', 'New list']]);
  await P(`await click('.ltabs .ltab', 'New list'); await waitDlg('New order list'); await type('#lname', 'WCP ORDER — NOV');`);
  check('a name that clashes ignoring capitals is refused', await P(`return [norm($('.dlg .err').textContent), byText('.dlg .btn', 'Make list').disabled]`), ['There’s already a list called “wcp order — nov”.', true]);
  await P(`await type('#lname', 'Competition spares'); await click('.dlg .btn', 'Make list'); await settle(700);`);
  check('new list: opens empty, with how to add items', await P(`return [norm($('.top h1').textContent), norm($('.state .h2').textContent), $('.top .btn.pri').disabled]`), ['Competition spares', 'No items on this list yet', true]);
  await shot('04-empty-list');
  await P(`await click('.lhead .btn', 'Delete list'); await waitDlg('Delete list'); await click('.dlg .btn', 'Delete list'); await settle(700);`);
  check('delete list: back to Automatic; the list is gone', await P(`return [location.hash, tabs()]`), ['#/order', ['Automatic', 'wcp order — nov 1', 'wcp order — nov (copy) 1', 'Placed orders', 'New list']]);

  // ── Full backup has order-lists.csv; restore the backup after changes ──
  await js(`window.__zip = null; navigator.canShare = () => true; navigator.share = async (d) => { window.__zip = new Uint8Array(await d.files[0].arrayBuffer()); };`);
  await P(`await go('#/more/backup'); document.querySelectorAll('.bkopt')[0].click(); for (let i = 0; i < 150 && !window.__zip; i++) await settle(100);`);
  check('full backup ZIP names order-lists.csv', await js(`return new TextDecoder('latin1').decode(window.__zip).includes('order-lists.csv')`), true);
  // Change the lists, then restore: the backup's lists come back.
  await P(`await go('#/order'); await click('.ltabs .ltab', '(copy)'); await settle(500); await click('.lhead .btn', 'Delete list'); await waitDlg('Delete list'); await click('.dlg .btn', 'Delete list'); await settle(600);`);
  await P(`await go('#/more/backup'); const input = document.querySelectorAll('input[type=file]')[0]; const dt = new DataTransfer(); dt.items.add(new File([window.__zip], 'inventory-backup-2026-10-23-1200.zip', { type: 'application/zip' })); input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true })); await waitDlg('Replace all inventory with this backup?'); await settle(300);`);
  check('restore comparison: Order lists row (1 now, 2 in the backup)', await P(`return $$('.cmp tbody tr').map((r) => [...r.cells].map((c) => norm(c.textContent))).find((r) => r[0] === 'Order lists')`), ['Order lists', '1', '2']);
  await shot('05-restore-dialog');
  await P(`document.querySelector('.tick input').click(); await settle(150); await click('.dlg button', 'Replace everything'); await answerGate(true); for (let i = 0; i < 100 && dlg('Replace all inventory with this backup?'); i++) await settle(100); await settle(600);`);
  check('after the full restore: both lists are back', (await P(`return (await idbAll('orderLists')).map((l) => l.name).sort()`)), ['wcp order — nov', 'wcp order — nov (copy)']);

  // ── Deleting an item that's on lists (F8, F27) ──
  await P(`await go('#/item/' + encodeURIComponent(${JSON.stringify(neo.id)})); await click('.dacts button', 'Delete item'); await answerGate(true, true); await waitDlg('Delete item');`);
  check('delete confirmation says which lists it is on', await P(`return norm(byText('.dlg .dlg-p', 'named order list').textContent)`), 'It’s also on 2 named order lists (wcp order — nov, wcp order — nov (copy)) and will be taken off them.');
  await shot('06-delete-item');
  await P(`await click('[aria-label="Delete item"] button', 'Delete item'); await settle(700); await relockNow();`);
  check('deleted: off both lists; toast says so', [await P(`return (await idbAll('orderLists')).map((l) => l.lines.length)`), await P(`return toast()`)], [[0, 0], `Deleted “${neo.name}” and took it off 2 order lists.`]);

  // ── §17: touch targets; portrait ──
  // PDH goes on the list used last ("wcp order — nov"), so that list has a line to measure.
  await P(`await go('#/item/' + encodeURIComponent(${JSON.stringify(pdh.id)})); await click('.dacts .btn', 'Add to order list'); await waitDlg('Add to order list'); await click('.dlg .btn', 'Add to list'); await settle(500);`);
  await P(`await go('#/order'); await click('.ltabs .ltab', 'wcp order — nov'); await settle(500);`);
  check('the list shown has a line with +/− and remove', await P(`return [norm($('.top h1').textContent), $$('.lctl button').length]`), ['wcp order — nov', 3]);
  const small = `return [...document.querySelectorAll('.top button, .top input, .ltabs a, .ltabs button, .lhead button, .lctl button, .rmenu')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.height < 47.5 || r.width < 47.5); }).map((e) => (e.className || e.tagName) + ':' + Math.round(e.getBoundingClientRect().width) + 'x' + Math.round(e.getBoundingClientRect().height))`;
  check('landscape: touch targets ≥ 48 px (tabs, header, line controls)', await js(small), []);
  await shot('07-list-landscape');
  await size(800, 1280);
  await sleep(500);
  check('portrait: touch targets ≥ 48 px; nothing wider than the screen', [await js(small), await js(`return document.documentElement.scrollWidth <= innerWidth`)], [[], true]);
  await shot('08-list-portrait');
  await P(`await go('#/inventory'); await invSearch('pdh');`);
  check('portrait inventory row: ⋮ ≥ 48 px, nothing wider than the screen', [await js(small), await js(`return document.documentElement.scrollWidth <= innerWidth`)], [[], true]);
  await shot('09-row-portrait');
  await size(1280, 800);

  // ── Schema guard: a database from a newer version isn't touched (finding 6) ──
  const settingsBefore = await P(`return await idbAll('settings')`);
  // One above the app's schema version (4 since M19), so this build is the older one.
  await P(`await idbPut('settings', { key: 'schemaVersion', value: 5 });`);
  await send('Page.reload');
  await waitFor(`document.querySelector('.state h2')`, 30000);
  await sleep(800);
  check('newer database: "out of date" screen with Reload, no inventory shown', await P(`return [norm($('.state .h2').textContent), !!byText('.state .btn', 'Reload'), $$('.row').length]`), ['This app is out of date — reload to update', true, 0]);
  check('…and nothing was written', (await P(`return await idbAll('settings')`)).filter((s) => s.key !== 'schemaVersion'), settingsBefore.filter((s) => s.key !== 'schemaVersion'));
  await shot('10-outdated');
  await P(`await idbPut('settings', { key: 'schemaVersion', value: 4 });`);
  await send('Page.reload');
  await waitFor(`document.querySelectorAll('.cathdr').length >= 11`, 30000);
  check('back to the current version: the inventory opens again', await P(`return $$('.cathdr').length >= 11`), true);
} catch (e) {
  results.push('ERROR ' + e.message);
  await shot('error').catch(() => {});
} finally {
  console.log(results.join('\n'));
  process.exitCode = results.some((r) => /^(FAIL|ERROR)/.test(r)) ? 1 : 0;
  console.log(problems.length ? 'Console problems:\n' + problems.join('\n') : 'No console errors or warnings');
  ws.close();
  proc.kill();
  preview.kill();
  process.exit(process.exitCode);
}
