// M15b real-browser check: add many items to an order list at once (F27 "Add many at once",
// Dan 2026-10-23): Select on the automatic list, Add to order list… in Inventory Select mode,
// the quantity rule, items skipped at the target, replace or keep.
// Usage: npm run build && node scripts/m15b-ui-check.mjs <chrome.exe> <screenshot dir>
import { tempDir, track } from './tmp-cleanup.mjs';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PIN_H } from './pin-helpers.mjs';

const [chrome, outDir] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const preview = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', '4337', '--strictPort'], { stdio: 'ignore' });
const port = 9353;
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

const ORIGIN = 'http://localhost:4337';
const PAGE = `
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const norm = (s) => s.replace(/\\s+/g, ' ').trim();
  const byText = (sel, t) => $$(sel).find((b) => norm(b.textContent).includes(t));
  const settle = (ms = 350) => new Promise((r) => setTimeout(r, ms));
  const click = async (sel, t) => { const b = byText(sel, t); if (!b) throw new Error('nothing like ' + sel + ' with text ' + t); b.click(); await settle(); return b; };
  const type = async (sel, v) => { const el = $(sel); el.focus(); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); await settle(400); };
  const pick = async (sel, v) => { const el = $(sel); el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); await settle(250); };
  const dlg = () => $('[role=dialog][aria-label="Add to order list"]');
  const go = async (h) => { location.hash = h; await settle(700); };
  const toast = () => norm($('.toast span')?.textContent ?? '');
  const selCount = () => norm($('.selcount').textContent);
  const idbAll = (store) => new Promise((res, rej) => {
    const r = indexedDB.open('frc2408-inventory');
    r.onsuccess = () => { const db = r.result; const q = db.transaction(store).objectStore(store).getAll(); q.onsuccess = () => { res(q.result); db.close(); }; q.onerror = () => rej(q.error); };
    r.onerror = () => rej(r.error);
  });
  const idbPut = (store, value) => new Promise((res, rej) => {
    const r = indexedDB.open('frc2408-inventory');
    r.onsuccess = () => { const db = r.result; const t = db.transaction(store, 'readwrite'); t.objectStore(store).put(value); t.oncomplete = () => { db.close(); res(); }; t.onerror = () => rej(t.error); };
  });
  const lineIds = () => $$('.ogrid.line .lname').map((b) => b.closest('.line').querySelector('.lt').textContent);
  ${PIN_H}
`;
const P = (expr) => js(`${PAGE} ${expr}`);

// Independent of the app: what each rule gives (§4: packs rounded up), and a list's total.
const pv = (i) => i.vendors[i.preferredVendor - 1];
const rule = (i, r) => {
  const pack = pv(i).packSize;
  if (r === 'pack') return pack;
  const need = (r === 'spares' ? i.desired + i.spares : i.desired) - i.onHand;
  return need > 0 ? Math.ceil(need / pack) * pack : 0;
};
const totalOf = (lines, items) => lines.reduce((s, l) => {
  const i = items.find((x) => x.id === l.itemId);
  const v = pv(i);
  return v.packPriceCents === null ? s : s + Math.ceil(l.quantity / v.packSize) * v.packPriceCents;
}, 0);
const dollars = (c) => `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const matches = (i, q) => { const v = pv(i); return fold([i.name, v.partNo, v.supplier, i.notes].join(' \n ')).includes(fold(q)); };
const needsOrder = (i) => i.desired + i.spares - i.onHand > 0;

try {
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await size(1280, 800);
  await send('Page.navigate', { url: ORIGIN + '/' });
  await waitFor(`document.querySelector('.setup')`, 60000);
  await P(`await doSetup();`);
  await waitFor(`document.querySelectorAll('.cathdr').length >= 11`, 60000);

  // Make the rules differ: one AndyMark item already at its desired count (on the automatic
  // list only because of spares), another with spares. Reload so the app reads them.
  let items = await P(`return await idbAll('items')`);
  const am = items.filter((i) => pv(i).supplier === 'AndyMark' && needsOrder(i)).sort((a, b) => (a.id < b.id ? -1 : 1));
  const atDesired = { ...am[0], onHand: am[0].desired, spares: 2 };
  const withSpares = { ...am[1], spares: 3 };
  await P(`await idbPut('items', ${JSON.stringify(atDesired)}); await idbPut('items', ${JSON.stringify(withSpares)});`);
  await send('Page.reload');
  await waitFor(`document.querySelectorAll('.cathdr').length >= 11`, 60000);
  items = await P(`return await idbAll('items')`);
  const before = items.map(({ updatedAt, ...r }) => r);

  // ── The automatic list: Select ──
  await P(`await go('#/order');`);
  await waitFor(`document.querySelectorAll('.ogrid.line').length > 0`);
  check('Automatic list has Select at the end of the tab row; no checkboxes yet', await P(`return [!!byText('.ltabs .ltab.sel', 'Select'), $$('.lsel').length, !!$('.selbar')]`), [true, 0, false]);
  await P(`await click('.ltabs .ltab.sel', 'Select');`);
  check('Select mode: a checkbox on every line and supplier header; 0 selected; Add disabled; Done', await P(`return [$$('.lsel[role=checkbox]').length === $$('.ogrid.line').length, $$('.shdr .cb[role=checkbox]').length === $$('.shdr').length, selCount(), byText('.selbar .btn', 'Add to order list').disabled, !!byText('.ltabs .ltab', 'Done')]`), [true, true, '0 lines selected', true, true]);

  // Search "andymark", then Select all shown: exactly the lines that search shows.
  await P(`await type('.searchwrap input', 'andymark');`);
  const amShown = items.filter((i) => needsOrder(i) && matches(i, 'andymark'));
  await P(`await click('.selbar .btn', 'Select all shown');`);
  check('search "andymark" + Select all shown: every line shown, worked out from IndexedDB', await P(`return [selCount(), $$('.lsel[aria-checked=true]').length, byText('.selbar .btn', 'Select all shown').disabled]`), [`${amShown.length} lines selected`, amShown.length, true]);
  await shot('01-select-andymark');
  // Another search: the selection stays, and the hidden part is called out.
  await P(`await type('.searchwrap input', 'neo');`);
  const neoShownSel = items.filter((i) => needsOrder(i) && matches(i, 'neo') && amShown.includes(i)).length;
  check('a different search keeps the selection and says how many are hidden', await P(`return selCount()`), `${amShown.length} lines selected${amShown.length - neoShownSel > 0 ? ` · ${amShown.length - neoShownSel} not shown by this search or filter` : ''}`);
  await P(`await type('.searchwrap input', 'andymark');`);

  // A supplier header checkbox toggles that supplier's lines shown.
  const amHdr = `$$('.shdr').find((h) => h.querySelector('.oname').textContent === 'AndyMark').querySelector('.cb')`;
  await P(`${amHdr}.click(); await settle();`);
  const others = amShown.filter((i) => pv(i).supplier !== 'AndyMark').length;
  check('the AndyMark header clears its lines; mixed headers show "mixed"', await P(`return [selCount(), ${amHdr}.getAttribute('aria-checked')]`), [`${others} lines selected`, 'false']);
  await P(`${amHdr}.click(); await settle();`);
  check('…and selects them again', await P(`return [selCount(), ${amHdr}.getAttribute('aria-checked')]`), [`${amShown.length} lines selected`, 'true']);
  // Only AndyMark: clear, then the header.
  await P(`await click('.selbar .btn', 'Clear'); ${amHdr}.click(); await settle();`);
  const amOnly = amShown.filter((i) => pv(i).supplier === 'AndyMark');
  check('only the AndyMark lines', await P(`return selCount()`), `${amOnly.length} lines selected`);

  // ── Add to order list… with a new list, up to desired only ──
  await P(`await click('.selbar .btn', 'Add to order list');`);
  check('dialog: title, new list by default, the three rules (desired + spares picked)', await P(`const d = dlg(); return [norm(d.querySelector('.h2').textContent), d.querySelector('#mlist').value === '\\u0000new', $$('.dlg .choice').map((c) => [norm(c.textContent), c.getAttribute('aria-checked')])]`), [`Add ${amOnly.length} items to an order list`, true, [['Up to desired + spares', 'true'], ['Up to desired only', 'false'], ['One pack each', 'false']]]);
  const skippedDesired = amOnly.filter((i) => rule(i, 'desired') === 0).length;
  check('desired + spares: nothing skipped', await P(`return norm($('.mplan').textContent)`), `${amOnly.length} items to add`);
  await P(`await click('.dlg .choice', 'Up to desired only');`);
  check('desired only: the item already at its desired count is skipped', await P(`return [norm($('.mplan').textContent), norm(byText('.dlg .btn', 'Add to list').textContent)]`), [`${amOnly.length - skippedDesired} items to add · ${skippedDesired} item already at the target, skipped`, `Add to list (${amOnly.length - skippedDesired})`]);
  check('the new list needs a name first', await P(`return byText('.dlg .btn', 'Add to list').disabled`), true);
  await P(`await type('#mname', 'AndyMark — Nov');`);
  await shot('02-add-many-dialog');
  await P(`await click('.dlg .btn', 'Add to list'); await settle(800);`);
  const expLines = amOnly.filter((i) => rule(i, 'desired') > 0).map((i) => ({ itemId: i.id, quantity: rule(i, 'desired') }));
  let lists = await P(`return await idbAll('orderLists')`);
  check('stored: the new list with "up to desired" quantities in whole packs, worked out here', lists.map((l) => [l.name, [...l.lines].sort((a, b) => (a.itemId < b.itemId ? -1 : 1))]), [['AndyMark — Nov', expLines]]);
  check('…the item with spares gets desired − on hand, not desired + spares', lists[0].lines.find((l) => l.itemId === withSpares.id).quantity, rule(withSpares, 'desired'));
  check('opens the list, toast says what happened, Select mode over', await P(`return [location.hash.startsWith('#/order/ol-'), norm($('.top h1').textContent), toast(), !!$('.selbar')]`), [true, 'AndyMark — Nov', `Added ${expLines.length} items to AndyMark — Nov; skipped 1 already at the target.`, false]);
  check('the list’s grand total, worked out here', await P(`return norm($$('.sum .tile')[0].querySelector('.v').textContent)`), dollars(totalOf(expLines, items)));
  await shot('03-new-list');
  check('lists never changed an item', (await P(`return (await idbAll('items')).map(({ updatedAt, ...r }) => r)`)), before);

  // ── Inventory Select mode → Add to order list… (to the same list: asks once) ──
  await P(`await go('#/inventory'); await type('.top .searchwrap input', 'andymark'); await click('.top .btn', 'Select');`);
  check('Inventory select bar: Add to order list… beside Move to…', await P(`return $$('.selbar .btn').map((b) => norm(b.textContent))`), ['Select all shown (' + (await P(`return $$('.selrow').length`)) + ')', 'Clear', 'Add to order list…', 'Move to…']);
  await P(`await click('.selbar .btn', 'Select all shown'); await click('.selbar .btn', 'Add to order list');`);
  // F4 search: name, location, notes and every vendor option's part # and supplier.
  const invChosen = items.filter((i) => fold([i.name, i.location, i.notes, ...i.vendors.flatMap((v) => (v ? [v.partNo, v.supplier] : []))].join(' \n ')).includes('andymark'));
  check('the dialog counts the items the Inventory search shows, worked out here', await P(`return norm(dlg().querySelector('.h2').textContent)`), `Add ${invChosen.length} items to an order list`);
  check('the dialog remembers the list and the rule', await P(`return [$('#mlist').selectedOptions[0].textContent, byText('.dlg .choice', 'Up to desired only').getAttribute('aria-checked')]`), ['AndyMark — Nov', 'true']);
  check('some are on the list already: asks once; Add is off until you choose', await P(`const b = $('.dlg .btn.pri'); return [norm($('#mexist').textContent), norm(b.textContent), b.disabled]`), [`${expLines.length} items are already on AndyMark — Nov`, 'Choose replace or keep', true]);
  await shot('04-asks-once');
  await P(`await click('.dlg .choice', 'Keep them as they are'); await click('.dlg .btn', 'Add to list'); await settle(800);`);
  lists = await P(`return await idbAll('orderLists')`);
  const byId = (ls) => [...ls].sort((a, b) => (a.itemId < b.itemId ? -1 : 1));
  const onList = new Set(expLines.map((l) => l.itemId));
  const added = invChosen.filter((i) => !onList.has(i.id) && rule(i, 'desired') > 0).map((i) => ({ itemId: i.id, quantity: rule(i, 'desired') }));
  check('Keep: the lines already there keep their quantities; only new items needing order are added', byId(lists[0].lines), byId([...expLines, ...added]));

  // Again with One pack each and Replace.
  await P(`await go('#/inventory'); await type('.top .searchwrap input', 'andymark'); await click('.top .btn', 'Select'); await click('.selbar .btn', 'Select all shown'); await click('.selbar .btn', 'Add to order list'); await click('.dlg .choice', 'One pack each'); await click('.dlg .choice', 'Replace their quantities'); await click('.dlg .btn', 'Add to list'); await settle(800);`);
  lists = await P(`return await idbAll('orderLists')`);
  check('One pack each + Replace: every chosen item is on the list with one pack', byId(lists[0].lines), byId(invChosen.map((i) => ({ itemId: i.id, quantity: pv(i).packSize }))));
  check('…and the toast says how many changed', await P(`return /changed \\d+/.test(toast())`), true);

  // ── §17: touch targets; portrait ──
  await P(`await go('#/order'); await click('.ltabs .ltab.sel', 'Select'); await type('.searchwrap input', 'andymark'); await click('.selbar .btn', 'Select all shown'); await click('.selbar .btn', 'Add to order list');`);
  const small = `return [...document.querySelectorAll('.selbar button, .ltabs button, .ltabs a, .lsel, .shdr .cb, .dlg button, .dlg select, .dlg input')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.height < 47.5 || r.width < 47.5); }).map((e) => (e.className || e.tagName) + ':' + Math.round(e.getBoundingClientRect().width) + 'x' + Math.round(e.getBoundingClientRect().height))`;
  check('landscape: touch targets ≥ 48 px (select bar, tabs, line and header checkboxes, dialog)', await js(small), []);
  await P(`await click('.dlg .btn', 'Cancel');`);
  await size(800, 1280);
  await sleep(500);
  check('portrait: touch targets ≥ 48 px; nothing wider than the screen', [await js(small), await js(`return document.documentElement.scrollWidth <= innerWidth`)], [[], true]);
  await shot('05-portrait-select');
  await P(`await click('.selbar .btn', 'Add to order list');`);
  check('portrait dialog: touch targets ≥ 48 px; fits', [await js(small), await js(`return document.documentElement.scrollWidth <= innerWidth`)], [[], true]);
  await shot('06-portrait-dialog');
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
