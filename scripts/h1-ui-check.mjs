// H1 real-browser check (SPEC v2.0, milestone H1: strip and rebrand). First launch with Start
// fresh, add an item with a new location, the household QR label found by a typed scan, the
// trimmed More and Settings screens, delete without a PIN, the manifest name, and an iPhone-size
// layout report. Real IndexedDB, headless Chrome.
// Usage: npm run build && node scripts/h1-ui-check.mjs <chrome.exe> <screenshot dir>
import { tempDir, track } from './tmp-cleanup.mjs';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [chrome, outDir] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const preview = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', '4371', '--strictPort'], { stdio: 'ignore' });
const port = 9401;
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
const results = [];
const check = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${JSON.stringify(actual)}${ok ? '' : ` (expected ${JSON.stringify(expected)})`}`);
};
/** Recorded for H3 (the phone layout milestone), not a pass/fail of H1. */
const info = (name, value) => results.push(`INFO  ${name}: ${JSON.stringify(value)}`);

const H = `
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const settle = (ms = 350) => new Promise((r) => setTimeout(r, ms));
  const norm = (s) => s.replace(/\\s+/g, ' ').trim();
  const byText = (sel, t) => $$(sel).find((b) => norm(b.textContent).includes(t));
  const click = async (sel, t) => { const b = byText(sel, t); if (!b) throw new Error('nothing like ' + sel + ' with text ' + t); b.click(); await settle(); return b; };
  const type = async (el, v) => { if (typeof el === 'string') el = $(el); if (!el) throw new Error('no field'); el.focus(); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); await settle(120); };
  const pick = async (sel, v) => { const el = $(sel); el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); await settle(150); };
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
`;

try {
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await size(1280, 800);
  await send('Page.navigate', { url: 'http://localhost:4371/' });
  await waitFor(`document.querySelector('.setup')`, 60000);

  // ── First launch: no PIN, no helper choice, no starter catalog ──
  check('first launch: title and the two choices', await js(`return [norm($('.setup-title').textContent), $$('.sopt .sopt-h').map((e) => norm(e.textContent))]`), ['Hiebert Home Inventory', ['Start fresh', 'Restore a backup file']]);
  check('first launch: no PIN pad, no helper, no starter catalog', await js(`return /PIN|helper|starter|mentor/i.test(document.body.textContent)`), false);
  await shot('01-setup');
  await js(`await click('.setup-acts .btn.pri', 'Start fresh'); await settle(800);`);
  await waitFor(`document.querySelector('.done-ic')`);
  await shot('02-ready');
  check('database: home-inventory with the default categories, no items', await js(`const c = await idb('categories'); const i = await idb('items'); return [c.length, c.sort((a, b) => a.order - b.order)[0].name, i.length]`), [13, 'Decorations', 0]);

  // ── Add an item with a new location ──
  await js(`await click('.setup-acts .btn.pri', 'Add the first item'); await settle(800);`);
  await waitFor(`document.querySelector('#nm')`);
  check('editor: no vendors, prices, units or PIN', await js(`return [/vendor|supplier|price|PIN|unit/i.test($('.fbody').textContent), !!$('.lockpill')]`), [false, false]);
  await js(`await type('#nm', 'Snowman lights'); await pick('#cat', 'Lights'); await pick('#loc', '__new'); await type('input[aria-label="New location name"]', 'Attic shelf B'); await click('.inline-add .btn', 'Add'); await settle(400);`);
  await js(`const q = $('input[aria-label="Quantity"]'); await type(q, '3');`);
  await shot('03-editor');
  await js(`await click('.top .btn.pri', 'Add item'); await settle(900);`);
  await waitFor(`location.hash.startsWith('#/item/')`);
  const items = await js(`return await idb('items')`);
  check('the item is stored with an it- id and the household fields only', [items.length, /^it-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/.test(items[0]?.id ?? ''), Object.keys(items[0] ?? {}).sort()], [1, true, ['barcode', 'category', 'hasPhoto', 'id', 'location', 'name', 'notes', 'quantity', 'subcategory', 'updatedAt']]);
  check('stored values', [items[0].name, items[0].category, items[0].location, items[0].quantity], ['Snowman lights', 'Lights', 'Attic shelf B', 3]);
  const itemId = items[0].id;
  await shot('04-detail');
  check('detail: quantity stepper, no order or vendor sections', await js(`return [$('.dright input[aria-label="Quantity"]')?.value, /order|vendor|supplier|price|desired|spares/i.test($('.dbody').textContent)]`), ['3', false]);

  // ── Navigation ──
  check('tabs: Inventory, Scan, Labels, More; no lock button anywhere', await js(`return [$$('.nav a span').map((s) => s.textContent), !!$('.lockpill')]`), [['Inventory', 'Scan', 'Labels', 'More'], false]);
  await js(`await go('#/inventory'); await settle(400);`);
  check('inventory: summary and quick filters, no stock chips', await js(`return [norm($('.top-title .small').textContent), $$('.frow .fchip').map((b) => norm(b.textContent))]`), ['1 item', ['Category: All', 'Location: All']]);
  await shot('05-inventory');

  // ── Scan a household label by typing it (headless Chrome has no camera: the blocked-camera form) ──
  await js(`await go('#/scan'); await settle(800);`);
  await waitFor(`document.querySelector('#mc')`);
  await js(`await type('#mc', 'hhi:${itemId}'); await click('.inline-add .btn', 'Find'); await settle(500);`);
  check('typed hhi: label finds the item', await js(`return [!!dlg('Item found'), norm($('.found-t h2')?.textContent ?? '')]`), [true, 'Snowman lights']);
  await shot('06-scan-found');
  await js(`await click('.sp-foot .btn.pri', 'Done'); await settle(400); await type('#mc', '2408:st-0063'); await click('.inline-add .btn', 'Find'); await settle(500);`);
  check('an old FRC label is not a household label', await js(`return !!dlg('Item found')`), false);

  // ── More and Settings ──
  await js(`await go('#/more');`);
  check('More: managed lists, backup, settings, about', await js(`return $$('.mrow .mt').map((e) => norm(e.textContent))`), ['Categories', 'Locations', 'Backup & restore', 'Settings', 'Hiebert Home Inventory', 'App version 0.1.1']);
  await shot('07-more');
  await js(`await go('#/more/settings'); await type('#set-reminder', '0'); await click('.top .btn.pri', 'Save'); await settle(500);`);
  check('Settings: the reminder turns off with 0', await js(`const s = await idb('settings'); return s.find((r) => r.key === 'reminderDays')?.value`), 0);
  await js(`await go('#/more/backup');`);
  check('Backup: no helpers, price import or PIN', await js(`return /helper|price|PIN|mentor/i.test($('.bk').textContent)`), false);
  await shot('08-backup');

  // ── Delete without a PIN ──
  await js(`await go('#/item/${itemId}'); await click('.dacts .btn.danger', 'Delete item'); await settle(400);`);
  check('delete asks to confirm, naming the item and quantity', await js(`return [!!dlg('Delete item'), norm($('.del-name')?.textContent ?? ''), norm($('.dlg-big')?.textContent ?? '')]`), [true, 'Snowman lights', 'Quantity: 3']);
  await js(`await click('[role=alertdialog] .btn.danger', 'Delete item'); await settle(700);`);
  check('deleted: back on the inventory, nothing stored', await js(`return [location.hash, (await idb('items')).length]`), ['#/inventory', 0]);

  // ── Manifest and iPhone metadata ──
  const manifest = await js(`const l = $('link[rel=manifest]'); return l ? await (await fetch(l.href)).json() : null`);
  check('manifest name, short name and portrait', [manifest?.name, manifest?.short_name, manifest?.orientation], ['Hiebert Home Inventory', 'Home Inventory', 'portrait']);
  check('iPhone home-screen title and icon', await js(`return [$('meta[name=apple-mobile-web-app-title]')?.content, (await fetch($('link[rel=apple-touch-icon]').href)).ok]`), ['Home Inventory', true]);

  // ── iPhone size: reported for H3, which reworks every screen for phones ──
  await size(390, 844, true);
  for (const [h, name] of [['#/inventory', 'inventory'], ['#/more', 'more'], ['#/scan', 'scan']]) {
    await js(`await go('${h}');`);
    await shot(`09-iphone-${name}`);
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
