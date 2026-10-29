// M19 real-browser upgrade check (v3 → v4, §21.6): a tablet on today's main (v3, M18) holding a
// copy of the real tablet backup is reloaded on the M19 build at the same address. Another tab
// holding the database first blocks the upgrade; once it lets go, the upgrade adds the empty
// orders and receipts stores, and every other row, photo and setting is unchanged. Then main is
// served again, as a rolled-back deploy would be: its schema guard shows "out of date" and it
// writes nothing over the order saved on v4. Forward again, the order is still there.
// Usage: node scripts/m19-upgrade-check.mjs <chrome.exe> <screenshot dir> <old dist> <new dist> <tablet backup.zip>
//   <old dist>: `vite build` of main before M19; <new dist>: this branch's dist.
import { tempDir, track } from './tmp-cleanup.mjs';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { PIN_H } from './pin-helpers.mjs';

const [chrome, outDir, oldDist, newDist, backupZip] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const backupB64 = readFileSync(backupZip).toString('base64');

let root = oldDist;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.zip': 'application/zip', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
const server = createServer((req, res) => {
  let path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^[\\/]+/, '');
  if (path === '' || path === '.') path = 'index.html';
  const file = join(root, path);
  if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) {
    res.writeHead(404);
    res.end();
    return;
  }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(4353, r));
const ORIGIN = 'http://localhost:4353';

const port = 9383;
const proc = spawn(chrome, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${port}`, `--user-data-dir=${tempDir('cdp-')}`, 'about:blank'], { stdio: 'ignore' });
track(proc);
let target;
for (let i = 0; i < 50 && !target; i++) {
  await sleep(200);
  try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page'); } catch {}
}

const problems = [];
let blockedWarnings = 0;
async function connect(t, tag) {
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const pending = new Map();
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); return; }
    if (d.method === 'Runtime.exceptionThrown') problems.push(`${tag} exception: ` + JSON.stringify(d.params.exceptionDetails).slice(0, 400));
    if (d.method === 'Runtime.consoleAPICalled' && /blocked by other connection/.test(JSON.stringify(d.params.args))) { blockedWarnings++; return; }
    if (d.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(d.params.type)) problems.push(`${tag} console.${d.params.type}: ` + JSON.stringify(d.params.args).slice(0, 400));
  };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const js = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 500));
    return r.result?.result?.value;
  };
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Network.enable');
  await send('Network.setBypassServiceWorker', { bypass: true });
  return { ws, send, js };
}

const A = await connect(target, 'A');
const results = [];
const check = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${JSON.stringify(actual)}${ok ? '' : ` (expected ${JSON.stringify(expected)})`}`);
};
const waitFor = async (tab, cond, ms = 30000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await tab.js(`return !!(${cond})`)) return; await sleep(150); }
  throw new Error('timeout waiting for ' + cond);
};
const shot = async (name) => {
  const r = await A.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(outDir, name + '.png'), Buffer.from(r.result.data, 'base64'));
};

const PAGE = `
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const norm = (s) => s.replace(/\\s+/g, ' ').trim();
  const byText = (sel, t) => $$(sel).find((b) => norm(b.textContent).includes(t));
  const settle = (ms = 350) => new Promise((r) => setTimeout(r, ms));
  ${PIN_H}
`;
const DUMP = `
  const db = await new Promise((res, rej) => { const r = indexedDB.open('frc2408-inventory'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const out = { version: db.version, stores: [...db.objectStoreNames].sort() };
  for (const s of out.stores) {
    const rows = await new Promise((res) => { const q = db.transaction(s).objectStore(s).getAll(); q.onsuccess = () => res(q.result); });
    out[s] = await Promise.all(rows.map(async (r) => {
      const o = { ...r };
      for (const k of ['full', 'thumb', 'blob']) if (r[k] instanceof Blob) o[k] = { type: r[k].type, bytes: [...new Uint8Array(await r[k].arrayBuffer())].reduce((h, b) => (h * 31 + b) >>> 0, 7) };
      return o;
    }));
  }
  db.close();
  return out;
`;
const orderTotal = `await new Promise((res) => { location.hash = '#/order'; setTimeout(res, 1200); }); return norm($$('.sum .tile')[0].textContent)`;

try {
  await A.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await A.send('Emulation.setFocusEmulationEnabled', { enabled: true });

  // ── Today's main (v3): set up, restore the real tablet backup, add a list, a helper's pending item ──
  await A.send('Page.navigate', { url: ORIGIN + '/' });
  await waitFor(A, `document.querySelector('.setup')`, 60000);
  await A.js(`${PAGE} await doSetup();`);
  await waitFor(A, `document.querySelectorAll('.cathdr').length > 0`, 60000);
  await A.js(`${PAGE}
    location.hash = '#/more/backup'; await settle(900);
    const input = document.querySelectorAll('input[type=file]')[0];
    const dt = new DataTransfer();
    dt.items.add(new File([Uint8Array.from(atob(${JSON.stringify(backupB64)}), (c) => c.charCodeAt(0))], 'tablet-backup.zip', { type: 'application/zip' }));
    input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true }));
    for (let i = 0; i < 200 && !$('[aria-label="Replace all inventory with this backup?"]'); i++) await settle(100);
    $('.tick input').click(); await settle(150);
    byText('.dlg button', 'Replace everything').click();
    await answerGate(true);
    for (let i = 0; i < 300 && $('[aria-label="Replace all inventory with this backup?"]'); i++) await settle(100);
    await settle(800);`);
  await A.js(`
    const db = await new Promise((res) => { const r = indexedDB.open('frc2408-inventory'); r.onsuccess = () => res(r.result); });
    await new Promise((res) => { const t = db.transaction(['orderLists', 'settings'], 'readwrite');
      t.objectStore('orderLists').put({ id: 'ol-TEST01', key: 'before upgrade', name: 'Before upgrade', notes: 'n, "q"', created: 1, updated: 2, lines: [{ itemId: 'st-0004', quantity: 3 }], itemIds: ['st-0004'] });
      t.objectStore('settings').put({ key: 'countSince', value: '2026-10-01' });
      t.oncomplete = res; });
    db.close();
    location.hash = '#/inventory';`);
  await A.send('Page.reload');
  await waitFor(A, `document.querySelectorAll('.cathdr').length > 0`, 30000);
  await sleep(1500); // thumbnails for the visible rows
  const before = await A.js(DUMP);
  check('today\'s main: IndexedDB version 30 (Dexie v3), no order stores, schemaVersion 3, the tablet backup restored', [before.version, before.stores.includes('orders'), before.settings.find((s) => s.key === 'schemaVersion')?.value, before.items.length > 100, before.photos.length > 100], [30, false, 3, true, true]);
  const totalBefore = await A.js(`${PAGE} ${orderTotal}`);

  // ── Another tab holds the database ──
  const tB = await (await fetch(`http://127.0.0.1:${port}/json/new?${ORIGIN}/manifest.webmanifest`, { method: 'PUT' })).json();
  const B = await connect(tB, 'B');
  await sleep(800);
  await B.js(`window.__db = await new Promise((res) => { const r = indexedDB.open('frc2408-inventory'); r.onsuccess = () => res(r.result); }); return window.__db.version`);

  // ── The deploy: M19 at the same address ──
  root = newDist;
  await A.js(`location.hash = '#/inventory'`);
  await A.send('Page.reload', { ignoreCache: true });
  await waitFor(A, `document.querySelector('.state .h2')`, 30000);
  await sleep(500);
  check('blocked: "Close other tabs of this app" with Try again, never "Set up again"', await A.js(`${PAGE} return [norm($('.state .h2').textContent), $$('.state .btn').map((b) => norm(b.textContent)), !!byText('.btn', 'Set up again')]`), ['Close other tabs of this app', ['Try again'], false]);
  check('while blocked, the database is still v3', await B.js(`return window.__db.version`), 30);
  check('Dexie reported the blocked upgrade', blockedWarnings > 0, true);
  await B.js(`window.__db.close(); return true`);
  await waitFor(A, `document.querySelectorAll('.cathdr').length > 0`, 30000);
  await sleep(1500);
  const after = await A.js(DUMP);
  check('upgraded: version 40, orders and receipts added and empty, schemaVersion 4', [after.version, after.stores, after.orders.length, after.receipts.length, after.settings.find((s) => s.key === 'schemaVersion')?.value], [40, [...before.stores, 'orders', 'receipts'].sort(), 0, 0, 4]);
  for (const s of ['items', 'suppliers', 'locations', 'categories', 'orderLists', 'helpers', 'pendingItems', 'pendingPhotos', 'importUndo']) check(`every ${s} row byte-equal after the upgrade (${before[s].length})`, JSON.stringify(after[s]) === JSON.stringify(before[s]), true);
  const photoDiffs = before.photos.flatMap((b, i) => {
    const a = after.photos[i];
    const same = a && a.itemId === b.itemId && JSON.stringify(a.full) === JSON.stringify(b.full) && (b.thumb === null || JSON.stringify(a.thumb) === JSON.stringify(b.thumb));
    return same ? [] : [b.itemId];
  });
  check(`every photo byte-equal after the upgrade (${before.photos.length})`, [after.photos.length, photoDiffs], [before.photos.length, []]);
  check('settings unchanged apart from schemaVersion', after.settings.filter((s) => s.key !== 'schemaVersion'), before.settings.filter((s) => s.key !== 'schemaVersion'));
  check('order total unchanged (nothing on order yet)', await A.js(`${PAGE} ${orderTotal}`), totalBefore);
  check('the Order screen has Placed orders (History since M20) and Mark ordered…', await A.js(`${PAGE} return [!!(byText('.ltab', 'Placed orders') || byText('.ltab', 'History')), !!byText('.shdr button', 'Mark ordered')]`), [true, true]);
  await shot('01-upgraded');

  // An order saved on v4, so the rollback has v4 data to leave alone.
  await A.js(`
    const db = await new Promise((res) => { const r = indexedDB.open('frc2408-inventory'); r.onsuccess = () => res(r.result); });
    await new Promise((res) => { const t = db.transaction(['orders'], 'readwrite');
      t.objectStore('orders').put({ id: 'po-ROLLBK', supplier: 'REV', supplierKey: 'rev', placedOn: '2026-10-28', orderNo: '', payment: '', cancelled: false, taxCents: 0, shippingCents: 0, feesCents: 0, discount: { kind: '$', value: 0 }, notes: '', fromList: 'Automatic', receipts: [], created: 1, updated: 1, itemIds: ['st-0001'], lines: [{ itemId: 'st-0001', description: 'x', partNo: '', unit: 'each', category: 'Electrical', packs: 1, packSize: 1, packPriceCents: 100, received: 0 }] });
      t.oncomplete = res; });
    db.close();`);
  const v4 = await A.js(DUMP);

  // ── Rollback: main (v3, with the guard) over the v4 database ──
  root = oldDist;
  await A.js(`location.hash = '#/inventory'`);
  await A.send('Page.reload', { ignoreCache: true });
  await waitFor(A, `document.querySelector('.state .h2')`, 30000);
  await sleep(800);
  check('rollback: main shows "out of date" with Reload, not the inventory or setup', await A.js(`${PAGE} return [norm($('.state .h2').textContent), !!byText('.state .btn', 'Reload'), $$('.cathdr').length, !!$('.setup')]`), ['This app is out of date — reload to update', true, 0, false]);
  await shot('02-rollback-guard');
  const noNewThumbs = (d) => ({ ...d, photos: d.photos.map((p, i) => (v4.photos[i]?.thumb === null ? { ...p, thumb: null } : p)) });
  const rb = await A.js(DUMP);
  check('…and it wrote nothing: every store as it was on v4', noNewThumbs(rb), v4);
  await sleep(3000);
  check('…still nothing three seconds later', await A.js(DUMP), rb);

  // ── Forward again ──
  root = newDist;
  await A.js(`location.hash = '#/placed'`);
  await A.send('Page.reload', { ignoreCache: true });
  await waitFor(A, `document.querySelector('.po-row')`, 30000);
  check('forward again: the order saved on v4 is listed', await A.js(`${PAGE} return $$('.po-row').length`), 1);
  B.ws.close();
} catch (e) {
  results.push('ERROR ' + e.message);
  await shot('error').catch(() => {});
} finally {
  console.log(results.join('\n'));
  process.exitCode = results.some((r) => /^(FAIL|ERROR)/.test(r)) ? 1 : 0;
  console.log(problems.length ? 'Console problems:\n' + problems.join('\n') : 'No console errors or warnings');
  A.ws.close();
  proc.kill();
  server.close();
  process.exit(process.exitCode);
}
