// H2a real-browser check (SPEC v2.0, milestone H2a: places, bins, seasons). Part 1 builds an H1
// (0.1.1) database exactly as H1 declared it, then opens the app: the in-place upgrade must turn
// its locations into spots in "Unsorted" and keep items and photos. Part 2 starts fresh: areas,
// spots, a bin with an automatic code, an item with every editor field and photos, Move, Split,
// Duplicate, deleting a bin, seasons, tags, bulk Move, labels with the path, then the manifest
// and an iPhone-size layout report. Real IndexedDB, headless Chrome.
// Usage: npm run build && node scripts/h2a-ui-check.mjs <chrome.exe> <screenshot dir>
import { tempDir, track } from './tmp-cleanup.mjs';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [chrome, outDir] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ORIGIN = 'http://localhost:4371';

const preview = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', '4371', '--strictPort'], { stdio: 'ignore' });
const port = 9402;
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
const size = (width, height, mobile = false) => send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
const navigate = async (url) => {
  await send('Page.navigate', { url });
  // Wait until the new document is there (IndexedDB is denied on about:blank).
  for (let i = 0; i < 100; i++) {
    const r = await send('Runtime.evaluate', { expression: 'location.href + "|" + document.readyState', returnByValue: true });
    const [href, state] = String(r.result?.result?.value ?? '').split('|');
    if (href === url && state === 'complete') break;
    await sleep(100);
  }
  await sleep(300);
};
const results = [];
const check = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${JSON.stringify(actual)}${ok ? '' : ` (expected ${JSON.stringify(expected)})`}`);
};
/** Recorded for H3 (the phone layout milestone), not a pass/fail of H2a. */
const info = (name, value) => results.push(`INFO  ${name}: ${JSON.stringify(value)}`);

const H = `
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const settle = (ms = 350) => new Promise((r) => setTimeout(r, ms));
  const norm = (s) => s.replace(/\\s+/g, ' ').trim();
  const byText = (sel, t) => $$(sel).find((b) => norm(b.textContent).includes(t));
  const click = async (sel, t) => { const b = byText(sel, t); if (!b) throw new Error('nothing like ' + sel + ' with text ' + t); b.click(); await settle(); return b; };
  const type = async (el, v) => { if (typeof el === 'string') el = $(el); if (!el) throw new Error('no field'); el.focus(); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); await settle(120); };
  const pick = async (sel, v) => { const el = $(sel); if (!el) throw new Error('no select ' + sel); el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); await settle(150); };
  const pickText = async (sel, t) => { const o = [...$(sel).options].find((x) => norm(x.textContent).includes(t)); if (!o) throw new Error('no option ' + t); await pick(sel, o.value); };
  const dlg = (label) => $('[role=dialog][aria-label="' + label + '"], [role=alertdialog][aria-label="' + label + '"]');
  const idb = (store) => new Promise((res, rej) => {
    const r = indexedDB.open('home-inventory');
    r.onsuccess = () => {
      const db = r.result;
      const q = db.transaction(store).objectStore(store).getAll();
      q.onsuccess = () => { res(q.result); db.close(); };
      q.onerror = () => rej(q.error);
    };
    r.onerror = () => rej(r.error);
  });
  const go = async (h) => { location.hash = h; await settle(700); };
  const toast = () => norm(document.querySelector('.toast span')?.textContent ?? '');
  const jpeg = (color) => new Promise((res) => { const c = document.createElement('canvas'); c.width = 640; c.height = 480; const g = c.getContext('2d'); g.fillStyle = color; g.fillRect(0, 0, 640, 480); c.toBlob((b) => res(new File([b], 'p.jpg', { type: 'image/jpeg' })), 'image/jpeg', 0.8); });
  const choosePhoto = async (scope, color) => { const input = $(scope + ' input[data-photo=gallery]'); const dt = new DataTransfer(); dt.items.add(await jpeg(color)); input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true })); await settle(1200); };
`;

try {
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await size(1280, 800);

  // ── Part 1: an H1 phone upgrades in place ──
  // A same-origin page that doesn't open the database, so H1's can be made first.
  await navigate(`${ORIGIN}/manifest.webmanifest`);
  await js(`
    await new Promise((res, rej) => {
      // Dexie stores version 1 as IndexedDB version 10, with these stores and indexes (H1's db.ts).
      const r = indexedDB.open('home-inventory', 10);
      r.onupgradeneeded = () => {
        const d = r.result;
        const items = d.createObjectStore('items', { keyPath: 'id' });
        for (const i of ['category', 'location', 'barcode']) items.createIndex(i, i);
        d.createObjectStore('photos', { keyPath: 'itemId' });
        d.createObjectStore('locations', { keyPath: 'key' }).createIndex('order', 'order');
        d.createObjectStore('categories', { keyPath: 'name' }).createIndex('order', 'order');
        d.createObjectStore('settings', { keyPath: 'key' });
      };
      r.onsuccess = async () => {
        const d = r.result;
        const photo = await jpeg('#c00');
        const tx = d.transaction(['items', 'photos', 'locations', 'categories', 'settings'], 'readwrite');
        tx.objectStore('categories').put({ name: 'Decorations', order: 0, subcategories: [] });
        tx.objectStore('categories').put({ name: 'Lights', order: 1, subcategories: [] });
        tx.objectStore('locations').put({ key: 'attic shelf b', name: 'Attic shelf B', notes: '', order: 0 });
        tx.objectStore('locations').put({ key: 'garage pegboard', name: 'Garage pegboard', notes: 'left', order: 1 });
        tx.objectStore('items').put({ id: 'it-H1AAAAAA', name: 'Snowman lights', category: 'Lights', subcategory: '', location: 'Attic shelf B', quantity: 3, barcode: '', notes: '', hasPhoto: true, updatedAt: 1 });
        tx.objectStore('items').put({ id: 'it-H1BBBBBB', name: 'Wreath', category: 'Decorations', subcategory: '', location: '', quantity: 1, barcode: '', notes: '', hasPhoto: false, updatedAt: 1 });
        tx.objectStore('photos').put({ itemId: 'it-H1AAAAAA', full: photo, thumb: null, updatedAt: 1, taken: 1 });
        tx.objectStore('settings').put({ key: 'schemaVersion', value: 1 });
        tx.objectStore('settings').put({ key: 'setupDoneAt', value: 1 });
        tx.oncomplete = () => { d.close(); res(); };
        tx.onerror = () => rej(tx.error);
      };
      r.onerror = () => rej(r.error);
    });`);
  await navigate(`${ORIGIN}/#/inventory`);
  await waitFor(`document.querySelector('.list .cathdr')`, 60000);
  const up = await js(`return { areas: await idb('areas'), spots: await idb('spots'), items: await idb('items'), pics: await idb('pictures'), seasons: (await idb('seasons')).length, schema: (await idb('settings')).find((s) => s.key === 'schemaVersion')?.value }`);
  check('upgrade: one Unsorted area (U) with the two locations as spots, in walk order', [up.areas.map((a) => [a.name, a.letter]), up.spots.sort((a, b) => a.order - b.order).map((s) => [s.name, s.notes])], [[['Unsorted', 'U']], [['Attic shelf B', ''], ['Garage pegboard', 'left']]]);
  const atticShelf = up.spots.find((s) => s.name === 'Attic shelf B')?.id;
  check('upgrade: items keep their location as their spot; new fields at defaults; schema 2', [up.items.find((i) => i.id === 'it-H1AAAAAA')?.spotId === atticShelf, up.items.find((i) => i.id === 'it-H1BBBBBB')?.spotId, up.items[0]?.status, up.items[0]?.condition, 'location' in (up.items[0] ?? {}), up.schema], [true, '', 'stored', 'ok', false, 2]);
  check('upgrade: the photo is kept as the item’s first photo; default seasons added', [up.pics.length, up.pics[0]?.ownerId, up.pics[0]?.order, up.seasons], [1, 'it-H1AAAAAA', 0, 10]);
  await js(`await click('.cathdr', 'Lights'); await settle(300);`);
  check('upgrade: the inventory row shows the new path', await js(`return norm(byText('.row', 'Snowman lights')?.querySelector('.rmeta')?.textContent ?? '')`), 'Lights Unsorted › Attic shelf B');
  await shot('01-upgraded-inventory');
  await js(`await go('#/more');`);
  check('More: Areas & spots, Seasons, Tags; version 0.1.2', await js(`return $$('.mrow .mt').map((e) => norm(e.textContent))`), ['Categories', 'Areas & spots', 'Seasons', 'Tags', 'Backup & restore', 'Settings', 'Hiebert Home Inventory', 'App version 0.1.2']);
  // Sort an Unsorted spot into a real area.
  await js(`await go('#/more/places'); await click('.top .btn.pri', 'Add area'); await type('#ar-name', 'Attic'); await click('[role=dialog] .btn.pri', 'Add area'); await settle(500);`);
  await js(`const row = byText('.spot-row', 'Attic shelf B'); row.querySelector('.acts .btn').click(); await settle(400); await pickText('#mv-area', 'Attic'); await click('[role=dialog] .btn.pri', 'Move spot'); await settle(500);`);
  const moved = await js(`const a = await idb('areas'); const s = await idb('spots'); return a.find((x) => x.name === 'Attic')?.id === s.find((x) => x.name === 'Attic shelf B')?.areaId`);
  check('Move spot to another area sorts an Unsorted spot', moved, true);
  await shot('02-places-upgraded');

  // ── Part 2: start fresh ──
  await navigate(`${ORIGIN}/manifest.webmanifest`);
  await js(`await new Promise((res, rej) => { const r = indexedDB.deleteDatabase('home-inventory'); r.onsuccess = res; r.onerror = () => rej(r.error); r.onblocked = () => rej(new Error('blocked')); });`);
  await navigate(`${ORIGIN}/`);
  await waitFor(`document.querySelector('.setup')`, 60000);
  check('first launch: the two choices, no PIN or starter catalog', await js(`return [$$('.sopt .sopt-h').map((e) => norm(e.textContent)), /PIN|helper|starter|mentor/i.test(document.body.textContent)]`), [['Start fresh', 'Restore a backup file'], false]);
  await js(`await click('.setup-acts .btn.pri', 'Start fresh'); await settle(800);`);
  await waitFor(`document.querySelector('.done-ic')`);
  check('start fresh: 13 categories, 10 seasons, no areas', await js(`return [(await idb('categories')).length, (await idb('seasons')).length, (await idb('areas')).length]`), [13, 10, 0]);
  await js(`await click('.setup-acts .btn.pri', 'Add your areas and spots'); await settle(800);`);
  await waitFor(`location.hash === '#/more/places'`);
  check('no areas yet: suggestions offered', await js(`return $$('.empty-card .fchip').map((b) => norm(b.textContent))`), ['Attic', 'Garage', 'Utility room', 'Kitchen', 'Pantry', 'Laundry', 'Basement']);
  await shot('03-places-empty');
  await js(`await click('.empty-card .fchip', 'Attic'); await settle(400); await click('.fchip', 'Garage'); await settle(400);`);
  check('areas added from suggestions, letters from their names', await js(`return (await idb('areas')).sort((a, b) => a.order - b.order).map((a) => [a.name, a.letter])`), [['Attic', 'A'], ['Garage', 'G']]);
  for (const [areaName, spotName] of [['Attic', 'Shelf B'], ['Garage', 'Pegboard']]) {
    await js(`const row = byText('.area-row', '${areaName}'); byText('.area-row .btn', 'Spot') && [...row.querySelectorAll('.btn')].find((b) => norm(b.textContent).includes('Spot')).click(); await settle(400); await type('#en-name', '${spotName}'); await click('[role=dialog] .btn.pri', 'Add spot'); await settle(500);`);
  }
  check('spots under their areas', await js(`return $$('.spot-row .sname').map((e) => norm(e.textContent))`), ['Shelf B', 'Pegboard']);
  await shot('04-places');

  // A bin on Shelf B: the next code in the Attic.
  await js(`await click('.spot-row .spot-link', 'Shelf B'); await settle(600);`);
  await waitFor(`location.hash.startsWith('#/spot/')`);
  await js(`await click('.dacts .btn', 'Add bin here'); await settle(600);`);
  await waitFor(`document.querySelector('#bn')`);
  check('new bin: code suggested from the spot’s area', await js(`return $('#bc').placeholder`), 'A-01');
  await js(`await type('#bn', 'Christmas 4'); await pickText('#bs', 'Christmas'); await type('#btg', 'Heavy'); await click('.top .btn.pri', 'Add bin'); await settle(800);`);
  await waitFor(`location.hash.startsWith('#/bin/')`);
  const bins = await js(`return await idb('bins')`);
  check('bin stored: A-01 on Shelf B, Christmas, tag Heavy', [bins.length, bins[0]?.code, bins[0]?.name, bins[0]?.tags, bins[0]?.state], [1, 'A-01', 'Christmas 4', ['Heavy'], 'stored']);
  check('bin screen: big code, path, season chip', await js(`return [norm($('.bincode').textContent), norm($('.top-title .small').textContent), norm($('.chip.season')?.textContent ?? '')]`), ['A-01', 'Attic › Shelf B', 'Christmas']);
  await js(`await choosePhoto('.carousel', '#06c');`);
  check('a bin photo is saved from its carousel', await js(`return (await idb('pictures')).map((p) => p.ownerType)`), ['bin']);
  await shot('05-bin');

  // An item in the bin with every editor field and two photos.
  await js(`await click('.dacts .btn', 'Add item here'); await settle(700);`);
  await waitFor(`document.querySelector('#nm')`);
  check('Add item here starts in the bin; season follows the bin', await js(`return [norm($('#home').textContent), norm($('#sea').options[0].textContent)]`), ['Attic › Shelf B › A-01 Christmas 4', 'Same as its bin (Christmas)']);
  await js(`
    await type('#nm', 'Glass ornaments'); await pick('#cat', 'Decorations');
    await type($('input[aria-label="Quantity"]'), '40'); const ap = byText('.tick', 'About this many').querySelector('input'); ap.click(); await settle(150);
    await pick('#cond', 'needs repair'); await settle(200); await type('#cn', 'two cracked');
    await type('#tg', 'Fragile'); await click('.inline-add .btn', 'Add');
    await type('#val', '24.99');
    $('details.records').open = true; await settle(100);
    await type('#md', 'GO-40'); await type('#pd', '2023-11-24');
  `);
  await js(`await choosePhoto('.fbody', '#0a0');`);
  await js(`await choosePhoto('.fbody', '#a0a');`);
  check('editor: two new photos wait for Save', await js(`return [$$('.pthumb.new').length, (await idb('pictures')).length]`), [2, 1]);
  await shot('06-editor');
  await js(`await click('.top .btn.pri', 'Add item'); await settle(1000);`);
  await waitFor(`location.hash.startsWith('#/item/')`);
  const orn = (await js(`return await idb('items')`)).find((i) => i.name === 'Glass ornaments');
  check('item stored with every field', orn && [orn.binId === bins[0].id, orn.spotId, orn.quantity, orn.approx, orn.seasonId, orn.tags, orn.condition, orn.conditionNote, orn.value, orn.model, orn.purchaseDate, orn.status, orn.hasPhoto], [true, '', 40, true, '', ['Fragile'], 'needs repair', 'two cracked', 2499, 'GO-40', '2023-11-24', 'stored', true]);
  check('item photos saved in order', await js(`return (await idb('pictures')).filter((p) => p.ownerType === 'item').sort((a, b) => a.order - b.order).map((p) => p.order)`), [0, 1]);
  check('detail: path, condition, season from its bin, tag; value', await js(`return [norm($('.top-title .small').textContent), $$('.dchips .chip').map((c) => norm(c.textContent)).slice(0, 3), byText('.kv span', '$')?.textContent]`), ['Attic › Shelf B › A-01 Christmas 4', ['Needs repair', 'Christmas', 'Fragile'], '$24.99']);
  check('detail: the Tags list gained Fragile', await js(`return (await idb('tags')).map((t) => t.name).sort()`), ['Fragile', 'Heavy']);
  await shot('07-item');
  const ornId = orn.id;

  // Move to the Pegboard (a loose item on a spot).
  await js(`await click('.dacts .btn', 'Move…'); await settle(400); await click('.hp-row', 'Pegboard'); await click('[role=dialog] .btn.pri', 'Move here'); await settle(600);`);
  check('Move: now a loose item on the Pegboard', await js(`const i = (await idb('items')).find((x) => x.id === '${ornId}'); const s = (await idb('spots')).find((x) => x.name === 'Pegboard'); return [i.binId, i.spotId === s.id, norm($('.top-title .small').textContent)]`), ['', true, 'Garage › Pegboard']);
  // Split 6 off into the bin.
  await js(`await click('.dacts .btn', 'More…'); await click('.menu-acts .btn', 'Split this line'); await settle(300); await type('#split-n', '6'); await click('[role=dialog] .btn', 'Garage › Pegboard'); await settle(300); await click('.hp-row', 'A-01 Christmas 4'); await click('[role=dialog] .btn.pri', 'Choose'); await settle(300); await click('[role=dialog] .btn.pri', 'Split off 6'); await settle(800);`);
  const after = await js(`return (await idb('items')).filter((i) => i.name === 'Glass ornaments').map((i) => [i.quantity, i.binId ? 'bin' : 'spot']).sort((a, b) => a[0] - b[0])`);
  check('Split a line: 6 in the bin, 34 stay on the Pegboard', after, [[6, 'bin'], [34, 'spot']]);
  // Duplicate.
  await js(`await go('#/item/${ornId}'); await click('.dacts .btn', 'More…'); await click('.menu-acts .btn', 'Duplicate'); await settle(800);`);
  check('Duplicate: a copy with the photos, opened', await js(`const c = (await idb('items')).find((i) => i.name === 'Glass ornaments (copy)'); const p = (await idb('pictures')).filter((x) => x.ownerId === c?.id); return [!!c, p.length, location.hash === '#/item/' + c?.id]`), [true, 2, true]);

  // Seasons and tags.
  await js(`await go('#/more/seasons'); await click('.top .btn.pri', 'Add season'); await type('#se-name', 'Birthday'); await click('[role=dialog] .btn.pri', 'Add season'); await settle(500);`);
  check('Seasons: added with the next free color', await js(`const s = (await idb('seasons')).find((x) => x.name === 'Birthday'); return [!!s, typeof s?.color, (await idb('seasons')).length]`), [true, 'string', 11]);
  await shot('08-seasons');
  await js(`await go('#/more/tags'); const row = byText('.lrow', 'Fragile'); [...row.querySelectorAll('.btn')].find((b) => norm(b.textContent) === 'Rename').click(); await settle(300); await type('#en-name', 'Breakable'); await click('[role=dialog] .btn.pri', 'Save'); await settle(500);`);
  check('Tags: a rename reaches every item', await js(`return (await idb('items')).filter((i) => i.name.startsWith('Glass')).map((i) => i.tags.join()).sort()`), ['Breakable', 'Breakable', 'Breakable']);

  // Delete the bin; its item moves to the bin's spot.
  const binId = bins[0].id;
  await js(`await go('#/bin/${binId}'); await click('.dacts .btn.danger', 'Delete bin'); await settle(300);`);
  check('delete bin asks what happens to its items', await js(`return [!!dlg('Delete bin'), $$('[role=alertdialog] .tick span').map((s) => norm(s.textContent))]`), [true, ['Keep them: move them to the spot Shelf B', 'Delete them too (Glass ornaments)']]);
  await js(`await click('[role=alertdialog] .btn.danger', 'Delete bin'); await settle(700);`);
  check('bin deleted; its item is a loose item on Shelf B', await js(`const sb = (await idb('spots')).find((s) => s.name === 'Shelf B'); return [(await idb('bins')).length, (await idb('items')).filter((i) => i.spotId === sb.id).map((i) => i.quantity), (await idb('pictures')).filter((p) => p.ownerType === 'bin').length]`), [0, [6], 0]);

  // Inventory: search the path, filter by area, bulk Move.
  await js(`await go('#/inventory'); await type('input[aria-label="Search inventory"]', 'pegboard'); await settle(300);`);
  check('search finds items by their spot', await js(`return $$('.row .rname').map((e) => norm(e.textContent)).sort()`), ['Glass ornaments', 'Glass ornaments (copy)']);
  check('quick filters: category, area, season', await js(`return $$('.frow .fchip').map((b) => norm(b.textContent)).slice(0, 3)`), ['Category: All', 'Area: All', 'Season: All']);
  await js(`await click('.top .btn', 'Select'); await click('.selbar .btn', 'Select all shown'); await click('.selbar .btn.pri', 'Move to'); await settle(300); await click('.hp-row', 'Shelf B'); await click('[role=dialog] .btn.pri', 'Move here'); await settle(700);`);
  check('bulk Move to a spot', await js(`const sb = (await idb('spots')).find((s) => s.name === 'Shelf B'); return (await idb('items')).filter((i) => i.spotId === sb.id).length`), 3);
  await shot('09-inventory');

  // Labels: the item label carries its path.
  await js(`await go('#/labels?ids=${ornId}'); await settle(800);`);
  check('item label shows the path (5160: name and path)', await js(`await click('.lay', 'Avery 5160'); await settle(300); return [...($('.sheet .lab .lab-t')?.children ?? [])].map((e) => norm(e.textContent))`), ['Glass ornaments', 'Attic › Shelf B']);
  check('item label shows the path (5163: name, path and category)', await js(`await click('.lay', 'Avery 5163'); await settle(300); return [...($('.sheet .lab .lab-t')?.children ?? [])].map((e) => norm(e.textContent))`), ['Glass ornaments', 'Attic › Shelf B', 'Decorations']);

  // Backup screen wording.
  await js(`await go('#/more/backup');`);
  check('Backup: ZIP restore only, mentions 0.1.1 backups; no CSV restore', await js(`return [/0\\.1\\.1/.test($('.bk').textContent), byText('.btn', 'Choose a backup file (ZIP)') !== undefined, /\\(ZIP or CSV\\)/.test($('.bk').textContent)]`), [true, true, false]);

  // ── Manifest and iPhone metadata ──
  const manifest = await js(`const l = $('link[rel=manifest]'); return l ? await (await fetch(l.href)).json() : null`);
  check('manifest name, short name and portrait', [manifest?.name, manifest?.short_name, manifest?.orientation], ['Hiebert Home Inventory', 'Home Inventory', 'portrait']);

  // ── iPhone size: reported for H3, which reworks every screen for phones ──
  await size(390, 844, true);
  const shelfB = await js(`return (await idb('spots')).find((s) => s.name === 'Shelf B').id`);
  for (const [h, name] of [['#/inventory', 'inventory'], [`#/item/${ornId}`, 'item'], [`#/spot/${shelfB}`, 'spot'], ['#/more/places', 'places'], [`#/item/${ornId}/edit`, 'editor']]) {
    await js(`await go('${h}');`);
    await shot(`10-iphone-${name}`);
    info(`iPhone 390 px, ${name}: page wider than the screen`, await js(`return document.documentElement.scrollWidth > innerWidth`));
  }
} catch (e) {
  results.push('FAIL  script error: ' + e.message);
  await shot('zz-error').catch(() => {});
} finally {
  console.log(results.join('\n'));
  process.exitCode = results.some((r) => /^(FAIL|ERROR)/.test(r)) ? 1 : 0;
  console.log(problems.length ? 'Console problems:\n' + problems.join('\n') : 'No console errors or warnings');
  ws.close();
  proc.kill();
  preview.kill();
}
