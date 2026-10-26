// M16a real-browser upgrade check (stage6-plan §3 step 3, second upgrade): a tablet on today's
// main (v2, M15b) is reloaded on the M16a build (v3) at the same address. Another tab holding the
// database first blocks the upgrade ("Close other tabs", never "Set up again"); once it lets go,
// the upgrade runs: dated counts become local midnight with that day's offset, counted_by is
// added, and every other row, photo and setting is unchanged. Then main is served again, as a
// rolled-back deploy would be: main has the schema guard, so it shows "out of date" and writes
// nothing. Usage: node scripts/m16a-upgrade-check.mjs <chrome.exe> <screenshot dir> <old dist> <new dist>
//   <old dist>: `vite build` of main before M16a (a git worktree at 197ff26); <new dist>: this branch's dist.
import { tempDir, track } from './tmp-cleanup.mjs';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { PIN_H } from './pin-helpers.mjs';

const [chrome, outDir, oldDist, newDist] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// One address, either build: the browser sees the same origin, as the tablet does after a deploy.
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
await new Promise((r) => server.listen(4339, r));
const ORIGIN = 'http://localhost:4339';

const port = 9355;
const proc = spawn(chrome, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${port}`, `--user-data-dir=${tempDir('cdp-')}`, 'about:blank'], { stdio: 'ignore' });
track(proc);
let target;
for (let i = 0; i < 50 && !target; i++) {
  await sleep(200);
  try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page'); } catch {}
}

const problems = [];
let blockedWarnings = 0;
/** A CDP connection to one tab. */
async function connect(t, tag) {
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const pending = new Map();
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); return; }
    if (d.method === 'Runtime.exceptionThrown') problems.push(`${tag} exception: ` + JSON.stringify(d.params.exceptionDetails).slice(0, 400));
    // Dexie's own note while the other tab holds the database: the case this check sets up.
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
  // The service worker would answer with the build it cached; this check swaps builds itself.
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
// Everything in the database, photos as byte arrays, read without Dexie.
const DUMP = `
  const db = await new Promise((res, rej) => { const r = indexedDB.open('frc2408-inventory'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const out = { version: db.version, stores: [...db.objectStoreNames].sort() };
  for (const s of out.stores) {
    const rows = await new Promise((res) => { const q = db.transaction(s).objectStore(s).getAll(); q.onsuccess = () => res(q.result); });
    out[s] = await Promise.all(rows.map(async (r) => {
      const o = { ...r };
      for (const k of ['full', 'thumb']) if (r[k] instanceof Blob) o[k] = { type: r[k].type, bytes: [...new Uint8Array(await r[k].arrayBuffer())].reduce((h, b) => (h * 31 + b) >>> 0, 7) };
      return o;
    }));
  }
  db.close();
  return out;
`;
const orderTotal = `const r = await new Promise((res) => { location.hash = '#/order'; setTimeout(res, 900); }); return norm($$('.sum .tile')[0].textContent)`;
const progress = `await new Promise((res) => { location.hash = '#/count'; setTimeout(res, 900); }); return norm($('.cprog-t span').textContent)`;
// Local midnight with that day's offset, worked out here without the app's code.
const MIDNIGHT = `const midnight = (day) => { const [y, m, d] = day.split('-').map(Number); const t = new Date(y, m - 1, d); const o = -t.getTimezoneOffset(); const p = (n) => String(n).padStart(2, '0'); return day + 'T00:00:00' + (o < 0 ? '-' : '+') + p(Math.floor(Math.abs(o) / 60)) + ':' + p(Math.abs(o) % 60); };`;

try {
  await A.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await A.send('Emulation.setFocusEmulationEnabled', { enabled: true });

  // ── Today's build (main, v2): set up; counts dated on both sides of the DST changes, a named list ──
  await A.send('Page.navigate', { url: ORIGIN + '/' });
  await waitFor(A, `document.querySelector('.setup')`, 60000);
  await A.js(`${PAGE} await doSetup();`);
  await waitFor(A, `document.querySelectorAll('.cathdr').length >= 11`, 60000);
  await A.js(`
    const db = await new Promise((res) => { const r = indexedDB.open('frc2408-inventory'); r.onsuccess = () => res(r.result); });
    await new Promise((res) => { const t = db.transaction(['items', 'settings', 'locations', 'orderLists'], 'readwrite'); const s = t.objectStore('items');
      const edit = (id, patch) => { const q = s.get(id); q.onsuccess = () => s.put({ ...q.result, ...patch }); };
      edit('st-0001', { onHand: 7, lastCounted: '2026-03-08', notes: 'line one\\nline, "two"' });
      edit('st-0002', { onHand: 1, lastCounted: '2026-11-01' });
      edit('st-0003', { onHand: 2, lastCounted: '2026-10-24' });
      t.objectStore('settings').put({ key: 'countSince', value: '2026-10-01' });
      t.objectStore('locations').put({ key: 'bin f3', name: 'Bin F3', notes: '', order: 0 });
      t.objectStore('orderLists').put({ id: 'ol-TEST01', key: 'before upgrade', name: 'Before upgrade', notes: 'n, "q"', created: 1, updated: 2, lines: [{ itemId: 'st-0004', quantity: 3 }], itemIds: ['st-0004'] });
      t.oncomplete = res; });
    db.close();`);
  await A.send('Page.reload');
  await waitFor(A, `document.querySelectorAll('.cathdr').length >= 11`, 30000);
  const before = await A.js(DUMP);
  check('today\'s build: IndexedDB version 20 (Dexie v2), no helper stores, schemaVersion 2', [before.version, before.stores.includes('helpers'), before.settings.find((s) => s.key === 'schemaVersion')?.value], [20, false, 2]);
  const totalBefore = await A.js(`${PAGE} ${orderTotal}`);
  const progressBefore = await A.js(`${PAGE} ${progress}`);
  check('today\'s build: order total and count-round progress to compare after the upgrade', [/^Grand total ?\$[\d,]+\.\d\d$/.test(totalBefore), progressBefore], [true, '2 of 129 counted since Oct 1, 2026']); // Mar 8 is before the round started

  // ── Another tab holds the database: the upgrade has to wait ──
  const tB = (await (await fetch(`http://127.0.0.1:${port}/json/new?${ORIGIN}/manifest.webmanifest`, { method: 'PUT' })).json());
  const B = await connect(tB, 'B');
  await sleep(800);
  await B.js(`window.__db = await new Promise((res) => { const r = indexedDB.open('frc2408-inventory'); r.onsuccess = () => res(r.result); }); return window.__db.version`);

  // ── The deploy: the M16a build at the same address; tab A reloads ──
  root = newDist;
  await A.js(`location.hash = '#/inventory'`);
  await A.send('Page.reload', { ignoreCache: true });
  await waitFor(A, `document.querySelector('.state .h2')`, 30000);
  await sleep(500);
  check('blocked: "Close other tabs of this app" with Try again, never "Set up again"', await A.js(`${PAGE} return [norm($('.state .h2').textContent), $$('.state .btn').map((b) => norm(b.textContent)), !!byText('.btn', 'Set up again')]`), ['Close other tabs of this app', ['Try again'], false]);
  await shot('01-blocked');
  check('while blocked, the database is still v2', await B.js(`return window.__db.version`), 20);
  check('Dexie reported the blocked upgrade', blockedWarnings > 0, true);

  await B.js(`window.__db.close(); return true`);
  await waitFor(A, `document.querySelectorAll('.cathdr').length >= 11`, 30000);
  await sleep(600);
  const after = await A.js(DUMP);
  const NEW = ['helpers', 'importUndo', 'pendingItems', 'pendingPhotos'];
  check('upgraded: version 30, the four new stores added and empty, schemaVersion 3', [after.version, after.stores, NEW.map((s) => after[s].length), after.settings.find((s) => s.key === 'schemaVersion')?.value], [30, [...before.stores, ...NEW].sort(), [0, 0, 0, 0], 3]);
  const expectedItems = await A.js(`${MIDNIGHT} return ${JSON.stringify(before.items)}.map((i) => ({ ...i, lastCounted: i.lastCounted === '' ? '' : midnight(i.lastCounted), countedBy: '' }))`);
  check(`items: only last_counted (to local midnight) and counted_by changed, every other field byte-equal (${before.items.length})`, after.items, expectedItems);
  check('the three counted items, as converted', ['st-0001', 'st-0002', 'st-0003'].map((id) => after.items.find((i) => i.id === id).lastCounted), expectedItems.filter((i) => ['st-0001', 'st-0002', 'st-0003'].includes(i.id)).map((i) => i.lastCounted));
  check('…which in Chicago are CST on Mar 8 and CDT on Nov 1 (both before 2 a.m.)', ['st-0001', 'st-0002'].map((id) => after.items.find((i) => i.id === id).lastCounted), ['2026-03-08T00:00:00-06:00', '2026-11-01T00:00:00-05:00']);
  for (const s of ['suppliers', 'locations', 'categories', 'orderLists']) check(`every ${s} row byte-equal after the upgrade (${before[s].length})`, after[s], before[s]);
  const photoDiffs = before.photos.flatMap((b, i) => {
    const a = after.photos[i];
    const same = a && a.itemId === b.itemId && JSON.stringify(a.full) === JSON.stringify(b.full) && (b.thumb === null || JSON.stringify(a.thumb) === JSON.stringify(b.thumb));
    return same ? [] : [b.itemId];
  });
  check(`every photo byte-equal after the upgrade (${before.photos.length})`, [after.photos.length, photoDiffs], [before.photos.length, []]);
  check('settings unchanged apart from schemaVersion (PIN, recovery code, countSince, setup time)', after.settings.filter((s) => s.key !== 'schemaVersion'), before.settings.filter((s) => s.key !== 'schemaVersion'));
  check('order total after the upgrade', await A.js(`${PAGE} ${orderTotal}`), totalBefore);
  check('count-round progress after the upgrade', await A.js(`${PAGE} ${progress}`), progressBefore);
  check('the count-in start screen has Helper devices', await A.js(`${PAGE} return !!byText('.chelp .btn', 'Helper devices')`), true);
  await A.js(`${PAGE} location.hash = '#/item/st-0001'; await settle(900);`);
  check('detail card: the converted count shows its date', await A.js(`${PAGE} return norm(byText('.chip.mut', 'Counted').textContent)`), 'Counted Mar 8, 2026');
  await shot('02-upgraded');

  // A helper saved on v3, so the rollback below has v3 data to leave alone.
  await A.js(`${PAGE} location.hash = '#/count/helpers'; await settle(900); byText('.top .btn', 'Add helper').click(); await settle(); const i = $('#hname'); i.focus(); i.value = 'Rollback helper'; i.dispatchEvent(new Event('input', { bubbles: true })); await settle(); $$('.hgroup')[0].click(); await settle(); byText('.dlg .btn', 'Add helper').click(); await settle(800);`);
  const v3 = await A.js(DUMP);
  check('a helper saved on v3', v3.helpers.map((h) => h.name), ['Rollback helper']);

  // ── A rolled-back deploy: main (v2, which has the guard) over the v3 database ──
  root = oldDist;
  await A.js(`location.hash = '#/inventory'`);
  await A.send('Page.reload', { ignoreCache: true });
  await waitFor(A, `document.querySelector('.state .h2')`, 30000);
  await sleep(800);
  check('rollback: main shows "out of date" with Reload, not the inventory or setup', await A.js(`${PAGE} return [norm($('.state .h2').textContent), !!byText('.state .btn', 'Reload'), $$('.cathdr').length, !!$('.setup')]`), ['This app is out of date — reload to update', true, 0, false]);
  await shot('03-rollback-guard');
  const rb = await A.js(DUMP);
  // v3 may still have been making list thumbnails (§8) between its snapshot and the reload, so
  // a thumbnail that was missing then is left out of this comparison; the guard screen shows no
  // list and makes none. A second snapshot after a wait checks the guard writes nothing over time.
  const noNewThumbs = (d) => ({ ...d, photos: d.photos.map((p, i) => (v3.photos[i]?.thumb === null ? { ...p, thumb: null } : p)) });
  check('…and it wrote nothing: every store as it was on v3', noNewThumbs(rb), v3);
  await sleep(3000);
  check('…still nothing three seconds later', await A.js(DUMP), rb);

  // ── Forward again: M16a opens it as usual ──
  root = newDist;
  await A.js(`location.hash = '#/count/helpers'`);
  await A.send('Page.reload', { ignoreCache: true });
  await waitFor(A, `document.querySelector('.hcard')`, 30000);
  check('forward again: the helper and the converted counts are there', [await A.js(`${PAGE} return $$('.hcard .h2').map((h) => norm(h.textContent))`), (await A.js(DUMP)).items.find((i) => i.id === 'st-0001').lastCounted], [['Rollback helper'], '2026-03-08T00:00:00-06:00']);
  B.ws.close();
} catch (e) {
  results.push('ERROR ' + e.message);
  await shot('error').catch(() => {});
} finally {
  console.log(results.join('\n'));
  console.log(problems.length ? 'Console problems:\n' + problems.join('\n') : 'No console errors or warnings');
  A.ws.close();
  proc.kill();
  server.close();
  process.exit(0);
}
