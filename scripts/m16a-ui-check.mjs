// M16a real-browser check: helper devices on the main tablet (§18.1), the count kit (§18.2),
// the count-in start screen (F24: Helper devices, each group's helper) and count times saved as
// local date-times with offset (§3). The kit is caught at the share sheet and read here.
// Usage: npm run build && node scripts/m16a-ui-check.mjs <chrome.exe> <screenshot dir>
import { tempDir, track } from './tmp-cleanup.mjs';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import JSZip from 'jszip';
import Papa from 'papaparse';
import { PIN_H } from './pin-helpers.mjs';

const [chrome, outDir] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const preview = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', '4338', '--strictPort'], { stdio: 'ignore' });
const port = 9354;
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

const ORIGIN = 'http://localhost:4338';
const PAGE = `
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const norm = (s) => s.replace(/\\s+/g, ' ').trim();
  const byText = (sel, t) => $$(sel).find((b) => norm(b.textContent).includes(t));
  const settle = (ms = 350) => new Promise((r) => setTimeout(r, ms));
  const click = async (sel, t) => { const b = byText(sel, t); if (!b) throw new Error('nothing like ' + sel + ' with text ' + t); b.click(); await settle(); return b; };
  const type = async (sel, v) => { const el = $(sel); el.focus(); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); await settle(300); };
  const go = async (h) => { location.hash = h; await settle(700); };
  const toast = () => norm($('.toast span')?.textContent ?? '');
  const dlg = () => $('.dlg');
  const err = () => $$('.dlg .err').map((e) => norm(e.textContent));
  const group = async (name) => { const b = $$('.hgroup').find((x) => norm(x.querySelector('strong').textContent) === name); if (!b) throw new Error('no group ' + name); b.click(); await settle(150); };
  const card = (name) => $$('.hcard').find((c) => norm(c.querySelector('.h2').textContent) === name);
  const cov = () => $$('.cov-row').map((r) => [norm(r.querySelector('strong').textContent), r.classList.contains('open'), norm(r.lastElementChild.textContent)]);
  const idbAll = (store) => new Promise((res, rej) => {
    const r = indexedDB.open('frc2408-inventory');
    r.onsuccess = () => { const db = r.result; const q = db.transaction(store).objectStore(store).getAll(); q.onsuccess = () => { res(q.result); db.close(); }; q.onerror = () => rej(q.error); };
    r.onerror = () => rej(r.error);
  });
  // The share sheet: catch the file (or say the person closed the sheet).
  const catchShare = (mode = 'share') => {
    window.__shared = null;
    navigator.canShare = () => true;
    navigator.share = async (d) => {
      if (mode === 'cancel') throw new DOMException('closed', 'AbortError');
      const f = d.files[0];
      const b = new Uint8Array(await f.arrayBuffer());
      let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
      window.__shared = { name: f.name, type: f.type, title: d.title, b64: btoa(s) };
    };
  };
  ${PIN_H}
`;
const P = (expr) => js(`${PAGE} ${expr}`);
const STAMP = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d[+-]\d\d:\d\d$/;

async function readKit() {
  const s = await P(`for (let i = 0; i < 100 && !window.__shared; i++) await settle(100); return window.__shared`);
  if (!s) throw new Error('nothing reached the share sheet');
  const zip = await JSZip.loadAsync(Buffer.from(s.b64, 'base64'));
  const csv = Papa.parse(await zip.file('inventory.csv').async('string'), { header: true, skipEmptyLines: true }).data;
  return { ...s, zip, names: Object.keys(zip.files).filter((n) => !zip.files[n].dir).sort(), kit: JSON.parse(await zip.file('kit.json').async('string')), csv };
}

try {
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await size(1280, 800);
  await send('Page.navigate', { url: ORIGIN + '/' });
  await waitFor(`document.querySelector('.setup')`, 60000);
  await P(`await doSetup();`);
  await waitFor(`document.querySelectorAll('.cathdr').length >= 11`, 60000);
  const items = await P(`return await idbAll('items')`);
  const cats = (await P(`return await idbAll('categories')`)).sort((a, b) => a.order - b.order).map((c) => c.name);
  check('new tablet: every item has counted_by blank and never counted', [items.length, items.every((i) => i.countedBy === '' && i.lastCounted === '')], [129, true]);

  // ── Count-in start screen: Helper devices ──
  await P(`await go('#/count');`);
  check('count-in start: a Helper devices card', await P(`return [norm($('.chelp .chelp-h').textContent), !!byText('.chelp .btn', 'Helper devices'), $$('.cg-help').length]`), ['Count with several devices', true, 0]);
  await P(`await click('.chelp .btn', 'Helper devices');`);
  check('Helper devices: own route, back to Count-in, empty state, no PIN', await P(`return [location.hash, norm($('.top h1').textContent), !!byText('.top .btn', 'Count-in'), !!$('.empty-card'), $$('.pinmark').length]`), ['#/count/helpers', 'Helper devices', true, true, 0]);
  check('coverage: every category in list order, all highlighted as not assigned; no Locations card yet', await P(`return [cov().map((r) => r[0]), cov().every((r) => r[1] && r[2] === 'Not assigned'), $$('.cgroups .h2').map((h) => norm(h.textContent))]`), [cats, true, ['Categories']]);
  await shot('01-helpers-empty');

  // ── Add a helper: the rules ──
  await P(`await click('.top .btn', 'Add helper');`);
  check('add dialog: name, Categories chosen, Locations off until there are locations, every category, new items on', await P(`return [!!$('#hname'), $$('.hkinds .choice').map((c) => [norm(c.textContent), c.getAttribute('aria-checked'), c.disabled]), $$('.hgroup').length, $('.dlg .tog').getAttribute('aria-checked')]`), [true, [['Categories', 'true', false], ['Locations (none yet: add them in More › Locations)', 'false', true]], cats.length, 'true']);
  await P(`await click('.dlg .btn', 'Add helper');`);
  check('nothing filled in: both problems listed, nothing saved', [await P(`return err()`), (await P(`return await idbAll('helpers')`)).length], [['Give the helper a name, e.g. “Tablet 2 · Alex & Jordan”.', 'Choose at least one category to count.'], 0]);
  await P(`await type('#hname', 'Tablet 2 · Alex & Jordan'); await group('Electrical'); await group('Pneumatics'); await click('.dlg .btn', 'Add helper'); await settle(500);`);
  check('added: toast, card with its groups and "No kit sent yet"', await P(`const c = card('Tablet 2 · Alex & Jordan'); return [toast(), [...c.querySelector('.hcard-b').children].map((e) => norm(e.textContent)), norm(c.querySelector('.hcard-h .small').textContent)]`), ['Added “Tablet 2 · Alex & Jordan”. Send it a count kit next.', ['Counts 2 categories: Electrical, Pneumatics', 'New items: allowed (saved as pending for review here)'], 'No kit sent yet']);

  // A second helper sharing Electrical: warned once, then Save anyway.
  await P(`await click('.top .btn', 'Add helper'); await type('#hname', 'Maya’s phone'); await group('Electrical'); await group('Tools'); $('.dlg .tog').click(); await settle(150);`);
  check('the group list says who else has a group', await P(`return norm($$('.hgroup').find((b) => b.textContent.includes('Electrical')).textContent)`), 'Electrical · also Tablet 2 · Alex & Jordan');
  await P(`await click('.dlg .btn', 'Add helper');`);
  check('shared group: the warning, and the button becomes Save anyway; nothing saved yet', [await P(`return [norm($('.hwarn').textContent), norm($('.dlg .btn.pri').textContent)]`), (await P(`return await idbAll('helpers')`)).length], [['Electrical (Tablet 2 · Alex & Jordan) is already assigned. Both will count it; you’ll settle differences on import.', 'Save anyway'], 1]);
  await shot('02-shared-warning');
  await P(`await click('.dlg .btn', 'Save anyway'); await settle(500);`);
  check('saved after the warning', (await P(`return await idbAll('helpers')`)).map((h) => [h.name, h.kind, h.groups, h.allowNewItems]).sort(), [['Maya’s phone', 'category', ['Electrical', 'Tools'], false], ['Tablet 2 · Alex & Jordan', 'category', ['Electrical', 'Pneumatics'], true]]);
  await P(`await click('.top .btn', 'Add helper'); await type('#hname', '  maya’s PHONE '); await group('Safety'); await click('.dlg .btn', 'Add helper');`);
  check('a name already used (other capitals) is refused', await P(`return err()`), ['There’s already a helper called “Maya’s phone”.']);
  await P(`await click('.dlg .btn', 'Cancel');`);
  check('coverage: Electrical has both (with the note), Pneumatics and Tools one each, the rest highlighted', await P(`return [cov().filter((r) => !r[1]), cov().filter((r) => r[1]).length]`), [[['Electrical', false, 'Maya’s phone, Tablet 2 · Alex & Jordan · both count it; settle differences on import'], ['Pneumatics', false, 'Tablet 2 · Alex & Jordan'], ['Tools', false, 'Maya’s phone']], cats.length - 3]);
  await shot('03-helpers');

  // ── Count-in start screen shows each group's helper (F24) ──
  await P(`await go('#/count');`);
  check('count-in start: the card counts helpers; each category row names its helper(s)', await P(`return [norm($('.chelp .chelp-h').textContent), $$('.cg-row').filter((r) => r.querySelector('.cg-help')).map((r) => [norm(r.querySelector('strong').textContent), norm(r.querySelector('.cg-help').textContent)])]`), ['2 helper devices', [['Electrical', 'Helper: Maya’s phone, Tablet 2 · Alex & Jordan'], ['Pneumatics', 'Helper: Tablet 2 · Alex & Jordan'], ['Tools', 'Helper: Maya’s phone']]]);
  await shot('04-count-start');

  // ── Send count kit, with photos ──
  await P(`await go('#/count/helpers'); catchShare(); card('Tablet 2 · Alex & Jordan').querySelector('.btn.pri').click(); await settle(600);`);
  check('send dialog: what goes in, Include photos on with its size, the name-lock note', await P(`return [norm($('.dlg .h2').textContent), norm($('.dlg .dlg-p').textContent), $('.dlg .tog').getAttribute('aria-checked'), /Include photos \\(\\d+ photos, about [\\d.]+ MB\\)/.test(norm($('.dlg .tog').textContent)), /name can’t change/.test(norm($('.dlg').textContent))]`), ['Send a count kit to “Tablet 2 · Alex & Jordan”', 'The kit holds all 129 items (search and scan reach any item), the supplier, location and category lists, and this helper’s 2 categories: Electrical, Pneumatics. Prices are left out.', 'true', true, true]);
  await shot('05-send-dialog');
  await P(`await click('.dlg .btn', 'Send count kit');`);
  const k1 = await readKit();
  await sleep(600);
  check('the share sheet gets count-kit-<helper>-<time>.zip', [/^count-kit-tablet-2-alex-jordan-\d{4}-\d\d-\d\d-\d{4}\.zip$/.test(k1.name), k1.type, k1.title], [true, 'application/zip', 'Count kit for Tablet 2 · Alex & Jordan']);
  const helpers1 = await P(`return await idbAll('helpers')`);
  const t2 = helpers1.find((h) => h.name.startsWith('Tablet 2'));
  check('kit.json: format and version, kit id, helper, created_at (local with offset), app version, groups, new items', [k1.kit.format, k1.kit.format_version, k1.kit.kit_id === t2.kits[0]?.id, k1.kit.helper_id === t2.id, k1.kit.helper_name, STAMP.test(k1.kit.created_at), k1.kit.created_at === t2.kits[0]?.createdAt, k1.kit.app_version, k1.kit.groups, k1.kit.allow_new_items], ['frc2408-count-kit', 1, true, true, 'Tablet 2 · Alex & Jordan', true, true, '0.8.0', { kind: 'category', names: ['Electrical', 'Pneumatics'] }, true]);
  const photoRows = (await P(`return (await idbAll('photos')).length`));
  check('files: kit.json, inventory.csv, the three lists and every photo; no order lists or manifest', [k1.names.filter((n) => !n.startsWith('photos/')), k1.names.filter((n) => n.startsWith('photos/')).length], [['categories.csv', 'inventory.csv', 'kit.json', 'locations.csv', 'suppliers.csv'], photoRows]);
  check('inventory.csv: every item, with prices and price-checked dates blank, counts and names as stored', [k1.csv.length, k1.csv.every((r) => [1, 2, 3].every((s) => r[`v${s}_pack_price`] === '' && r[`v${s}_price_checked`] === '')), JSON.stringify(k1.csv.map((r) => [r.id, r.name, r.on_hand, r.desired, r.category, r.v1_part_no]).sort()) === JSON.stringify(items.map((i) => [i.id, i.name, String(i.onHand), String(i.desired), i.category, i.vendors[0]?.partNo ?? '']).sort())], [items.length, true, true]);
  check('sent: toast, the card says when and that the name is locked', await P(`return [toast().startsWith('Sent count-kit-tablet-2-alex-jordan-'), /^Last kit sent today \\d+:\\d\\d [AP]M · name locked$/.test(norm(card('Tablet 2 · Alex & Jordan').querySelector('.hcard-h .small').textContent))]`), [true, true]);
  await shot('06-sent');

  // Without photos.
  await P(`catchShare(); card('Tablet 2 · Alex & Jordan').querySelector('.btn.pri').click(); await settle(600); $('.dlg .tog').click(); await settle(150); await click('.dlg .btn', 'Send count kit');`);
  const k2 = await readKit();
  await sleep(600);
  const t2b = (await P(`return await idbAll('helpers')`)).find((h) => h.name.startsWith('Tablet 2'));
  check('Include photos off: no photos and photo_file blank; a new kit id, recorded', [k2.names.filter((n) => n.startsWith('photos/')).length, k2.csv.every((r) => r.photo_file === ''), k2.kit.kit_id !== k1.kit.kit_id, t2b.kits.map((k) => k.id)], [0, true, true, [k1.kit.kit_id, k2.kit.kit_id]]);
  check('…and the card counts the kits', await P(`return norm(card('Tablet 2 · Alex & Jordan').querySelector('.hcard-h .small').textContent).includes('2 kits sent')`), true);

  // Closing the share sheet records nothing.
  await P(`catchShare('cancel'); card('Maya’s phone').querySelector('.btn.pri').click(); await settle(600); await click('.dlg .btn', 'Send count kit'); await settle(800);`);
  check('share sheet closed: the dialog stays, no kit recorded, the name not locked', [await P(`return !!$('.dlg')`), (await P(`return await idbAll('helpers')`)).find((h) => h.name.startsWith('Maya')).kits], [true, []]);
  await P(`await click('.dlg .btn', 'Cancel');`);

  // ── Edit: the name is locked after a kit; groups and new items can change ──
  await P(`card('Tablet 2 · Alex & Jordan').querySelector('.acts .btn.sm').click(); await settle();`);
  check('edit after a kit: the name field is locked, with why', await P(`return [$('#hname').disabled, /Locked: a kit was sent/.test(norm($('.dlg').textContent))]`), [true, true]);
  await P(`await group('Pneumatics'); await group('Fasteners'); await click('.dlg .btn', 'Save'); await settle(500);`);
  check('edited groups saved (list order), kits kept', (await P(`return await idbAll('helpers')`)).filter((h) => h.name.startsWith('Tablet 2')).map((h) => [h.groups, h.kits.length]), [[['Electrical', 'Fasteners'], 2]]);
  await P(`card('Maya’s phone').querySelector('.acts .btn.sm').click(); await settle(); await type('#hname', 'Maya P'); await click('.dlg .btn', 'Save'); await settle(500);`);
  check('a helper without a kit can be renamed', (await P(`return await idbAll('helpers')`)).map((h) => h.name).sort(), ['Maya P', 'Tablet 2 · Alex & Jordan']);

  // ── Locations: a helper can count locations once there are any ──
  await P(`
    const db = await new Promise((res) => { const r = indexedDB.open('frc2408-inventory'); r.onsuccess = () => res(r.result); });
    await new Promise((res) => { const t = db.transaction('locations', 'readwrite'); t.objectStore('locations').put({ key: 'bin a', name: 'Bin A', notes: '', order: 0 }); t.objectStore('locations').put({ key: 'shelf b', name: 'Shelf B', notes: '', order: 1 }); t.oncomplete = res; });
    db.close();`);
  // Written outside the app, so reload for it to read them.
  await send('Page.reload');
  await waitFor(`document.querySelectorAll('.cov-row').length >= 11`, 30000);
  check('with locations: a Locations card with "No location" last, all unassigned', await P(`return [$$('.cgroups .h2').map((h) => norm(h.textContent)), cov().slice(-3)]`), [['Categories', 'Locations'], [['Bin A', true, 'Not assigned'], ['Shelf B', true, 'Not assigned'], ['No location', true, 'Not assigned']]]);
  await P(`await click('.top .btn', 'Add helper'); await type('#hname', 'Shelf crew'); await click('.hkinds .choice', 'Locations');`);
  check('Locations: the groups switch to the walk order and "No location"', await P(`return $$('.hgroup strong').map((s) => norm(s.textContent))`), ['Bin A', 'Shelf B', 'No location']);
  await P(`await group('Shelf B'); await group('No location'); await click('.dlg .btn', 'Add helper'); await settle(500);`);
  check('a location helper', (await P(`return await idbAll('helpers')`)).filter((h) => h.name === 'Shelf crew').map((h) => [h.kind, h.groups]), [['location', ['Shelf B', 'No location']]]);
  await P(`await go('#/count'); await click('.modes .mode', 'By location');`);
  check('count-in by location names the location helper', await P(`return $$('.cg-row').filter((r) => r.querySelector('.cg-help')).map((r) => [norm(r.querySelector('strong').textContent), norm(r.querySelector('.cg-help').textContent)])`), [['No location', 'Helper: Shelf crew']]);
  await P(`await click('.modes .mode', 'By category'); await go('#/count/helpers');`);

  // ── A group removed from the list (independent review, finding 2) ──
  await P(`await click('.top .btn', 'Add helper'); await type('#hname', 'Gone test'); await group('Assemblies'); await group('Misc'); await click('.dlg .btn', 'Add helper'); await settle(500);`);
  // Assemblies is empty in the seed; take it out of the list behind the app's back, then reload.
  await P(`
    const db = await new Promise((res) => { const r = indexedDB.open('frc2408-inventory'); r.onsuccess = () => res(r.result); });
    await new Promise((res) => { const t = db.transaction('categories', 'readwrite'); t.objectStore('categories').delete('Assemblies'); t.oncomplete = res; });
    db.close();`);
  await send('Page.reload');
  await waitFor(`document.querySelectorAll('.hcard').length >= 3`, 30000);
  check('a removed group: the card says so', await P(`return norm(card('Gone test').querySelector('.hnote').textContent)`), 'No longer in the list: Assemblies. Edit this helper before sending a kit.');
  await P(`card('Gone test').querySelector('.acts .btn.sm').click(); await settle();`);
  check('edit: the removed group is taken off and named; the rest stay ticked', await P(`return [norm($('.dlg [role=status]').textContent), $$('.hgroup[aria-checked=true] strong').map((s) => norm(s.textContent))]`), ['No longer in the list, so taken off this helper: Assemblies.', ['Misc']]);
  await P(`await click('.dlg .btn', 'Save'); await settle(500);`);
  check('…and Save works straight away; the card is clear', [(await P(`return await idbAll('helpers')`)).find((h) => h.name === 'Gone test')?.groups, await P(`return !card('Gone test').querySelector('.hnote')`)], [['Misc'], true]);
  await P(`card('Gone test').querySelector('.btn.danger').click(); await settle(); await click('.dlg .btn', 'Remove helper'); await settle(400);`);

  // ── Remove ──
  await P(`card('Maya P').querySelector('.btn.danger').click(); await settle();`);
  check('remove: a confirmation in destructive style that says imported counts stay', await P(`return [dlg().getAttribute('role'), norm($('.dlg .dlg-big').textContent), !!$('.dlg .btn.danger')]`), ['alertdialog', 'Counts already imported from it stay as they are. A counts file it sends later can still be imported, after a warning.', true]);
  await P(`await click('.dlg .btn', 'Remove helper'); await settle(400);`);
  check('removed', (await P(`return await idbAll('helpers')`)).map((h) => h.name).sort(), ['Shelf crew', 'Tablet 2 · Alex & Jordan']);
  check('helpers never changed an item', (await P(`return await idbAll('items')`)).map(({ updatedAt, ...r }) => r), items.map(({ updatedAt, ...r }) => r));

  // ── A count saved here is a local date-time with offset; counted_by blank ──
  await P(`await go('#/count'); await click('.cg-row .btn', 'Start');`);
  const first = await P(`return norm($('.wname').textContent)`);
  await P(`await click('.pad button', '3'); await click('.wacts .btn', 'Save & next'); await settle(500);`);
  const counted = (await P(`return await idbAll('items')`)).find((i) => i.name === first);
  const offset = await P(`const o = -new Date().getTimezoneOffset(); return (o < 0 ? '-' : '+') + String(Math.floor(Math.abs(o) / 60)).padStart(2, '0') + ':' + String(Math.abs(o) % 60).padStart(2, '0')`);
  check('count-in save: on_hand 3, last_counted local date-time with this device’s offset, counted_by blank', [counted.onHand, STAMP.test(counted.lastCounted), counted.lastCounted.slice(-6) === offset, counted.lastCounted.slice(0, 10) === (await P(`const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')`)), counted.countedBy], [3, true, true, true, '']);
  await P(`await go('#/item/' + encodeURIComponent('${counted.id}'));`);
  check('detail card shows the count date', await P(`return /^Counted [A-Z][a-z]{2} \\d{1,2}, \\d{4}$/.test(norm(byText('.chip.mut', 'Counted').textContent))`), true);
  await P(`await go('#/count');`);
  check('progress counts it', await P(`return norm($('.cprog-t span').textContent)`), '1 of 129 counted');

  // ── §17: touch targets; portrait ──
  await P(`await go('#/count/helpers'); await click('.top .btn', 'Add helper');`);
  const small = `return [...document.querySelectorAll('.top .btn, .hcard button, .chelp a, .dlg button, .dlg input')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.height < 47.5 || r.width < 47.5); }).map((e) => (e.className || e.tagName) + ':' + Math.round(e.getBoundingClientRect().width) + 'x' + Math.round(e.getBoundingClientRect().height))`;
  check('landscape: touch targets ≥ 48 px (screen and dialog)', await js(small), []);
  await shot('07-add-dialog');
  await P(`await click('.dlg .btn', 'Cancel');`);
  await size(800, 1280);
  await sleep(500);
  check('portrait: touch targets ≥ 48 px; nothing wider than the screen', [await js(small), await js(`return document.documentElement.scrollWidth <= innerWidth`)], [[], true]);
  await shot('08-portrait');
  await P(`await click('.top .btn', 'Add helper');`);
  check('portrait dialog: touch targets ≥ 48 px; fits', [await js(small), await js(`return document.documentElement.scrollWidth <= innerWidth`)], [[], true]);
  await shot('09-portrait-dialog');
  await P(`await click('.dlg .btn', 'Cancel'); await go('#/count');`);
  check('portrait count-in start: nothing wider than the screen', await js(`return document.documentElement.scrollWidth <= innerWidth`), true);
  await shot('10-portrait-count');
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
