// M17 real-browser check: location QR codes (F29) and the app version line (SPEC v0.9). Chrome's
// fake camera plays a bin's QR code, "Tools 7", as printed on the shop's bins; typed codes go
// through the same matching with the camera blocked. Drives the production build over CDP.
// Usage: npm run build && node scripts/m17-ui-check.mjs <chrome.exe> <screenshot dir>
import { tempDir, track } from './tmp-cleanup.mjs';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import qrcode from 'qrcode-generator';
import { PIN_H } from './pin-helpers.mjs';

const [chrome, outDir] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const preview = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', '4341', '--strictPort'], { stdio: 'ignore' });
const port = 9357;
// The fake camera: a bin's QR code holding the plain text "Tools 7", black on white.
const camVideo = join(tempDir('m17-cam-'), 'bin.y4m');
{
  const qr = qrcode(0, 'M');
  qr.addData('Tools 7', 'Byte');
  qr.make();
  const n = qr.getModuleCount();
  const W = 640, H = 480, cell = 10;
  const x0 = Math.floor((W - n * cell) / 2), y0 = Math.floor((H - n * cell) / 2);
  const Y = Buffer.alloc(W * H, 235);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) for (let dy = 0; dy < cell; dy++) Y.fill(16, (y0 + r * cell + dy) * W + x0 + c * cell, (y0 + r * cell + dy) * W + x0 + (c + 1) * cell);
  const UV = Buffer.alloc((W / 2) * (H / 2), 128);
  const frame = Buffer.concat([Buffer.from('FRAME\n'), Y, UV, UV]);
  writeFileSync(camVideo, Buffer.concat([Buffer.from(`YUV4MPEG2 W${W} H${H} F10:1 Ip A1:1 C420jpeg\n`), ...Array(10).fill(frame)]));
}
const proc = spawn(chrome, ['--headless=new', '--disable-gpu', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${camVideo}`, `--remote-debugging-port=${port}`, `--user-data-dir=${tempDir('cdp-')}`, 'about:blank'], { stdio: 'ignore' });
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

const ORIGIN = 'http://localhost:4341';
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
  const btns = (sel) => $$(sel).map((b) => norm(b.textContent));
  const until = async (cond, what) => { for (let i = 0; i < 100 && !cond(); i++) await settle(100); if (!cond()) throw new Error('timed out: ' + what); };
  const idbAll = (store) => new Promise((res, rej) => {
    const r = indexedDB.open('frc2408-inventory');
    r.onsuccess = () => { const db = r.result; const q = db.transaction(store).objectStore(store).getAll(); q.onsuccess = () => { res(q.result); db.close(); }; q.onerror = () => rej(q.error); };
    r.onerror = () => rej(r.error);
  });
  const locs = async () => (await idbAll('locations')).sort((a, b) => a.order - b.order).map((l) => l.name);
  const itemLoc = async (id) => (await idbAll('items')).find((i) => i.id === id).location;
  // Typed codes: block the camera so it can't answer first (as M8 does for the blocked state).
  const blockCamera = () => { window.__gum ??= navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices); navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError')); };
  const allowCamera = () => { if (window.__gum) navigator.mediaDevices.getUserMedia = window.__gum; };
  const typeLoc = async (v) => { await until(() => $('.dlg input[aria-label="Type the location"]'), 'the type box'); await type('.dlg input[aria-label="Type the location"]', v); await click('.dlg .inline-add .btn', 'Find'); };
  ${PIN_H}
`;
const P = (expr) => js(`${PAGE} ${expr}`);

try {
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await size(1280, 800);
  await send('Page.navigate', { url: ORIGIN + '/' });
  await waitFor(`document.querySelector('.setup')`, 60000);
  await P(`await doSetup();`);
  await waitFor(`document.querySelectorAll('.cathdr').length >= 11`, 60000);

  // ── App version (v0.9) ──
  await P(`await go('#/more');`);
  check('More › About: the app version and when it was built', await P(`const r = byText('.mrow', 'App version'); return [norm(r.querySelector('.mt').textContent), /^Built [A-Z][a-z]{2} \\d{1,2}, \\d{4}, \\d{1,2}:\\d\\d [AP]M$/.test(norm(r.querySelector('.small').textContent))]`), ['App version 0.8.0', true]);
  await shot('01-version');

  // ── Scan tab: an unknown bin code → Location not found → Add ──
  await P(`await go('#/scan'); await until(() => $('.spanel'), 'a scan result');`);
  check('the camera reads the bin code "Tools 7": Location not found, spaces kept; no Rename while there are no locations', await P(`return [$('.spanel').getAttribute('aria-label'), norm($('.spanel .h2').textContent), $('.spanel .code-big').textContent, btns('.sp-foot .btn')]`), ['Location not found', 'Location not found', 'Tools 7', ['Add “Tools 7” as a location', 'Attach to an existing item', 'Add a new item with this code', 'Scan again']]);
  await shot('02-scan-not-found');
  await P(`await click('.sp-foot .btn', 'Add “Tools 7”'); await settle(400);`);
  check('added (no PIN): toast, saved first in the walk order, and the panel shows the empty location', [await P(`return toast()`), await P(`return await locs()`), await P(`return [$('.spanel').getAttribute('aria-label'), norm($('.spanel .h2').textContent), norm($('.spanel .small.muted:not(.found-by)').textContent), btns('.sp-foot .btn'), $$('.pinmark').length]`)], ['Added location “Tools 7”.', ['Tools 7'], ['Location found', 'Tools 7', 'No items here yet', ['Scan again'], 0]]);

  // ── Item editor: Scan beside Location ──
  await P(`await go('#/item/st-0063/edit'); $('.fbody .btn[aria-label="Scan a location"]').click(); await settle();`);
  await P(`await until(() => !dlg(), 'the scan dialog to pick');`);
  check('editor: the camera picks Tools 7 into the Location field', [await P(`return [$('#loc').value, toast()]`)], [['Tools 7', 'Location set to Tools 7. Save to keep it.']]);
  check('the editor Scan buttons: Location and barcode', await P(`return $$('.fbody .inline-add .btn').map((b) => b.getAttribute('aria-label') ?? norm(b.textContent))`), ['Scan a location', 'Scan']);
  await P(`await click('.top .btn', 'Save'); await settle(600);`);
  check('saved: the item is in Tools 7', await P(`return await itemLoc('st-0063')`), 'Tools 7');

  // ── Scan tab: a known bin → its items → found item; Show in Inventory ──
  await P(`await go('#/inventory'); await go('#/scan'); await until(() => $('.spanel'), 'a scan result');`);
  const neo = await P(`return (await idbAll('items')).find((i) => i.id === 'st-0063').name`);
  check('a known bin: Location, its name, 1 item, the item listed, Show in Inventory', await P(`return [norm($('.found-by').textContent), norm($('.spanel .h2').textContent), norm($('.spanel .small.muted:not(.found-by)').textContent), $$('.spanel .pick strong').map((s) => s.textContent), btns('.sp-foot .btn')]`), ['Location', 'Tools 7', '1 item', [neo], ['Show in Inventory', 'Scan again']]);
  await shot('03-scan-location');
  await P(`await click('.spanel .pick', '');`);
  check('tap the item: the usual found panel, "In location Tools 7"', await P(`return [norm($('.found-by').textContent), $('.found-t .h2').textContent]`), ['In location Tools 7', neo]);
  await P(`await click('.sp-foot .btn', 'Done — scan next'); await until(() => $('.spanel'), 'the next scan');`);
  await P(`await click('.sp-foot .btn', 'Show in Inventory'); await settle(800);`);
  check('Show in Inventory: the list filtered to Tools 7 only', await P(`return [location.hash, $$('.row .rname').map((r) => norm(r.textContent)), !!byText('.frow *', 'Location: Tools 7')]`), ['#/inventory', [neo], true]);
  await shot('04-inventory-filtered');

  // ── Typed codes on the Scan tab, camera blocked ──
  await P(`blockCamera(); await go('#/inventory'); await go('#/scan'); await settle(800); await type('#mc', '  electrical   15 '); await click('.denied-type .btn', 'Find');`);
  check('typed "electrical 15": Location not found; Rename offered now that there are locations', await P(`return [$('.spanel').getAttribute('aria-label'), $('.spanel .code-big').textContent, btns('.sp-foot .btn')]`), ['Location not found', 'electrical 15', ['Add “electrical 15” as a location', 'Rename a location to “electrical 15”…', 'Attach to an existing item', 'Add a new item with this code', 'Scan again']]);
  await P(`await click('.sp-foot .btn', 'Rename a location'); await answerGate(false);`);
  check('Rename needs the PIN: Cancel changes nothing', [await P(`return $('.spanel').getAttribute('aria-label')`), await P(`return await locs()`)], ['Location not found', ['Tools 7']]);
  await P(`await click('.sp-foot .btn', 'Scan again'); await type('#mc', 'Electrical 15'); await click('.denied-type .btn', 'Find'); await click('.sp-foot .btn', 'Rename a location'); await answerGate(true, true);`);
  check('after the PIN: pick the location to rename', await P(`return [$('.spanel').getAttribute('aria-label'), norm($('.spanel .h2').textContent), $$('#ren-from option').map((o) => o.value), btns('.sp-foot .btn')]`), ['Rename a location', 'Rename a location to “Electrical 15”', ['Tools 7'], ['Rename “Tools 7”', 'Back']]);
  await shot('05-scan-rename');
  await P(`await click('.sp-foot .btn', 'Rename “Tools 7”'); await settle(500); await relockNow();`);
  check('renamed: toast, the item follows, and the panel shows Electrical 15 with its item', [await P(`return toast()`), await P(`return await locs()`), await P(`return await itemLoc('st-0063')`), await P(`return [norm($('.spanel .h2').textContent), $$('.spanel .pick strong').map((s) => s.textContent)]`)], ['Renamed “Tools 7” to “Electrical 15”.', ['Electrical 15'], 'Electrical 15', ['Electrical 15', [neo]]]);
  await P(`await click('.sp-foot .btn', 'Scan again'); await type('#mc', 'ELECTRICAL15'); await click('.denied-type .btn', 'Find');`);
  check('typed without the space: still Electrical 15', await P(`return [$('.spanel').getAttribute('aria-label'), norm($('.spanel .h2').textContent)]`), ['Location found', 'Electrical 15']);
  await P(`await click('.sp-foot .btn', 'Scan again'); await type('#mc', '012345678905'); await click('.denied-type .btn', 'Find');`);
  check('a typed UPC is still an item code (no location offer)', await P(`return [$('.spanel').getAttribute('aria-label'), btns('.sp-foot .btn')]`), ['Unknown code', ['Attach to an existing item', 'Add a new item with this barcode', 'Scan again']]);
  await P(`await click('.sp-foot .btn', 'Scan again'); await type('#mc', '2408:st-0063'); await click('.denied-type .btn', 'Find');`);
  check('a team label still opens its item', await P(`return $('.found-t .h2')?.textContent`), neo);

  // ── More › Locations: Add by scan ──
  await P(`allowCamera(); await go('#/more/locations'); await click('.top .btn', 'Add by scan'); await until(() => byText('.dlg .h2', 'Location not found'), 'the scan result');`);
  check('Add by scan: the camera reads "Tools 7" (now unknown): Location not found, Add / Rename (PIN) / Scan again', await P(`return [$('.dlg .code-big').textContent, btns('.dlg .dlg-actions .btn')]`), ['Tools 7', ['Scan again', 'Rename a location to “Tools 7”…', 'Add “Tools 7” as a location']]);
  await shot('06-locations-add-by-scan');
  await P(`await click('.dlg .btn', 'Add “Tools 7”'); await settle(400);`);
  check('added at the end of the walk order; the list shows it', [await P(`return toast()`), await P(`return await locs()`), await P(`return $$('.lrow .ln').map((s) => s.textContent)`)], ['Added location “Tools 7”.', ['Electrical 15', 'Tools 7'], ['Electrical 15', 'Tools 7', 'No location']]);
  await P(`await click('.top .btn', 'Add by scan'); await until(() => !dlg(), 'the dialog to close');`);
  check('scanning it again: already in the list, nothing added', [await P(`return toast()`), await P(`return await locs()`)], ['“Tools 7” is already in the list.', ['Electrical 15', 'Tools 7']]);
  await P(`blockCamera(); await click('.top .btn', 'Add by scan'); await typeLoc('2408:st-0063');`);
  check('a team item label is refused as a location', await P(`return [norm($('.dlg .err').textContent), !!$('.dlg input[aria-label="Type the location"]')]`), ['That’s a team item label, not a location. Scan the code on the bin or shelf.', true]);
  await P(`await typeLoc('https://www.revrobotics.com/');`);
  check('a web address: Location not found, but nothing to add', await P(`return [norm($('.dlg .h2').textContent), btns('.dlg .dlg-actions .btn')]`), ['Location not found', ['Scan again']]);
  await P(`await click('.dlg .btn', 'Scan again'); await click('.dlg .btn', 'Cancel');`);

  // ── Count-in by location: Scan a location ──
  await P(`await go('#/count'); await click('.mode', 'By location');`);
  check('by location: a Scan a location button', await P(`return !!byText('.cbody .btn', 'Scan a location')`), true);
  await P(`await click('.cbody .btn', 'Scan a location'); await typeLoc('Shelf 99');`);
  check('count start: an unknown name is only reported', await P(`return [norm($('.dlg .h2').textContent), $('.dlg .code-big').textContent, norm($('.dlg .dlg-p').textContent), btns('.dlg .dlg-actions .btn')]`), ['Location not found', 'Shelf 99', 'No location has this name. Add it in More › Locations first.', ['Scan again']]);
  await P(`await click('.dlg .btn', 'Scan again'); await typeLoc('tools 7'); await settle(300);`);
  check('a location with no items: says so, no walk', await P(`return [toast(), !!dlg(), !!$('.wname')]`), ['Tools 7 has no items to count.', false, false]);
  await P(`await click('.cbody .btn', 'Scan a location'); await typeLoc('Electrical 15'); await settle(500);`);
  check('a location with items: its walk opens at the item', await P(`return [norm($('.wname').textContent), norm($('.wr-pos span').textContent)]`), [neo, 'Electrical 15']);
  await shot('07-count-walk');

  // The location picker in the walk: Scan.
  await P(`allowCamera(); await click('.wloc .fchip', 'Scan'); await until(() => !dlg(), 'the scan to pick');`);
  check('walk picker: the camera picks Tools 7, saved with the count', await P(`return norm($('.wloc-h').textContent)`), 'Location: Tools 7 (saved with the count)');
  await P(`await click('.wacts .btn', 'Skip for now'); await settle(400);`);
  check('skipping saves no location', await P(`return await itemLoc('st-0063')`), 'Electrical 15');

  // ── Filters panel: Scan a location ──
  await P(`await go('#/inventory'); await click('.top .btn', 'Filters'); await click('.fsec .btn', 'Scan a location'); await until(() => !dlg(), 'the scan to finish');`);
  check('Filters: a location with no items says so and changes nothing', await P(`return [toast(), $$('.fsec .fchip.on').length]`), ['No items are in Tools 7 yet.', 0]);
  await P(`blockCamera(); await click('.fsec .btn', 'Scan a location'); await typeLoc('Nowhere 1');`);
  check('Filters: an unknown name is only reported', await P(`return [norm($('.dlg .h2').textContent), btns('.dlg .dlg-actions .btn')]`), ['Location not found', ['Scan again']]);
  await P(`await click('.dlg .btn', 'Scan again'); await typeLoc('electrical 15');`);
  check('Filters: a known name sets the location filter', await P(`return [$$('.fsec .fchip.on').map((c) => norm(c.textContent)), norm($('.fpanel-foot .btn.pri').textContent), !!$('.fpanel')]`), [['Electrical 15'], 'Show 1 item', true]);
  await shot('08-filters');
  await P(`await click('.fpanel-foot .btn', 'Clear all'); await click('.fpanel-foot .btn', 'Show');`);


  // ── §17: touch targets; portrait ──
  const small = `return [...document.querySelectorAll('.dlg button, .dlg input, .dlg select, .fsec .btn, .sp-foot .btn, .spanel input')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.height < 47.5 || r.width < 47.5); }).map((e) => (e.className || e.tagName) + ':' + Math.round(e.getBoundingClientRect().width) + 'x' + Math.round(e.getBoundingClientRect().height))`;
  await P(`allowCamera(); await go('#/more/locations'); await click('.top .btn', 'Add by scan'); await until(() => byText('.dlg .h2', 'Location not found') || !dlg(), 'scan');`);
  // Tools 7 exists now: it closed with "already in the list". Use a typed unknown name.
  await P(`blockCamera(); if (!dlg()) await click('.top .btn', 'Add by scan'); await typeLoc('Pneumatics 3');`);
  check('landscape: dialog touch targets ≥ 48 px', await js(small), []);
  await size(800, 1280);
  await sleep(500);
  check('portrait: dialog touch targets ≥ 48 px; nothing wider than the screen', [await js(small), await js(`return document.documentElement.scrollWidth <= innerWidth`)], [[], true]);
  await shot('09-portrait-dialog');
  await P(`await click('.dlg .btn', 'Scan again'); await click('.dlg .btn', 'Cancel'); await go('#/inventory'); await go('#/scan'); await settle(800); await type('#mc', 'Pneumatics 3'); await click('.denied-type .btn', 'Find');`);
  check('portrait Scan tab Location not found: touch targets ≥ 48 px; fits', [await js(small), await js(`return document.documentElement.scrollWidth <= innerWidth`)], [[], true]);
  await shot('10-portrait-scan');
  await size(360, 740);
  await sleep(500);
  check('phone width 360: the Scan panel fits', await js(`return document.documentElement.scrollWidth <= innerWidth`), true);
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
