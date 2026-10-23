// M15 real-browser upgrade check (stage6-plan §3 step 3): a tablet set up on the build it runs
// today (v1) is reloaded on the M15 build (v2) at the same address. Another tab holding the
// database first blocks the upgrade ("Close other tabs", never "Set up again"); once it lets go,
// the upgrade runs and every item, photo and setting is still there. Then the old build is served
// again, as a rolled-back deploy would be.
// Usage: node scripts/m15-upgrade-check.mjs <chrome.exe> <screenshot dir> <old dist> <new dist>
//   <old dist>: `vite build` of main before M15 (e.g. a git worktree at 92d80ae); <new dist>: this branch's dist.
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
await new Promise((r) => server.listen(4336, r));
const ORIGIN = 'http://localhost:4336';

const port = 9352;
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

try {
  await A.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await A.send('Emulation.setFocusEmulationEnabled', { enabled: true });

  // ── Today's build (v1): set up, and make the tablet's data less tidy than the seed ──
  await A.send('Page.navigate', { url: ORIGIN + '/' });
  await waitFor(A, `document.querySelector('.setup')`, 60000);
  await A.js(`${PAGE} await doSetup();`);
  await waitFor(A, `document.querySelectorAll('.cathdr').length >= 11`, 60000);
  await A.js(`
    const db = await new Promise((res) => { const r = indexedDB.open('frc2408-inventory'); r.onsuccess = () => res(r.result); });
    await new Promise((res) => { const t = db.transaction(['items', 'settings', 'locations'], 'readwrite'); const s = t.objectStore('items');
      const q = s.get('st-0001'); q.onsuccess = () => s.put({ ...q.result, onHand: 7, lastCounted: '2026-03-08', notes: 'line one\\nline, "two"' });
      t.objectStore('settings').put({ key: 'countSince', value: '2026-10-01' });
      t.objectStore('locations').put({ key: 'bin f3', name: 'Bin F3', notes: '', order: 0 });
      t.oncomplete = res; });
    db.close();`);
  const before = await A.js(DUMP);
  check('today\'s build: IndexedDB version 10 (Dexie v1), no orderLists, no schemaVersion', [before.version, before.stores.includes('orderLists'), before.settings.some((s) => s.key === 'schemaVersion')], [10, false, false]);
  const totalBefore = await A.js(`${PAGE} ${orderTotal}`);
  // One item now has 7 on hand, so the total is a little under the seed's $8,413.66.
  check('today\'s build: an order total to compare after the upgrade', /^Grand total ?\$[\d,]+\.\d\d$/.test(totalBefore), true);

  // ── Another tab holds the database (no versionchange handler): the upgrade has to wait ──
  const tB = (await (await fetch(`http://127.0.0.1:${port}/json/new?${ORIGIN}/manifest.webmanifest`, { method: 'PUT' })).json());
  const B = await connect(tB, 'B');
  await sleep(800);
  await B.js(`window.__db = await new Promise((res) => { const r = indexedDB.open('frc2408-inventory'); r.onsuccess = () => res(r.result); }); return window.__db.version`);

  // ── The deploy: the M15 build at the same address; tab A reloads ──
  root = newDist;
  await A.js(`location.hash = '#/inventory'`);
  await A.send('Page.reload', { ignoreCache: true });
  await waitFor(A, `document.querySelector('.state .h2')`, 30000);
  await sleep(500);
  check('blocked: "Close other tabs of this app" with Try again, never "Set up again"', await A.js(`${PAGE} return [norm($('.state .h2').textContent), $$('.state .btn').map((b) => norm(b.textContent)), !!byText('.btn', 'Set up again')]`), ['Close other tabs of this app', ['Try again'], false]);
  await shot('01-blocked');
  const during = await B.js(`return window.__db.version`);
  check('while blocked, the database is still v1', during, 10);
  check('Dexie reported the blocked upgrade', blockedWarnings > 0, true);

  // The other tab closes: the waiting upgrade runs and the inventory opens by itself.
  await B.js(`window.__db.close(); return true`);
  await waitFor(A, `document.querySelectorAll('.cathdr').length >= 11`, 30000);
  await sleep(600);
  const after = await A.js(DUMP);
  check('upgraded: version 20, orderLists store added and empty, schemaVersion 2', [after.version, after.stores, after.orderLists.length, after.settings.find((s) => s.key === 'schemaVersion')?.value], [20, [...before.stores, 'orderLists'].sort(), 0, 2]);
  for (const s of ['items', 'suppliers', 'locations', 'categories']) check(`every ${s} row byte-equal after the upgrade (${before[s].length})`, after[s], before[s]);
  // Photos: the list makes small thumbnails as rows come into view (§8), so a thumbnail may have
  // been added since. Every full photo, and every thumbnail that already existed, must be equal.
  const photoDiffs = before.photos.flatMap((b, i) => {
    const a = after.photos[i];
    const same = a && a.itemId === b.itemId && JSON.stringify(a.full) === JSON.stringify(b.full) && (b.thumb === null || JSON.stringify(a.thumb) === JSON.stringify(b.thumb));
    return same ? [] : [b.itemId];
  });
  const thumbsAdded = before.photos.filter((b, i) => b.thumb === null && after.photos[i]?.thumb).length;
  check(`every photo byte-equal after the upgrade (${before.photos.length}; ${thumbsAdded} thumbnails made meanwhile)`, [after.photos.length, photoDiffs], [before.photos.length, []]);
  check('settings unchanged apart from schemaVersion (PIN, recovery code, countSince, setup time)', after.settings.filter((s) => s.key !== 'schemaVersion'), before.settings);
  check('the hand-edited item is as it was', after.items.find((i) => i.id === 'st-0001') && [after.items.find((i) => i.id === 'st-0001').onHand, after.items.find((i) => i.id === 'st-0001').lastCounted], [7, '2026-03-08']);
  check('order total after the upgrade', await A.js(`${PAGE} ${orderTotal}`), totalBefore);
  check('the new Order screen: Automatic tab and New list', await A.js(`${PAGE} return $$('.ltabs .ltab:not(.sel)').map((t) => norm(t.textContent))`), ['Automatic', 'New list']);
  await shot('02-upgraded');

  // Make a named list on v2, so the rollback below has v2 data to ignore.
  await A.js(`${PAGE} byText('.ltabs .ltab', 'New list').click(); await settle(); const i = $('#lname'); i.focus(); i.value = 'Rollback test'; i.dispatchEvent(new Event('input', { bubbles: true })); await settle(); byText('.dlg .btn', 'Make list').click(); await settle(800);`);
  check('a named list saved on v2', (await A.js(DUMP)).orderLists.map((l) => l.name), ['Rollback test']);

  // ── A rolled-back deploy: today's build again over the v2 database ──
  root = oldDist;
  await A.js(`location.hash = '#/inventory'`);
  await A.send('Page.reload', { ignoreCache: true });
  await sleep(3000);
  const rolled = await A.js(`${PAGE} return [$$('.cathdr').length >= 11, !!$('.setup'), norm($('.state .h2')?.textContent ?? '')]`);
  check('rollback to today\'s build (no guard in it): the v2 database still opens, no setup screen', rolled, [true, false, '']);
  const rb = await A.js(DUMP);
  check('…and the v2 data is untouched (version 20, the named list, items)', [rb.version, rb.orderLists.map((l) => l.name), rb.items.length], [20, ['Rollback test'], before.items.length]);

  // ── Forward again: M15 opens it as usual ──
  root = newDist;
  await A.js(`location.hash = '#/inventory'`);
  await A.send('Page.reload', { ignoreCache: true });
  await waitFor(A, `document.querySelectorAll('.cathdr').length >= 11`, 30000);
  await A.js(`${PAGE} location.hash = '#/order'; await settle(900);`);
  check('forward again: the list is there', await A.js(`${PAGE} return $$('.ltabs .ltab:not(.sel)').map((t) => norm([...t.childNodes].map((c) => c.textContent).join(' ')))`), ['Automatic', 'Rollback test 0', 'New list']);
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
