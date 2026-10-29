// M23 real-browser upgrade check for a helper device (M19 independent review, finding 8): a
// phone that joined as a helper on the build before M19 (inventory schema v3, helper schema
// 100, no order stores) and counted, then gets today's build at the same address. Its counts,
// kit and progress must survive, and it must still send a counts file the shop tablet (also
// upgraded) imports. The service worker is bypassed so each load gets the build being served.
// Usage: node scripts/m23-helper-upgrade-check.mjs <chrome.exe> <screenshot dir> <old dist> <new dist> [<middle dist>]
//   <old dist>: `vite build` of main before M19 (30cff18); <new dist>: this branch's dist.
//   <middle dist> (optional): a build from M19–M22 (main before M23) opened in between, as on
//   a phone that has been used since M19: Dexie patched its schema in place (native 1001).
import { tempDir, track } from './tmp-cleanup.mjs';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import JSZip from 'jszip';
import Papa from 'papaparse';
import { PIN_H } from './pin-helpers.mjs';

const [chrome, outDir, oldDist, newDist, midDist] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const files = tempDir('m23-files-');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let root = oldDist;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.zip': 'application/zip', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
const handler = (req, res) => {
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
};
// Two origins, so the helper has its own storage like a separate phone.
const shopServer = createServer(handler);
const helperServer = createServer(handler);
await new Promise((r) => shopServer.listen(4371, 'localhost', r));
await new Promise((r) => helperServer.listen(4372, '127.0.0.1', r));
const SHOP = 'http://localhost:4371';
const HELP = 'http://127.0.0.1:4372';

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
const choosers = [];
let blockedWarnings = 0;
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); return; }
  if (d.method === 'Page.fileChooserOpened') choosers.push(d.params);
  if (d.method === 'Runtime.exceptionThrown') problems.push('exception: ' + JSON.stringify(d.params.exceptionDetails).slice(0, 400));
  // Switching builds in the same tab: the old page's connection can still be closing when the new
  // build asks for the upgrade. Dexie waits and says so; the checks below confirm it completed.
  if (d.method === 'Runtime.consoleAPICalled' && /blocked by other connection/.test(JSON.stringify(d.params.args))) { blockedWarnings++; return; }
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
  while (Date.now() < end) { try { if (await js(`return !!(${cond})`)) return; } catch {} await sleep(150); }
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

const PAGE = `
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const norm = (s) => s.replace(/\\s+/g, ' ').trim();
  const byText = (sel, t) => $$(sel).find((b) => norm(b.textContent).includes(t));
  const settle = (ms = 350) => new Promise((r) => setTimeout(r, ms));
  const click = async (sel, t) => { const b = byText(sel, t); if (!b) throw new Error('nothing like ' + sel + ' with text ' + t); b.click(); await settle(); return b; };
  const type = async (sel, v) => { const el = $(sel); if (!el) throw new Error('no field ' + sel); el.focus(); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); await settle(250); };
  const go = async (h) => { location.hash = h; await settle(700); };
  const keys = async (digits) => { for (const d of digits) { $$('.pad button').find((b) => b.getAttribute('aria-label') === d).click(); await settle(60); } };
  const idbAll = (name, store) => new Promise((res, rej) => {
    const r = indexedDB.open(name);
    r.onsuccess = () => { const db = r.result; const q = db.transaction(store).objectStore(store).getAll(); q.onsuccess = () => { res(q.result); db.close(); }; q.onerror = () => rej(q.error); };
    r.onerror = () => rej(r.error);
  });
  // Opens the database without asking for a version, so it never upgrades anything itself.
  const idbShape = (name) => new Promise((res, rej) => {
    const r = indexedDB.open(name);
    r.onsuccess = () => { const db = r.result; const out = { version: db.version, stores: [...db.objectStoreNames].sort() }; db.close(); res(out); };
    r.onerror = () => rej(r.error);
  });
  const catchShare = () => {
    window.__shared = null;
    navigator.canShare = () => true;
    navigator.share = async (d) => {
      const f = d.files[0];
      const b = new Uint8Array(await f.arrayBuffer());
      let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
      window.__shared = { name: f.name, b64: btoa(s) };
    };
  };
  ${PIN_H}
`;
const P = (expr) => js(`${PAGE} ${expr}`);
const chooseFile = async (sel, text, paths) => {
  const before = choosers.length;
  await send('Runtime.evaluate', { expression: `(() => { ${PAGE} byText(${JSON.stringify(sel)}, ${JSON.stringify(text)}).click(); })()`, userGesture: true });
  for (let i = 0; i < 50 && choosers.length === before; i++) await sleep(100);
  if (choosers.length === before) throw new Error('no file chooser opened for ' + text);
  await send('DOM.setFileInputFiles', { files: paths, backendNodeId: choosers.at(-1).backendNodeId });
  await sleep(800);
};
const shared = async () => {
  const s = await P(`for (let i = 0; i < 100 && !window.__shared; i++) await settle(100); return window.__shared`);
  if (!s) throw new Error('nothing reached the share sheet');
  return { ...s, bytes: Buffer.from(s.b64, 'base64') };
};
const csvOf = async (zip, name) => Papa.parse((await zip.file(name).async('string')).replace(/^﻿/, ''), { header: true, skipEmptyLines: true }).data;
const open = async (url, cond) => {
  await send('Page.navigate', { url });
  await waitFor(cond, 60000);
  await sleep(500);
};

try {
  await send('Runtime.enable');
  await send('Page.enable');
  await send('DOM.enable');
  await send('Network.enable');
  await send('Network.setBypassServiceWorker', { bypass: true });
  await send('Page.setInterceptFileChooserDialog', { enabled: true });
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });

  // ── Old build: the shop tablet sends a kit; the helper joins and counts two items ──
  await size(1280, 800);
  await open(SHOP + '/', `document.querySelector('.setup')`);
  await P(`await doSetup();`);
  await waitFor(`document.querySelectorAll('.cathdr').length >= 11`, 60000);
  await P(`await go('#/count/helpers'); await click('.top .btn', 'Add helper'); await type('#hname', 'Old phone'); $$('.hgroup').find((x) => norm(x.querySelector('strong').textContent) === 'Electrical').click(); await settle(150); await click('.dlg .btn', 'Add helper'); await settle(500);`);
  await P(`catchShare(); $$('.hcard').find((c) => norm(c.querySelector('.h2').textContent) === 'Old phone').querySelector('.btn.pri').click(); await settle(600); await click('.dlg .btn', 'Send count kit');`);
  const kit = await shared();
  const kitPath = join(files, kit.name);
  writeFileSync(kitPath, kit.bytes);

  await size(360, 780, true);
  await open(HELP + '/', `document.querySelector('.role-opt')`);
  await P(`await click('.role-opt', 'Join as a helper');`);
  await chooseFile('.kitpick .btn', 'Choose the count kit', [kitPath]);
  await waitFor(`document.querySelector('.sfile strong')`);
  await P(`await click('.setup-acts .btn', 'Start counting'); await settle(1200);`);
  await waitFor(`document.querySelector('.hbar')`);
  await P(`await click('.cg-row .btn', 'Start');`);
  const first = await P(`return norm($('.wname').textContent)`);
  await P(`await keys('3'); await click('.wsave', 'Save & next'); await settle(400);`);
  const second = await P(`return norm($('.wname').textContent)`);
  await P(`await keys('5'); await click('.wsave', 'Save & next'); await settle(400); await click('.top .btn', 'Pause'); await settle(400);`);
  const before = await P(`return { shape: await idbShape('frc2408-helper'), changes: (await idbAll('frc2408-helper', 'changes')).length, items: (await idbAll('frc2408-helper', 'items')).length, progress: norm($('.cprog-t span').textContent) }`);
  check('old build: the helper database is schema 100 with no order stores, holding the two counts', [before.shape.version, before.shape.stores.includes('orders'), before.changes, before.progress.startsWith('2 of ')], [1000, false, 2, true]);
  await shot('01-helper-old');

  if (midDist) {
    // ── A build from M19–M22 in between: it patches the schema in place (and Dexie warns) ──
    root = midDist;
    await open(HELP + '/', `document.querySelector('.hbar')`);
    const mid = await P(`return { shape: await idbShape('frc2408-helper'), changes: (await idbAll('frc2408-helper', 'changes')).length }`);
    check('middle build (M19–M22): opened at native 1001 with the order stores patched in, counts kept', [mid.shape.version, mid.shape.stores.includes('orders'), mid.changes], [1001, true, 2]);
    const warned = problems.filter((p) => /Schema was extended/.test(p)).length;
    check('…and Dexie warned about it, as before M23', warned > 0, true);
    for (let i = problems.length - 1; i >= 0; i--) if (/Schema was extended/.test(problems[i])) problems.splice(i, 1);
  }

  // ── Today's build at the same address ──
  root = newDist;
  await open(HELP + '/', `document.querySelector('.hbar')`);
  const after = await P(`return { shape: await idbShape('frc2408-helper'), changes: (await idbAll('frc2408-helper', 'changes')).length, items: (await idbAll('frc2408-helper', 'items')).length, bar: norm($('.hbar').textContent), progress: norm($('.cprog-t span').textContent) }`);
  check('new build: still the helper (its bar names it), not the first-launch question', [after.bar.startsWith('HELPER') && after.bar.includes('Old phone'), !(await P(`return !!$('.role-opt')`))], [true, true]);
  check('new build: the helper database upgraded to 104 (100 + inventory v4) with the order stores added, nothing lost', [after.shape.version, after.shape.stores.includes('orders'), after.shape.stores.includes('receipts'), after.changes, after.items === before.items, after.progress], [1040, true, true, 2, true, before.progress]);
  await P(`await go('#/send');`);
  check('Send: the two changes are still waiting', await P(`return norm($('.hlast .small').textContent)`), '2 changes not sent yet');
  await shot('02-helper-new-send');
  await P(`catchShare(); await click('.hsend-go .btn', 'Send my counts');`);
  const counts = await shared();
  const countsPath = join(files, counts.name);
  writeFileSync(countsPath, counts.bytes);
  const rows = await csvOf(await JSZip.loadAsync(counts.bytes), 'counts.csv');
  const kitCsv = await csvOf(await JSZip.loadAsync(kit.bytes), 'inventory.csv');
  const idOf = Object.fromEntries(kitCsv.map((r) => [r.name, r.id]));
  check('the counts file from the upgraded helper holds both counts', rows.map((r) => [r.item_id, r.on_hand]).sort(), [[idOf[first], '3'], [idOf[second], '5']].sort());

  // ── The shop tablet, upgraded too, imports it ──
  await size(1280, 800);
  await open(SHOP + '/', `document.querySelectorAll('.cathdr').length >= 11`);
  check('shop tablet on the new build: inventory database at v4 with the order stores', await P(`const s = await idbShape('frc2408-inventory'); return [s.version, s.stores.includes('orders')]`), [40, true]);
  await P(`await go('#/count'); await click('.chelp-acts .btn', 'Import counts');`);
  await chooseFile('.imp-start .btn', 'Choose counts files', [countsPath]);
  await waitFor(`[...document.querySelectorAll('.imp-side .btn')].some((b) => b.textContent.includes('Apply'))`);
  await P(`await click('.imp-side .btn', 'Apply'); await settle(1200);`);
  const onHand = await P(`const all = await idbAll('frc2408-inventory', 'items'); return [${JSON.stringify(idOf[first])}, ${JSON.stringify(idOf[second])}].map((id) => [all.find((i) => i.id === id).onHand, all.find((i) => i.id === id).countedBy])`);
  check('imported on the shop tablet: both counts applied, counted by the helper', onHand, [[3, 'Old phone'], [5, 'Old phone']]);
  await shot('03-shop-imported');
} catch (e) {
  results.push('FAIL  script error: ' + e.message);
  await shot('zz-error').catch(() => {});
} finally {
  if (blockedWarnings) results.push(`INFO  an upgrade waited for the previous page's connection to close (${blockedWarnings}x), then went ahead`);
  console.log(results.join('\n'));
  process.exitCode = results.some((r) => /^(FAIL|ERROR)/.test(r)) ? 1 : 0;
  console.log(problems.length ? 'Console problems:\n' + problems.join('\n') : 'No console errors or warnings');
  ws.close();
  proc.kill();
  shopServer.close();
  helperServer.close();
}
