// M3 real-browser check: detail, add/edit/delete, suppliers, categories, locations, and where
// the PIN gate is (and isn't) asked. Drives the production build in headless Chrome over CDP.
// Usage: npm run build && node scripts/m3-ui-check.mjs <chrome.exe> <screenshot dir>
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PIN_H } from './pin-helpers.mjs';

const [chrome, outDir] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const preview = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', '4320', '--strictPort'], { stdio: 'ignore' });
const port = 9336;
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
  const r = await send('Runtime.evaluate', { expression: `(async () => { ${H} ${expr} })()`, awaitPromise: true, returnByValue: true });
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

const COUNT_GATES = `
  window.__gates = 0;
  new MutationObserver(() => {
    const d = document.querySelector('[aria-label="Mentor PIN"]');
    if (d && !d.__seen) { d.__seen = true; window.__gates++; }
  }).observe(document.body, { childList: true, subtree: true });
`;

const today = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();

try {
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await size(1280, 800);
  await send('Page.navigate', { url: 'http://localhost:4320/' });
  await waitFor(`document.querySelector('.setup')`, 60000);
  await js(`await doSetup();`);
  await waitFor(`document.querySelectorAll('.cathdr').length >= 11`, 60000);
  await js(COUNT_GATES);

  // ── Detail card (F10, F11) ──
  await js(`[...document.querySelectorAll('.cathdr')].find((b) => b.textContent.includes('Electrical')).click(); await settle(); [...document.querySelectorAll('.subhdr')].find((b) => b.textContent.includes('Motors')).click(); await settle();`);
  await js(`document.querySelector('.list').scrollTop = 200; await settle(100);`);
  await js(`await click('a.rlink', 'NEO 2.0 Brushless Motor'); await settle(400);`);
  check('row tap opens the detail card', await js(`return [location.hash, document.querySelector('.top .h1').textContent, document.querySelector('.top .small').textContent]`), ['#/item/st-0063', 'NEO 2.0 Brushless Motor (15T spline shaft)', 'Electrical › Motors']);
  check('status, source, id and counted chips', await js(`return [...document.querySelectorAll('.dchips .chip')].map((c) => norm(c.textContent))`), ['SHORT 8', 'Starter item', 'ID st-0063', 'Not counted yet']);
  check('stock and order lines (§4)', await js(`return [...document.querySelectorAll('.qty-title')].map((e) => e.textContent).concat(document.querySelector('.ordbox .small').textContent)`), ['Short 8 for current needs', 'Order 8 each', '8 × $55.00 = $440.00 from REV (preferred vendor)']);
  check('vendor options open the product page in a new tab (F11)', await js(`return [...document.querySelectorAll('.vend a.btn')].map((a) => [a.target, a.rel, a.href.startsWith('https://')])[0]`), ['_blank', 'noopener noreferrer', true]);
  await sleep(600);
  check('photo shown and enlarges', await js(`const p = document.querySelector('.photo img'); const ok = !!p && p.complete && p.naturalWidth > 0; document.querySelector('button.photo').click(); await settle(); const lb = !!document.querySelector('.lb img'); byText('.lb button', 'Close').click(); await settle(); return [ok, lb, !document.querySelector('.lb')]`), [true, true, true]);
  await shot('01-detail');
  await js(`document.querySelector('.dright button[aria-label="Desired plus one"]').click(); await settle(400);`);
  await js(`document.querySelectorAll('.dright button[aria-label="Plus one"]')[0].click(); await settle(500);`);
  check('detail steppers save on hand and desired; last counted stays blank (Q7)', await js(`const r = await idb('items', 'st-0063'); return [r.onHand, r.desired, r.lastCounted, document.querySelector('.qty-title').textContent]`), [1, 9, '', 'Short 8 for current needs']);
  await js(`await click('.top button', 'Back'); await settle(500);`);
  check('Back returns to the list where it was', await js(`return [!!document.querySelector('.cathdr'), document.querySelector('.list').scrollTop > 150]`), [true, true]);
  check('no PIN asked so far', await js(`return gates()`), 0);

  // ── Edit (F7): plain fields need no PIN ──
  await js(`await go('#/item/st-0063'); await click('a.btn', 'Edit item');`);
  check('editor opens with vendor fields PIN-locked', await js(`return [location.hash, document.querySelectorAll('.vopt select:disabled, .vopt input:disabled').length > 0, norm(document.querySelector('.vtitle .chip').textContent)]`), ['#/item/st-0063/edit', true, 'PIN-locked']);
  await shot('02-edit-locked');
  await js(`await type('#nm', 'NEO 2.0 Brushless Motor (15T spline shaft) — test'); await type('[aria-label="Spares"]', '2'); await type('#nt', 'line one\\nline "two", with commas'); await click('.top button', 'Save'); await settle(600);`);
  check('save without vendor changes asks no PIN and opens the detail card', await js(`return [gates(), location.hash, document.querySelector('.top .h1').textContent]`), [0, '#/item/st-0063', 'NEO 2.0 Brushless Motor (15T spline shaft) — test']);
  check('edit saved to IndexedDB (notes with quotes, commas, a new line)', await js(`const r = await idb('items', 'st-0063'); return [r.spares, r.notes, r.onHand, r.lastCounted]`), [2, 'line one\nline "two", with commas', 1, '']);
  await js(`await click('.top button', 'Back'); await settle(500);`);
  check('Back after saving skips the editor', await js(`return [location.hash === '' || location.hash === '#/inventory', !!document.querySelector('.cathdr')]`), [true, true]);

  // ── Edit vendors: PIN asked once, price date filled (Q9) ──
  await js(`await go('#/item/st-0063/edit'); await click('.lockbar button', 'Unlock'); await answerGate(true, true);`);
  check('Unlock asks the PIN once and opens the vendor fields', await js(`return [gates(), document.querySelectorAll('.vopt select:disabled, .vopt input:disabled').length, norm(document.querySelector('.vtitle .chip').textContent)]`), [1, 0, 'Unlocked']);
  await js(`await type('#v1-price', '60.00'); await settle(100);`);
  check('changing the price fills "checked" with today (Q9b)', await js(`return document.querySelector('#v1-chk').value`), today);
  await shot('03-edit-unlocked');
  await js(`await click('.top button', 'Save'); await settle(600);`);
  check('save after unlocking asks no second PIN; new price shown', await js(`return [gates(), document.querySelector('.ordbox .small').textContent]`), [1, '10 × $60.00 = $600.00 from REV (preferred vendor)']);
  await js(`document.querySelector('.lockpill.on')?.click(); await settle(150);`);

  // ── Cancel with changes asks before discarding ──
  await js(`await go('#/item/st-0063/edit'); await type('#nm', 'scratch'); await click('.top button', 'Cancel');`);
  check('Cancel with changes asks first', await js(`return !!dlg('Discard changes')`), true);
  await js(`await click('[aria-label="Discard changes"] button', 'Discard changes'); await settle(500);`);
  check('discarding leaves the item unchanged', await js(`return [location.hash, (await idb('items', 'st-0063')).name]`), ['#/item/st-0063', 'NEO 2.0 Brushless Motor (15T spline shaft) — test']);

  // ── Add (F6) ──
  await js(`await go('#/inventory'); await click('a.btn', 'Add item');`);
  await js(`await click('.top button', 'Add item');`);
  check('empty form lists every problem (mockup 3d)', await js(`return [...document.querySelectorAll('.errsum li')].map((l) => l.textContent)`), ['Name is required.', 'Vendor option 1: choose a supplier (it is the preferred vendor).']);
  await shot('04-add-errors');
  await js(`await type('#nm', 'Standoff 1/2 in. hex, test'); await pick('#cat', 'Mechanical'); await pick('#sub', '__new'); await type('#ns', 'Standoffs Test');
    await pick('#v1-sup', 'REV'); await type('#v1-part', 'REV-29-2817'); await type('#v1-ps', '2.5'); await type('[aria-label="On hand"]', '3'); await type('[aria-label="Desired"]', '8');
    await click('.top button', 'Add item');`);
  check('pack size 2.5 rejected', await js(`return [...document.querySelectorAll('.errsum li')].map((l) => l.textContent)`), ['Vendor option 1: pack size “2.5” must be a whole number of 1 or more.']);
  await js(`await type('#v1-ps', '4'); await type('#v1-price', '5'); await pick('#loc', '__new'); await type('[aria-label="New location name"]', 'Pit cart'); await click('.inline-add button', 'Add'); await settle(400);`);
  check('a new location is added from the editor without the PIN (F25)', await js(`return [gates(), document.querySelector('#loc').value, (await idb('locations')).map((l) => l.name)]`), [1, 'Pit cart', ['Pit cart']]);
  await js(`await relockNow(); await click('.ecol button', 'Add vendor option'); await answerGate(false);`);
  check('a second vendor option while adding asks the PIN; cancel keeps one option (F6)', await js(`return [gates(), document.querySelectorAll('.vopt').length]`), [2, 1]);
  await js(`await click('.top button', 'Add item'); await settle(700);`);
  const newId = await js(`return decodeURIComponent(location.hash.split('/')[2] ?? '')`);
  check('add saves a team item with a tm- id and opens it; no PIN for vendor option 1', [/^tm-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{5}$/.test(newId), await js(`return gates()`)], [true, 2]);
  check('new item in IndexedDB: counted today, team, packs of 4 at $5.00', await js(`const r = await idb('items', ${JSON.stringify(newId)}); return [r.source, r.lastCounted, r.onHand, r.desired, r.subcategory, r.location, r.vendors[0].packSize, r.vendors[0].packPriceCents, r.vendors[0].priceChecked]`), ['team', today, 3, 8, 'Standoffs Test', 'Pit cart', 4, 500, today]);
  check('new subcategory added to Mechanical (F6)', await js(`return (await idb('categories', 'Mechanical')).subcategories.at(-1)`), 'Standoffs Test');
  check('header count now 130 items (the new one is short)', await js(`await go('#/inventory'); return document.querySelector('.top .small').textContent`), '130 items · 125 short · 0 low spares');

  // ── Delete (F8) ──
  await js(`await relockNow(); await go('#/item/' + encodeURIComponent(${JSON.stringify(newId)})); await click('.dacts button', 'Delete item'); await answerGate(true, true);`);
  check('delete asks the PIN, then confirms with name and on hand (mockup 2c)', await js(`const d = dlg('Delete item'); return [gates(), norm(d.querySelector('.del-name').textContent), norm(d.querySelector('.dlg-big').textContent)]`), [3, 'Standoff 1/2 in. hex, test', 'On hand: 3 each']);
  await shot('05-delete-confirm');
  await js(`await click('[aria-label="Delete item"] button', 'Keep item');`);
  check('Keep item changes nothing', await js(`return [!dlg('Delete item'), !!(await idb('items', ${JSON.stringify(newId)}))]`), [true, true]);
  await js(`await relockNow(); await click('.dacts button', 'Delete item'); await answerGate(true, true); await click('[aria-label="Delete item"] button', 'Delete item'); await settle(600);`);
  check('delete removes the item and returns to the list', await js(`return [location.hash, (await idb('items', ${JSON.stringify(newId)})) ?? null, document.querySelector('.top .small').textContent]`), ['#/inventory', null, '129 items · 124 short · 0 low spares']);
  check('a deleted item’s link shows "not found"', await js(`await go('#/item/' + encodeURIComponent(${JSON.stringify(newId)})); return document.querySelector('.state h2').textContent`), `No item “${newId}” on this tablet`);

  // ── Suppliers (F23) ──
  await js(`await go('#/more'); await click('a.mrow', 'Suppliers');`);
  check('suppliers A–Z with other last; usage shown', await js(`return [[...document.querySelectorAll('.sname')].map((e) => e.textContent), document.querySelector('.top .small').textContent]`), [['Amazon', 'AndyMark', 'CTRE', 'McMaster-Carr', 'other', 'REV', 'Thrifty Bot', 'VEX', 'WCP'].sort((a, b) => (a === 'other') - (b === 'other') || a.localeCompare(b, 'en', { sensitivity: 'base' })), '9 suppliers · used by 168 vendor options']);
  check('"other" has no Remove button', await js(`const row = [...document.querySelectorAll('.srow')].find((r) => r.querySelector('.sname').textContent === 'other'); return [!!byText('.srow button', 'Edit notes'), !row.querySelector('button.danger'), norm(row.querySelector('.chip').textContent)]`), [true, true, 'Fallback — can’t remove']);
  await shot('06-suppliers');
  const g0 = await js(`return gates()`);
  await js(`await relockNow(); await click('.top button', 'Add supplier'); await answerGate(true, true); await type('#en-name', 'andymark');`);
  check('duplicate supplier rejected as you type (mockup 7b)', await js(`const d = dlg('Add a supplier'); return [norm(d.querySelector('.err').textContent), d.querySelector('button[type=submit]').disabled]`), ['“andymark” is already in the list as “AndyMark”. Names are compared ignoring capitals.', true]);
  await js(`await type('#en-name', 'Digi-Key'); await type('#en-site', 'digikey.com'); await click('[aria-label="Add a supplier"] button', 'Add supplier'); await settle(500);`);
  check('supplier added, website gets https://', await js(`const s = await idb('suppliers', 'digi-key'); return [s.name, s.website, gates() - ${g0}]`), ['Digi-Key', 'https://digikey.com', 1]);
  await js(`await relockNow(); const row = [...document.querySelectorAll('.srow')].find((r) => r.querySelector('.sname').textContent === 'WCP'); row.querySelector('button').click(); await settle(); await answerGate(false);`);
  check('PIN cancelled → no rename dialog', await js(`return !document.querySelector('[role=dialog]')`), true);
  await js(`await relockNow(); const row = [...document.querySelectorAll('.srow')].find((r) => r.querySelector('.sname').textContent === 'WCP'); row.querySelector('button').click(); await settle(); await answerGate(true, true); await type('#en-name', 'West Coast Products'); await click('.dlg button[type=submit]', 'Rename'); await settle(600);`);
  check('rename updates every vendor option (F23)', await js(`const items = await idb('items'); const names = items.flatMap((i) => i.vendors.filter(Boolean).map((v) => v.supplier)); return [names.filter((n) => n === 'WCP').length, names.filter((n) => n === 'West Coast Products').length > 0]`), [0, true]);
  await js(`await relockNow(); const row = [...document.querySelectorAll('.srow')].find((r) => r.querySelector('.sname').textContent === 'AndyMark'); row.querySelector('button.danger').click(); await settle(); await answerGate(true, true);`);
  check('remove shows the count and defaults to other (mockup 7c)', await js(`const d = dlg('Remove supplier'); return [/^\\d+ vendor options use AndyMark \\(\\d+ preferred\\)/.test(norm(d.querySelector('.dlg-big').textContent)), norm(d.querySelector('[aria-checked="true"]').textContent), norm(byText('.dlg button', 'and remove').textContent)]`), [true, 'other', 'Move to other and remove']);
  await shot('07-supplier-remove');
  await js(`await click('[aria-label="Remove supplier"] button', 'Move to other and remove'); await settle(600);`);
  check('AndyMark removed; its options now use other', await js(`const items = await idb('items'); const names = items.flatMap((i) => i.vendors.filter(Boolean).map((v) => v.supplier)); return [!(await idb('suppliers', 'andymark')), names.includes('AndyMark'), names.filter((n) => n === 'other').length > 0]`), [true, false, true]);
  await js(`await relockNow(); const row = [...document.querySelectorAll('.srow')].find((r) => r.querySelector('.sname').textContent === 'Digi-Key'); row.querySelector('button.danger').click(); await settle(); await answerGate(true, true);`);
  check('unused supplier: plain remove', await js(`const d = dlg('Remove supplier'); const b = byText('.dlg button', 'Remove Digi-Key'); b.click(); await settle(500); return [!!d, !(await idb('suppliers', 'digi-key'))]`), [true, true]);

  // ── Locations (F25) ──
  await js(`await go('#/more/locations');`);
  const gL = await js(`return gates()`);
  for (const n of ['Bin F1', 'Bin F2']) await js(`await click('.top button', 'Add location'); await type('#en-name', '${n}'); await click('.dlg button[type=submit]', 'Add location'); await settle(400);`);
  check('add location needs no PIN; new ones go last', await js(`return [gates() - ${gL}, [...document.querySelectorAll('.lrow .ln')].map((e) => e.textContent)]`), [0, ['Pit cart', 'Bin F1', 'Bin F2', 'No location']]);
  await js(`await click('.top button', 'Reorder'); document.querySelector('[aria-label="Move Bin F2 up"]').click(); await settle(400); document.querySelector('[aria-label="Move Bin F2 up"]').click(); await settle(400);`);
  check('Reorder ▲ needs no PIN and sets the walk order', await js(`return [gates() - ${gL}, (await idb('locations')).sort((a, b) => a.order - b.order).map((l) => l.name), document.querySelector('[aria-label="Move Bin F2 up"]').disabled]`), [0, ['Bin F2', 'Pit cart', 'Bin F1'], true]);
  await shot('08-locations-reorder');
  await js(`await click('.top button', 'Done');`);
  // Put an item in Bin F1, then remove Bin F1 → No location.
  await js(`await go('#/item/st-0001/edit'); await pick('#loc', 'Bin F1'); await click('.top button', 'Save'); await settle(500); await go('#/more/locations');`);
  await js(`await relockNow(); const row = [...document.querySelectorAll('.lrow')].find((r) => r.querySelector('.ln').textContent === 'Bin F1'); row.querySelector('button.danger').click(); await settle(); await answerGate(true, true);`);
  check('remove a used location asks where its items go (mockup 7j)', await js(`const d = dlg('Remove location'); return [norm(d.querySelector('.dlg-big').textContent).startsWith('It holds 1 item: '), d.querySelector('#mv').value, norm(byText('.dlg button', 'and remove').textContent)]`), [true, '', 'Move to No location and remove']);
  await js(`await click('[aria-label="Remove location"] button', 'and remove'); await settle(500);`);
  check('items moved to No location; location gone', await js(`return [(await idb('items', 'st-0001')).location, (await idb('locations')).map((l) => l.name).sort()]`), ['', ['Bin F2', 'Pit cart']]);
  await js(`await relockNow(); const row = [...document.querySelectorAll('.lrow')].find((r) => r.querySelector('.ln').textContent === 'Pit cart'); row.querySelector('button').click(); await settle(); await answerGate(true, true); await type('#en-name', 'Pit cart A'); await click('.dlg button[type=submit]', 'Save'); await settle(500);`);
  check('rename location asks the PIN', await js(`return [(await idb('locations')).map((l) => l.name).sort(), gates() - ${gL}]`), [['Bin F2', 'Pit cart A'], 2]);

  // ── Categories (F9) ──
  await js(`localStorage.setItem('frc2408.inventory.filters', JSON.stringify({ needsOrder: false, short: false, low: false, category: 'Assemblies', supplier: null, location: null }));`);
  await js(`await go('#/more/categories');`);
  const gC = await js(`return gates()`);
  await js(`await click('.top button', 'Add category'); await type('#en-name', 'Game Pieces'); await click('.dlg button[type=submit]', 'Add category'); await settle(400);`);
  await js(`await click('.top button', 'Reorder'); document.querySelector('[aria-label="Move Game Pieces up"]').click(); await settle(400); await click('.top button', 'Done');`);
  await js(`document.querySelector('[aria-label="Expand Electrical"]').click(); await settle(); await click('.subrow button', 'Add subcategory to Electrical'); await type('#en-name', 'Relays'); await click('.dlg button[type=submit]', 'Add subcategory'); await settle(400);`);
  check('add category, subcategory and reorder need no PIN', await js(`const cats = (await idb('categories')).sort((a, b) => a.order - b.order); return [gates() - ${gC}, cats.at(-2).name, cats[0].subcategories.at(-1)]`), [0, 'Game Pieces', 'Relays']);
  await shot('09-categories');
  await js(`await relockNow(); document.querySelector('[aria-label="Expand Pneumatics"]').click(); await settle(); const row = [...document.querySelectorAll('.subrow')].find((r) => r.textContent.includes('Solenoids')); row.querySelector('button.danger').click(); await settle(); await answerGate(true, true);`);
  check('a subcategory with items can’t be removed until they move (mockup 7g)', await js(`const d = dlg('Remove category'); return [norm(d.querySelector('h2').textContent), d.querySelector('#mv').selectedOptions[0].textContent]`), ['“Pneumatics › Solenoids” isn’t empty yet', 'Pneumatics']);
  const solenoids = await js(`return (await idb('items')).filter((i) => i.category === 'Pneumatics' && i.subcategory === 'Solenoids').map((i) => i.id)`);
  await js(`const sel = document.querySelector('#mv'); await pick(sel, [...sel.options].find((o) => o.textContent === 'Pneumatics › Accumulation').value); await click('.dlg button', 'and remove'); await settle(600);`);
  check('items moved, subcategory removed', await js(`const items = await idb('items'); return [${JSON.stringify(solenoids)}.every((id) => items.find((i) => i.id === id).subcategory === 'Accumulation'), (await idb('categories', 'Pneumatics')).subcategories.includes('Solenoids')]`), [true, false]);
  await js(`await relockNow(); const row = [...document.querySelectorAll('.crow')].find((r) => r.querySelector('.cn').textContent === 'Assemblies'); row.querySelector('.acts button').click(); await settle(); await answerGate(true, true); await type('#en-name', 'Complete Assemblies'); await click('.dlg button[type=submit]', 'Rename'); await settle(600);`);
  check('rename category moves its items (F9)', await js(`const items = await idb('items'); return [items.filter((i) => i.category === 'Assemblies').length, items.filter((i) => i.category === 'Complete Assemblies').length, gates() - ${gC}]`), [0, 1, 2]);
  check('inventory shows the new name; a saved filter on the old name is dropped', await js(`await go('#/inventory'); await settle(400); return [[...document.querySelectorAll('.cathdr .cn')].some((e) => e.textContent === 'Complete Assemblies'), byText('.top .btn', 'Filters').textContent.trim(), JSON.parse(localStorage.getItem('frc2408.inventory.filters')).category]`), [true, 'Filters', null]);

  // ── Portrait and touch targets ──
  await js(`await relockNow();`);
  await size(800, 1280);
  await js(`await go('#/item/st-0063'); await settle(400);`);
  await shot('10-detail-portrait');
  await js(`await go('#/item/st-0063/edit'); await settle(400);`);
  await shot('11-edit-portrait');
  await js(`await go('#/more/suppliers'); await settle(400);`);
  await shot('12-suppliers-portrait');
  await size(1280, 800);
  const small = [];
  for (const h of ['#/item/st-0063', '#/item/st-0063/edit', '#/add', '#/more', '#/more/suppliers', '#/more/categories', '#/more/locations']) {
    small.push(...(await js(`await go('${h}'); await settle(300); return [...document.querySelectorAll('button, a, input, select, textarea')].filter((e) => { if (e.classList.contains('vh')) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (r.height < 47.5 || r.width < 47.5) && !e.closest('.nav'); }).map((e) => '${h} ' + (e.getAttribute('aria-label') || e.textContent.trim() || e.tagName) + ' ' + Math.round(e.getBoundingClientRect().width) + 'x' + Math.round(e.getBoundingClientRect().height))`)));
  }
  check('touch targets ≥ 48 px on every M3 screen', small, []);
  check('text ≥ 15 px on every M3 screen', await js(`const bad = new Set(); for (const h of ['#/item/st-0063', '#/item/st-0063/edit', '#/more', '#/more/suppliers', '#/more/categories', '#/more/locations']) { await go(h); for (const e of document.querySelectorAll('body *')) { if (!e.childNodes.length || ![...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue; const fs = parseFloat(getComputedStyle(e).fontSize); if (fs < 15 && e.getBoundingClientRect().width > 0) bad.add(h + ' ' + e.className + ' ' + fs); } } return [...bad]`), []);
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
