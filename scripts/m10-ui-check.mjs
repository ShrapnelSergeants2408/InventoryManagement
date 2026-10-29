// M10 real-browser check: first launch (PIN, recovery code, then starter catalog / restore a
// backup / start empty, F22 and Q2), the persistent-storage request, the storage-error screen's
// "Set up again", and offline use (SPEC §2): manifest, service worker precache, and the app —
// including a first launch — working with the web server stopped. Drives the production build
// in headless Chrome over CDP.
// Usage: npm run build && node scripts/m10-ui-check.mjs <chrome.exe> <screenshot dir>
import { tempDir, track } from './tmp-cleanup.mjs';
import { spawn } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PIN_H, TEST_PIN } from './pin-helpers.mjs';

const [chrome, outDir] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let preview = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', '4330', '--strictPort'], { stdio: 'ignore' });
const port = 9346;
const proc = spawn(chrome, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${port}`, `--user-data-dir=${tempDir('cdp-')}`, 'about:blank'], { stdio: 'ignore' });
track(proc);

// Files offered to the restore picker: the starter catalog (a full-backup ZIP) and a file that isn't a backup.
const files = tempDir('m10-files-');
const backupZip = join(files, 'frc2408-backup-full-2026-10-18.zip');
copyFileSync(resolve('seed/frc2408-starter-catalog-2026-10-21.zip'), backupZip);
const notBackup = join(files, 'shopping-notes.txt');
// The update check changes dist/sw.js while the app runs; the original is put back at the end.
const swPath = resolve('dist/sw.js');
const swOriginal = readFileSync(swPath);
writeFileSync(notBackup, 'buy more zip ties\n');

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
let offline = false;
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); return; }
  if (d.method === 'Page.fileChooserOpened') choosers.push(d.params);
  if (d.method === 'Runtime.exceptionThrown') problems.push('exception: ' + JSON.stringify(d.params.exceptionDetails).slice(0, 400));
  // With the server stopped, Chrome logs failed background requests (e.g. the service worker's
  // update check); those are expected and not app errors.
  if (d.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(d.params.type)) {
    const text = JSON.stringify(d.params.args);
    // The check itself deletes the database under the open app (wipe); Dexie warns about that.
    const wiping = /Another connection wants to delete database/.test(text);
    if (!wiping && !(offline && /Failed to fetch|ERR_CONNECTION_REFUSED|sw\.js/.test(text))) problems.push(`console.${d.params.type}: ` + text.slice(0, 400));
  }
};
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const js = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: `(async () => { ${H} ${expr} })()`, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 600));
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
const size = (width, height) => send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
const results = [];
const check = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${JSON.stringify(actual)}${ok ? '' : ` (expected ${JSON.stringify(expected)})`}`);
};
/** Clicks a button that opens the file picker and hands it `path`. */
const chooseFile = async (buttonSel, text, path) => {
  const before = choosers.length;
  // A file chooser only opens from a user gesture.
  await send('Runtime.evaluate', { expression: `(() => { ${H} byText(${JSON.stringify(buttonSel)}, ${JSON.stringify(text)}).click(); })()`, userGesture: true });
  for (let i = 0; i < 50 && choosers.length === before; i++) await sleep(100);
  if (choosers.length === before) throw new Error('no file chooser opened for ' + text);
  await send('DOM.setFileInputFiles', { files: [path], backendNodeId: choosers.at(-1).backendNodeId });
  await sleep(400);
};

const H = `
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const settle = (ms = 350) => new Promise((r) => setTimeout(r, ms));
  const norm = (s) => s.replace(/\\s+/g, ' ').trim();
  const byText = (sel, t) => $$(sel).find((b) => norm(b.textContent).includes(t));
  const click = async (sel, t) => { const b = byText(sel, t); if (!b) throw new Error('nothing like ' + sel + ' with text ' + t); b.click(); await settle(); return b; };
  const type = async (sel, v) => { const el = $(sel); el.focus(); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); await settle(150); };
${PIN_H}
  const idbCount = (store) => new Promise((res, rej) => {
    const r = indexedDB.open('frc2408-inventory');
    r.onsuccess = () => { const db = r.result; const q = db.transaction(store).objectStore(store).count(); q.onsuccess = () => { res(q.result); db.close(); }; q.onerror = () => rej(q.error); };
    r.onerror = () => rej(r.error);
  });
  const idbGet = (store, key) => new Promise((res, rej) => {
    const r = indexedDB.open('frc2408-inventory');
    r.onsuccess = () => { const db = r.result; const q = db.transaction(store).objectStore(store).get(key); q.onsuccess = () => { res(q.result); db.close(); }; q.onerror = () => rej(q.error); };
    r.onerror = () => rej(r.error);
  });
  const now = () => norm($('.setup-steps li.now')?.textContent ?? '');
  const pinSteps = async () => { await enterPin('${TEST_PIN}'); await enterPin('${TEST_PIN}'); $('.recovery input[type=checkbox]').click(); await settle(150); byText('.recovery button', 'Next').click(); for (let i = 0; i < 50 && !$('.sopts'); i++) await settle(100); };
  const sdone = () => $$('.sdone li').map((l) => norm(l.textContent));
`;

// A fresh device first asks what it is (F22, M16b): answer Set up the shop tablet, then the PIN pad.
const toPin = async () => {
  await waitFor(`document.querySelector('.setup .pinpad, .role-opt')`, 60000);
  await js(`await pickShopTablet();`);
  await waitFor(`document.querySelector('.setup .pinpad')`, 30000);
};

// Deletes the app's database (the "storage cleared" case) and reloads into first launch.
const wipe = async () => {
  await js(`await new Promise((res, rej) => { const r = indexedDB.deleteDatabase('frc2408-inventory'); r.onsuccess = res; r.onerror = () => rej(r.error); r.onblocked = res; });`);
  await send('Page.reload');
  await toPin();
};

try {
  await send('Runtime.enable');
  await send('Page.enable');
  await send('DOM.enable');
  await send('Page.setInterceptFileChooserDialog', { enabled: true });
  await size(1280, 800);
  await send('Page.navigate', { url: 'http://localhost:4330/' });
  await toPin();

  // ── First launch: steps 1–2, then step 3 (9h) ──
  check('a new tablet: three setup steps, starting at the PIN', await js(`return [$$('.setup-steps li').map((l) => norm(l.textContent)), now()]`), [['1Set mentor PIN', '2Save recovery code', '3Load starter catalog'], '1Set mentor PIN']);
  await js(`await pinSteps();`);
  check('after the recovery code: step 3, the PIN already saved', await js(`return [now(), !!(await idbGet('settings', 'pinHash')), (await idbGet('settings', 'setupDoneAt')) ?? null]`), ['3Load starter catalog', true, null]);
  check('three starting points; the starter catalog chosen and recommended', await js(`return $$('.sopt').map((o) => [norm(o.querySelector('.sopt-h').textContent), o.getAttribute('aria-checked')])`), [['Load the starter catalogRecommended', 'true'], ['Restore a backup file', 'false'], ['Start empty', 'false']]);
  check('the persistent-storage note and the button', await js(`return [!!byText('.setup-start p', 'persistent storage'), norm($('.setup-acts .btn').textContent)]`), [true, 'Load starter catalog']);
  await shot('01-setup-start');
  check('nothing loaded yet: no items, no app navigation', await js(`return [await idbCount('items'), !$('.nav')]`), [0, true]);
  await send('Page.reload');
  await waitFor(`document.querySelector('.setup')`, 30000);
  check('closed at step 3: reopens at step 3 without asking for a PIN again', await js(`await settle(300); return [now(), !$('.pinpad'), !!$('.sopts')]`), ['3Load starter catalog', true, true]);

  // Restore path: a file that isn't a backup is refused; a backup shows what it holds.
  await js(`await click('.sopt', 'Restore a backup file');`);
  check('restore chosen: the button opens a file picker', await js(`return norm($('.setup-acts .btn').textContent)`), 'Choose a backup file…');
  await chooseFile('.setup-acts .btn', 'Choose a backup file', notBackup);
  await waitFor(`document.querySelector('.setup-h') && !document.querySelector('[aria-busy=true]')`);
  check('not a backup: refused, nothing changed', await js(`return [norm($('.setup-h').textContent), !!$('.sfile[role=alert]'), await idbCount('items')]`), ['Can’t use this file', true, 0]);
  await chooseFile('.setup-acts .btn', 'Choose another file', backupZip);
  await waitFor(`document.querySelector('.setup-h')?.textContent === 'Restore this backup?'`);
  check('a backup ZIP: what it holds, before anything is replaced', await js(`return [norm($('.sfile span').textContent), await idbCount('items')]`), ['129 items · 128 photos · 9 suppliers · 0 locations', 0]);
  await shot('02-setup-restore-check');
  await js(`await click('.setup-acts .btn', 'Back'); await click('.sopt', 'Load the starter catalog');`);

  // ── Load the starter catalog (9i → 9j) ──
  await js(`window.__seen = []; const mo = new MutationObserver(() => { const t = $$('.sprog').map((p) => norm(p.textContent)).join(' | '); if (t && window.__seen.at(-1) !== t) window.__seen.push(t); }); mo.observe(document.body, { subtree: true, childList: true, characterData: true }); byText('.setup-acts .btn', 'Load starter catalog').click();`);
  await waitFor(`document.querySelector('.sdone')`, 60000);
  const seen = await js(`return window.__seen`);
  check('loading screen showed item and photo progress, ending at 129 items and 128 of 128 photos', [seen.length > 1, seen.at(-1)], [true, 'Items129 of 129 | Photos128 of 128']);
  check('photo progress counted up along the way', seen.some((t) => /Photos(\d+) of 128/.test(t) && +/Photos(\d+) of 128/.exec(t)[1] > 0 && +/Photos(\d+) of 128/.exec(t)[1] < 128), true);
  check('ready (9j): title, what was set up, the order total to count down', await js(`return [norm($('.setup-h').textContent), sdone().slice(0, 2), norm($('.snext').textContent).includes('$8,413.66'), $$('.setup-acts .btn').map((b) => norm(b.textContent))]`), ['Ready — 129 items loaded', ['Mentor PIN set · recovery code saved', '129 starter items, 128 photos, 9 suppliers'], true, ['Start count-in', 'Go to inventory']]);
  check('persistent storage was asked for and the answer shown', await js(`const l = sdone()[2]; const p = await navigator.storage.persisted(); return p ? l === 'Persistent storage granted — works offline' : l.startsWith('Persistent storage not granted yet')`), true);
  check('stored: 129 items, 128 photos, 9 suppliers, 11 categories; setup done', await js(`return [await idbCount('items'), await idbCount('photos'), await idbCount('suppliers'), await idbCount('categories'), typeof (await idbGet('settings', 'setupDoneAt'))?.value]`), [129, 128, 9, 11, 'number']);
  check('the setup steps all show done', await js(`return $$('.setup-steps li').map((l) => l.className)`), ['done', 'done', 'done']);
  await shot('03-setup-ready');
  await js(`await click('.setup-acts .btn', 'Start count-in'); await settle(600);`);
  check('Start count-in opens Count-in with the app navigation (F22 → F24)', await js(`return [location.hash, norm($('.h1').textContent), !!$('.nav'), norm($('.cprog-t span').textContent)]`), ['#/count', 'Count-in', true, '0 of 129 counted']);
  await send('Page.reload');
  await waitFor(`document.querySelector('.modes')`, 30000);
  check('after a reload: straight into the app, no setup and no second load', await js(`return [!$('.setup'), await idbCount('items')]`), [true, 129]);

  // ── Installable PWA: manifest, icons, service worker, precache (SPEC §2) ──
  const man = await js(`const l = $('link[rel=manifest]'); const m = await (await fetch(l.href)).json(); const icons = await Promise.all(m.icons.map(async (i) => { const b = await (await fetch(new URL(i.src, l.href))).blob(); const bm = await createImageBitmap(b); return [i.sizes, bm.width + 'x' + bm.height]; })); return { name: m.name, short: m.short_name, display: m.display, start: m.start_url, scope: m.scope, icons }`);
  check('manifest: name, standalone, start and scope relative to the site, icons 192 and 512 that load', man, { name: 'FRC 2408 Inventory Management', short: '2408 Inventory', display: 'standalone', start: './', scope: './', icons: [['192x192', '192x192'], ['512x512', '512x512']] });
  await waitFor(`navigator.serviceWorker.controller || (navigator.serviceWorker.getRegistration && false)`, 1).catch(() => {});
  const sw = await js(`const reg = await navigator.serviceWorker.ready; const keys = await caches.keys(); const urls = (await Promise.all(keys.map(async (k) => (await (await caches.open(k)).keys()).map((r) => new URL(r.url).pathname)))).flat(); return { active: !!reg.active, scope: new URL(reg.scope).pathname, urls }`);
  const has = (re) => sw.urls.some((u) => re.test(u));
  check('service worker active for the site', [sw.active, sw.scope], [true, '/']);
  check('precached: page, JS, CSS, both font families (woff2), icons, logo, starter catalog ZIP, scanner .wasm, manifest', [has(/\/index\.html$/), has(/\/assets\/index-.*\.js$/), has(/\/assets\/index-.*\.css$/), has(/atkinson-hyperlegible.*\.woff2$/), has(/barlow-condensed.*\.woff2$/), has(/icon-192\.png$/), has(/icon-512\.png$/), has(/team-logo-512.*\.png$/), has(/frc2408-starter-catalog.*\.zip$/), has(/zxing_reader.*\.wasm$/), has(/manifest\.webmanifest$/)], Array(11).fill(true));
  check('no .woff fallbacks precached (Chrome uses woff2)', sw.urls.filter((u) => /\.woff$/.test(u)), []);

  // ── A new version (deploy): banner with Reload / Later, never an automatic reload ──
  writeFileSync(swPath, Buffer.concat([swOriginal, Buffer.from('\n// a newer deploy\n')]));
  await js(`window.__stillHere = true; const reg = await navigator.serviceWorker.ready; await reg.update();`);
  await waitFor(`[...document.querySelectorAll('.banner')].some((b) => b.textContent.includes('A new version of the app is ready'))`, 30000);
  const bannerBtns = `[...document.querySelectorAll('.banner')].find((b) => b.textContent.includes('A new version'))?.querySelectorAll('.btn') ?? []`;
  check('a new version waits: the banner offers Reload and Later; the page did not reload by itself', await js(`return [[...${bannerBtns}].map((b) => norm(b.textContent)), window.__stillHere === true]`), [['Reload', 'Later'], true]);
  await shot('05-update-banner');
  await js(`[...${bannerBtns}].find((b) => b.textContent.includes('Later')).click(); await settle(300);`);
  check('Later hides it', await js(`return [...document.querySelectorAll('.banner')].some((b) => b.textContent.includes('A new version'))`), false);
  await send('Page.reload');
  await waitFor(`[...document.querySelectorAll('.banner')].some((b) => b.textContent.includes('A new version of the app is ready'))`, 30000);
  check('after a reload the waiting version is offered again', true, true);
  await js(`[...${bannerBtns}].find((b) => b.textContent.includes('Reload')).click();`);
  await sleep(2500);
  await waitFor(`document.querySelector('.main')`, 30000);
  check('Reload: the new version takes over and the banner is gone', await js(`const reg = await navigator.serviceWorker.getRegistration(); return [!reg.waiting, !!navigator.serviceWorker.controller, [...document.querySelectorAll('.banner')].some((b) => b.textContent.includes('A new version'))]`), [true, true, false]);

  // ── Offline: stop the web server ──
  await send('Page.reload');
  await waitFor(`navigator.serviceWorker.controller && document.querySelector('.modes')`, 30000);
  preview.kill();
  offline = true;
  await sleep(500);
  check('the web server is really down', await fetch('http://localhost:4330/').then(() => 'up', () => 'down'), 'down');
  await send('Page.navigate', { url: 'http://localhost:4330/#/inventory' });
  await waitFor(`document.querySelectorAll('.cathdr').length >= 11`, 30000);
  check('offline: the app opens with the inventory', await js(`return [document.querySelectorAll('.cathdr').length, norm($('.top .small').textContent)]`), [11, '129 items · 124 short · 0 low spares']);
  check('offline: both fonts load from the cache', await js(`await document.fonts.ready; await Promise.all([document.fonts.load('16px "Atkinson Hyperlegible"'), document.fonts.load('700 16px "Barlow Condensed"')]); return [document.fonts.check('16px "Atkinson Hyperlegible"'), document.fonts.check('700 16px "Barlow Condensed"'), [...document.fonts].filter((f) => f.status === 'loaded').length >= 2]`), [true, true, true]);
  await js(`$('.cathdr button, .cathdr')?.click(); await settle(800);`);
  check('offline: the logo shows', await js(`const i = $('.nav-logo img'); return i.complete && i.naturalWidth > 0`), true);

  // Offline first launch: storage cleared, no server — the starter catalog still loads.
  await wipe();
  await js(`await pinSteps();`);
  await js(`await click('.sopt', 'Start empty'); await click('.setup-acts .btn', 'Start empty');`);
  await waitFor(`document.querySelector('.sdone')`, 60000);
  check('offline, start empty (9h): categories and suppliers only', await js(`return [norm($('.setup-h').textContent), sdone()[1], await idbCount('items'), await idbCount('categories'), await idbCount('suppliers'), $$('.setup-acts .btn').map((b) => norm(b.textContent))]`), ['Ready — an empty inventory', '11 categories and 9 suppliers; no items yet', 0, 11, 9, ['Add the first item', 'Go to inventory']]);
  await js(`await click('.setup-acts .btn', 'Go to inventory'); await settle(600);`);
  check('empty inventory: the app opens with no items', await js(`return [!$('.setup'), document.querySelectorAll('.row').length]`), [true, 0]);

  await wipe();
  await js(`await pinSteps();`);
  await js(`await click('.sopt', 'Restore a backup file');`);
  await chooseFile('.setup-acts .btn', 'Choose a backup file', backupZip);
  await waitFor(`document.querySelector('.setup-h')?.textContent === 'Restore this backup?'`);
  await js(`await click('.setup-acts .btn', 'Restore this backup');`);
  await waitFor(`document.querySelector('.sdone')`, 60000);
  check('offline, restore a backup (Q2): the backup arrives whole', await js(`return [norm($('.setup-h').textContent), sdone()[1], await idbCount('items'), await idbCount('photos'), $$('.setup-acts .btn').map((b) => norm(b.textContent))]`), ['Ready — 129 items restored', '129 items and 128 photos from frc2408-backup-full-2026-10-18.zip', 129, 128, ['Open count-in', 'Go to inventory']]);
  await js(`await click('.setup-acts .btn', 'Go to inventory'); await settle(600);`);

  await wipe();
  await js(`await pinSteps(); await click('.setup-acts .btn', 'Load starter catalog');`);
  await waitFor(`document.querySelector('.sdone')`, 60000);
  check('offline, load the starter catalog from the cache', await js(`return [norm($('.setup-h').textContent), await idbCount('items'), await idbCount('photos')]`), ['Ready — 129 items loaded', 129, 128]);
  await js(`await click('.setup-acts .btn', 'Go to inventory'); await settle(600);`);

  // ── Storage error → Set up again (Q2) ──
  const blocker = await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `IDBFactory.prototype.open = function () { throw new DOMException('The user denied permission to access the database.', 'SecurityError'); };`,
  });
  await send('Page.reload');
  await waitFor(`document.querySelector('[role=alert] .h2')`, 30000);
  // Stage 5 finding 1 (M15): the first failure offers only Try again.
  check('storage error, first failure: only Try again', await js(`return $$('[role=alert] .btn').map((b) => norm(b.textContent))`), ['Try again']);
  await js(`await click('[role=alert] .btn', 'Try again'); await settle(800);`);
  await waitFor(`document.querySelector('[role=alert] .h2')`, 30000);
  check('storage error, Try again failed too: Try again and Set up again', await js(`return $$('[role=alert] .btn').map((b) => norm(b.textContent))`), ['Try again', 'Set up again…']);
  await shot('04-storage-error');
  await js(`await click('[role=alert] .btn', 'Set up again');`);
  check('Set up again asks first, naming what is deleted, and that the PIN can’t protect it', await js(`const d = $('[role=alertdialog][aria-label="Set up again"]'); const p = $$('[role=alertdialog] .dlg-p').map((e) => norm(e.textContent)); return [!!d, p[0].includes('the inventory, photos, order lists, PIN and settings'), p[1].startsWith('The mentor PIN can’t protect this step'), $$('[role=alertdialog] .btn').map((b) => norm(b.textContent))]`), [true, true, true, ['Cancel', 'Delete and set up again']]);
  check('Delete stays off until DELETE is typed', await js(`const b = () => byText('[role=alertdialog] .btn', 'Delete and set up again'); const off = b().disabled; await type('#rsword', 'delet'); const still = b().disabled; await type('#rsword', 'delete'); return [off, still, b().disabled]`), [true, true, false]);
  await js(`await click('[role=alertdialog] .btn', 'Cancel');`);
  check('Cancel keeps everything', await js(`return !$('[role=alertdialog]')`), true);
  await js(`await click('[role=alert] .btn', 'Set up again'); await type('#rsword', 'DELETE'); byText('[role=alertdialog] .btn', 'Delete and set up again').click();`);
  await sleep(1500);
  await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: blocker.result.identifier });
  await send('Page.reload');
  await toPin();
  check('after Set up again: first-launch setup, the old data gone', await js(`return [now(), await idbCount('items'), (await idbGet('settings', 'pinHash')) ?? null]`), ['1Set mentor PIN', 0, null]);

  // ── Layout ──
  await js(`await pinSteps();`);
  check('touch targets ≥ 48 px on step 3', await js(`return [...document.querySelectorAll('.setup button, .setup a, .setup input:not(.vh)')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.height < 47.5 || r.width < 47.5); }).map((e) => norm(e.textContent) + ' ' + Math.round(e.getBoundingClientRect().height))`), []);
  await size(800, 1280);
  await js(`await settle(300);`);
  await shot('05-setup-start-portrait');
  check('portrait step 3: no horizontal overflow', await js(`return document.documentElement.scrollWidth <= innerWidth`), true);
  await js(`await click('.setup-acts .btn', 'Load starter catalog');`);
  await waitFor(`document.querySelector('.sdone')`, 60000);
  await shot('06-setup-ready-portrait');
  check('portrait ready: no horizontal overflow, buttons visible', await js(`const b = $('.setup-acts .btn').getBoundingClientRect(); return [document.documentElement.scrollWidth <= innerWidth, b.bottom <= innerHeight]`), [true, true]);
  await size(1280, 800);
} catch (e) {
  results.push('FAIL  script error: ' + e.message);
  await shot('zz-error').catch(() => {});
} finally {
  console.log(results.join('\n'));
  process.exitCode = results.some((r) => /^(FAIL|ERROR)/.test(r)) ? 1 : 0;
  console.log(problems.length ? 'Console problems:\n' + problems.join('\n') : 'No console errors or warnings');
  writeFileSync(swPath, swOriginal);
  ws.close();
  proc.kill();
  preview.kill();
}
