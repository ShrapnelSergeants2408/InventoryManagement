// M24 real-browser check (SPEC v0.19): the app's address as a QR code on Helper devices; a
// kit or a counts file saved to Downloads is shown as saved, not sent, until someone says so;
// every opened kit gets a device id and its own new-item numbers, so one kit opened twice
// keeps both devices' new items and the import warns. The shop tablet is localhost and the
// helper 127.0.0.1 (a separate origin, so its own storage), at 360 px wide.
// Usage: npm run build && node scripts/m24-ui-check.mjs <chrome.exe> <screenshot dir>
import { tempDir, track } from './tmp-cleanup.mjs';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from 'node:path';
import JSZip from 'jszip';
import Papa from 'papaparse';
import { PIN_H } from './pin-helpers.mjs';

const [chrome, outDir] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const files = tempDir('m24-files-');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const preview = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', '4372', '--strictPort', '--host', '127.0.0.1'], { stdio: 'ignore' });
const preview2 = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', '4373', '--strictPort'], { stdio: 'ignore' });
const port = 9411;
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
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); return; }
  if (d.method === 'Page.fileChooserOpened') choosers.push(d.params);
  if (d.method === 'Runtime.exceptionThrown') problems.push('exception: ' + JSON.stringify(d.params.exceptionDetails).slice(0, 400));
  if (d.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(d.params.type)) {
    const text = JSON.stringify(d.params.args);
    // Leave helper mode deletes the helper database under the open app; Dexie notes that.
    if (!/Another connection wants to delete database/.test(text)) problems.push(`console.${d.params.type}: ` + text.slice(0, 400));
  }
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

const MAIN = 'http://localhost:4373';
const HELP = 'http://127.0.0.1:4372';
const PAGE = `
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const norm = (s) => s.replace(/\\s+/g, ' ').trim();
  const byText = (sel, t) => $$(sel).find((b) => norm(b.textContent).includes(t));
  const settle = (ms = 350) => new Promise((r) => setTimeout(r, ms));
  const click = async (sel, t) => { const b = byText(sel, t); if (!b) throw new Error('nothing like ' + sel + ' with text ' + t); b.click(); await settle(); return b; };
  const type = async (sel, v) => { const el = $(sel); if (!el) throw new Error('no field ' + sel); el.focus(); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); await settle(250); };
  const pick = async (sel, v) => { const el = $(sel); el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); await settle(250); };
  const go = async (h) => { location.hash = h; await settle(700); };
  const toast = () => norm($('.toast span')?.textContent ?? '');
  const keys = async (digits) => { for (const d of digits) { $$('.pad button').find((b) => b.getAttribute('aria-label') === d).click(); await settle(60); } };
  const dbNames = async () => (await indexedDB.databases()).map((d) => d.name).sort();
  const idbAll = (name, store) => new Promise((res, rej) => {
    const r = indexedDB.open(name);
    r.onsuccess = () => { const db = r.result; const q = db.transaction(store).objectStore(store).getAll(); q.onsuccess = () => { res(q.result); db.close(); }; q.onerror = () => rej(q.error); };
    r.onerror = () => rej(r.error);
  });
  const catchShare = () => {
    window.__shared = null;
    navigator.canShare = () => true;
    navigator.share = async (d) => {
      const f = d.files[0];
      const b = new Uint8Array(await f.arrayBuffer());
      let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
      window.__shared = { name: f.name, type: f.type, title: d.title, b64: btoa(s) };
    };
  };
  // Phone layout (§2, §17): nothing wider than the screen; every control at least 48 px.
  const wide = () => document.documentElement.scrollWidth > innerWidth || $$('.main *').some((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > innerWidth + 1 && getComputedStyle(e).position !== 'fixed'; });
  const small = () => $$('.happ button, .happ a.btn, .happ .hnav a, .happ input:not(.vh), .happ select, .happ label.btn').filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (r.height < 47.5 || r.width < 47.5); }).map((e) => norm(e.textContent || e.getAttribute('aria-label') || e.tagName) + ' ' + Math.round(e.getBoundingClientRect().width) + 'x' + Math.round(e.getBoundingClientRect().height));
  ${PIN_H}
`;
const P = (expr) => js(`${PAGE} ${expr}`);

/** Clicks a button that opens the file picker and hands it `path`. */
const chooseFile = async (sel, text, path) => {
  const before = choosers.length;
  await send('Runtime.evaluate', { expression: `(() => { ${PAGE} byText(${JSON.stringify(sel)}, ${JSON.stringify(text)}).click(); })()`, userGesture: true });
  for (let i = 0; i < 50 && choosers.length === before; i++) await sleep(100);
  if (choosers.length === before) throw new Error('no file chooser opened for ' + text);
  await send('DOM.setFileInputFiles', { files: [path], backendNodeId: choosers.at(-1).backendNodeId });
  await sleep(700);
};
const shared = async () => {
  const s = await P(`for (let i = 0; i < 100 && !window.__shared; i++) await settle(100); return window.__shared`);
  if (!s) throw new Error('nothing reached the share sheet');
  return { ...s, bytes: Buffer.from(s.b64, 'base64') };
};
const csvOf = async (zip, name) => Papa.parse((await zip.file(name).async('string')).replace(/^\uFEFF/, ''), { header: true, skipEmptyLines: true }).data;

// ── M24 additions to the page helpers ──
const EXTRA = `
  // No share sheet (Chrome on Android refuses a ZIP): the file is "downloaded", and kept here.
  // The anchor's click stays replaced for the rest of the page, so links are followed with go().
  const noShare = () => {
    window.__dl = null;
    navigator.canShare = undefined;
    navigator.share = undefined;
    HTMLAnchorElement.prototype.click = function () {
      if (!this.download) return;
      const name = this.download;
      fetch(this.href).then((r) => r.arrayBuffer()).then((buf) => {
        const b = new Uint8Array(buf);
        let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
        window.__dl = { name, b64: btoa(s) };
      });
    };
  };
  const tiles = (sel) => $$(sel + ' .tile').map((t) => [norm(t.querySelector('.k').textContent), norm(t.querySelector('.v').textContent)]);
  const setting = async (key) => (await idbAll('frc2408-helper', 'settings')).find((s) => s.key === key)?.value;
`;
const Q = (expr) => js(`${PAGE} ${EXTRA} ${expr}`);
const downloaded = async () => {
  const s = await Q(`for (let i = 0; i < 100 && !window.__dl; i++) await settle(100); return window.__dl`);
  if (!s) throw new Error('nothing was downloaded');
  return { ...s, bytes: Buffer.from(s.b64, 'base64') };
};
/** Clicks a button that opens the file picker and hands it several files. */
const chooseFiles = async (sel, text, paths) => {
  const before = choosers.length;
  await send('Runtime.evaluate', { expression: `(() => { ${PAGE} byText(${JSON.stringify(sel)}, ${JSON.stringify(text)}).click(); })()`, userGesture: true });
  for (let i = 0; i < 50 && choosers.length === before; i++) await sleep(100);
  if (choosers.length === before) throw new Error('no file chooser opened for ' + text);
  await send('DOM.setFileInputFiles', { files: paths, backendNodeId: choosers.at(-1).backendNodeId });
  await sleep(900);
};
const TODAY = '\\\\d+:\\\\d\\\\d [AP]M';

try {
  await send('Runtime.enable');
  await send('Page.enable');
  await send('DOM.enable');
  await send('Page.setInterceptFileChooserDialog', { enabled: true });
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });

  // ── Shop tablet: the app's address as a QR code on Helper devices (B3) ──
  await size(1280, 800);
  await send('Page.navigate', { url: MAIN + '/' });
  await waitFor(`document.querySelector('.setup')`, 60000);
  await P(`await doSetup();`);
  await waitFor(`document.querySelectorAll('.cathdr').length >= 11`, 60000);
  await P(`await go('#/count/helpers');`);
  await waitFor(`document.querySelector('.happlink')`);
  check('Helper devices: the app’s own address as a QR code and in words, above who counts what', await P(`const c = $('.happlink'); const q = c.querySelector('svg.qr'); return [norm(c.querySelector('.h2').textContent), q.getAttribute('aria-label'), norm(c.querySelector('.happlink-a').textContent), Math.round(q.getBoundingClientRect().width), q.querySelector('path').getAttribute('d').length > 500, /Join as a helper/.test(norm(c.textContent)), c.compareDocumentPosition($('.cgroups')) === Node.DOCUMENT_POSITION_FOLLOWING]`), ['Open the app on a helper', `QR code ${MAIN}/`, 'localhost:4373/', 144, true, true, true]);
  await shot('01-helpers-qr');

  // ── A kit saved to Downloads is not sent (B2, tablet) ──
  await P(`await click('.top .btn', 'Add helper'); await type('#hname', 'Maya’s phone'); $$('.hgroup').find((x) => norm(x.querySelector('strong').textContent) === 'Electrical').click(); await settle(150); await click('.dlg .btn', 'Add helper'); await settle(500);`);
  await Q(`noShare(); $$('.hcard').find((c) => norm(c.querySelector('.h2').textContent) === 'Maya’s phone').querySelector('.btn.pri').click(); await settle(600); await click('.dlg .btn', 'Send count kit');`);
  const kitFile = await downloaded();
  const kitPath = join(files, kitFile.name);
  writeFileSync(kitPath, kitFile.bytes);
  const kitJson = JSON.parse(await (await JSZip.loadAsync(kitFile.bytes)).file('kit.json').async('string'));
  await sleep(400);
  check('no share sheet: the dialog stays and says the kit is in Downloads, not on the helper', await P(`return [${JSON.stringify(kitFile.name)} === 'Maya_s_phone_Helper.zip', norm($('.dlg .h2').textContent), $$('.dlg .dlg-p').map((p) => norm(p.textContent)), $$('.dlg-actions .btn').map((b) => norm(b.textContent)), toast().includes('_Helper.zip')]`), [true, 'Saved to Downloads, not sent yet', [`${kitFile.name} is in this tablet’s Downloads. “Maya’s phone” doesn’t have it yet.`, 'Open Files or Drive and send it to the helper: upload it to the team’s Drive folder, or use Quick Share or email. Then open it on the helper with “Join as a helper”.'], ['Done'], false]);
  await shot('02-kit-saved');
  await P(`await click('.dlg-actions .btn', 'Done'); await settle(400);`);
  check('Done closes it; the kit is recorded (the name is locked)', await P(`return [!$('.dlg'), /^Last kit sent .* · name locked$/.test(norm($('.hcard .small').textContent)), (await idbAll('frc2408-inventory', 'helpers'))[0].kits.length]`), [true, true, 1]);
  await P(`catchShare(); $$('.hcard').find((c) => norm(c.querySelector('.h2').textContent) === 'Maya’s phone').querySelector('.btn.pri').click(); await settle(600); await click('.dlg .btn', 'Send count kit');`);
  await shared();
  await sleep(400);
  check('with a share sheet: as before, the dialog closes with “Sent …”', await P(`return [!$('.dlg'), toast().startsWith('Sent Maya_s_phone_Helper.zip')]`), [true, true]);
  await size(800, 1280);
  await P(`await settle(300);`);
  check('portrait: the QR card fits', await P(`return [document.documentElement.scrollWidth > innerWidth, Math.round($('.happlink svg.qr').getBoundingClientRect().width)]`), [false, 144]);
  await shot('03-helpers-qr-portrait');

  // ── Helper at 360 px: counts saved to Downloads are not "sent" (B2) ──
  await size(360, 780, true);
  await send('Page.navigate', { url: HELP + '/' });
  await waitFor(`document.querySelector('.role-opt')`, 60000);
  await P(`await click('.role-opt', 'Join as a helper');`);
  await chooseFile('.kitpick .btn', 'Choose the count kit', kitPath);
  await waitFor(`document.querySelector('.sfile strong')`);
  await P(`await click('.setup-acts .btn', 'Start counting'); await settle(1200);`);
  await waitFor(`document.querySelector('.hbar')`);
  const dev1 = await Q(`return await setting('helperDevice')`);
  await P(`await click('.cg-row .btn', 'Start'); await keys('3'); await click('.wsave', 'Save & next'); await settle(400); await click('.top .btn', 'Pause'); await settle(300);`);
  await P(`await go('#/add'); await type('#pn', 'Zip ties'); $('[aria-label="On hand plus one"]').click(); await settle(100); await click('.hadd-acts .btn', 'Save as pending'); await settle(800);`);
  const pend1 = (await P(`return await idbAll('frc2408-helper', 'pendingItems')`)).map((p) => p.id);
  const numOf = (id) => Number(id.slice(`pending-${kitJson.helper_id}-`.length));
  check('opening a kit gives the device an id; a new item is numbered from the device’s own block (B1)', [/^dev-[2-9A-Z]{5}$/.test(dev1), pend1.length, pend1[0]?.startsWith(`pending-${kitJson.helper_id}-`), numOf(pend1[0]) >= 1_000_000_001, numOf(pend1[0]) % 10000], [true, 1, true, true, 1]);

  await P(`await go('#/send');`);
  await Q(`noShare(); await click('.hsend-go .btn', 'Send my counts');`);
  const c1 = await downloaded();
  const c1Path = join(files, 'phone1-' + c1.name);
  writeFileSync(c1Path, c1.bytes);
  const j1 = JSON.parse(await (await JSZip.loadAsync(c1.bytes)).file('counts.json').async('string'));
  await sleep(500);
  check('counts.json carries the device id; the format version is still 1', [j1.device_id === dev1, j1.format_version, j1.sequence], [true, 1, 1]);
  check('no share sheet: “Saved to Downloads”, “Not on the shop tablet yet”, not “Everything is sent”', await P(`return [new RegExp('^Saved to Downloads today ${TODAY}$').test(norm($('.hlast-h').textContent)), norm($('.hlast .small').textContent), norm($('.hsaved .grow').textContent), norm($('.hsaved .btn').textContent), norm($('.hnav a[href="#/send"]').textContent), $('.hnav .hbadge').getAttribute('aria-label')]`), [true, 'Not on the shop tablet yet', `${c1.name} is in this device’s Downloads. The shop tablet doesn’t have it yet: upload it to the team’s Drive folder, or send it by Quick Share or email.`, 'I’ve sent it', 'Send!', 'saved, not sent yet']);
  check('phone Send screen with the notice: fits 360 px; targets ≥ 48 px', await P(`return [wide(), small()]`), [false, []]);
  await shot('04-send-saved-phone');
  await P(`await go('#/count'); await settle(400);`);
  check('Count: a navy reminder that the file is only in Downloads', await P(`return [norm($('.hremind .grow').textContent), getComputedStyle($('.hremind')).backgroundColor, norm($('.hremind .btn').textContent), wide()]`), ['Your counts file is saved in Downloads. The shop tablet doesn’t have it yet.', 'rgb(31, 58, 95)', 'Send', false]);
  await shot('05-count-reminder-phone');
  await P(`await go('#/send'); await click('.hmore .btn', 'Leave helper mode'); await settle(300);`);
  check('Leave helper mode: says the last file was only saved to Downloads', await P(`return [norm($('.dlg .h2').textContent), /Your last counts file was only saved to Downloads\\. Make sure it reached the shop tablet first/.test(norm($('.dlg .dlg-p').textContent)), $$('.dlg-actions .btn').map((b) => norm(b.textContent))]`), ['Leave helper mode?', true, ['Cancel', 'Leave helper mode']]);
  await shot('06-leave-saved-phone');
  await P(`await click('.dlg-actions .btn', 'Cancel'); await click('.hsaved .btn', 'I’ve sent it'); await settle(500);`);
  check('“I’ve sent it”: Last sent, Everything is sent, the notice and badge gone', await P(`return [new RegExp('^Last sent today ${TODAY}$').test(norm($('.hlast-h').textContent)), norm($('.hlast .small').textContent), !$('.hsaved'), norm($('.hnav a[href="#/send"]').textContent), (await idbAll('frc2408-helper', 'settings')).find((s) => s.key === 'helperSent').value.saved === undefined]`), [true, 'Everything is sent', true, 'Send', true]);
  await P(`await go('#/count'); await settle(300);`);
  check('…and no reminder on Count', await P(`return !$('.hremind')`), true);

  // ── The same kit opened again (as on a second phone): its own device id and item numbers (B1) ──
  await P(`await go('#/send'); await click('.hmore .btn', 'Leave helper mode'); await settle(300); await click('.dlg-actions .btn', 'Leave helper mode'); await settle(1500);`);
  await waitFor(`document.querySelector('.role-opt')`);
  await P(`await click('.role-opt', 'Join as a helper');`);
  await chooseFile('.kitpick .btn', 'Choose the count kit', kitPath);
  await waitFor(`document.querySelector('.sfile strong')`);
  await P(`await click('.setup-acts .btn', 'Start counting'); await settle(1200);`);
  await waitFor(`document.querySelector('.hbar')`);
  const dev2 = await Q(`return await setting('helperDevice')`);
  await P(`await click('.cg-row .btn', 'Start'); await keys('5'); await click('.wsave', 'Save & next'); await settle(400); await click('.top .btn', 'Pause'); await settle(300);`);
  await P(`await go('#/add'); await type('#pn', 'Fuse 40 A'); $('[aria-label="On hand plus one"]').click(); await settle(100); await click('.hadd-acts .btn', 'Save as pending'); await settle(800);`);
  const pend2 = (await P(`return await idbAll('frc2408-helper', 'pendingItems')`)).map((p) => p.id);
  check('the same kit opened again: another device id, another block of item numbers', [/^dev-[2-9A-Z]{5}$/.test(dev2), dev2 !== dev1, pend2.length, pend2[0] !== pend1[0], numOf(pend2[0]) % 10000], [true, true, 1, true, 1]);
  await P(`await go('#/send'); catchShare(); await click('.hsend-go .btn', 'Send my counts');`);
  const c2 = await shared();
  const c2Path = join(files, 'phone2-' + c2.name);
  writeFileSync(c2Path, c2.bytes);
  await sleep(500);
  check('with a share sheet: “Last sent”, “Everything is sent”, no notice (as before)', await P(`return [new RegExp('^Last sent today ${TODAY}$').test(norm($('.hlast-h').textContent)), norm($('.hlast .small').textContent), !$('.hsaved'), toast().startsWith('Sent counts-maya-s-phone-')]`), [true, 'Everything is sent', true, true]);

  // ── Shop tablet: both files in one import ──
  await size(1280, 800);
  await send('Page.navigate', { url: MAIN + '/#/count/import' });
  await waitFor(`document.querySelector('.imp-start')`, 30000);
  await chooseFiles('.imp-start .btn', 'Choose counts files', [c1Path, c2Path]);
  await waitFor(`document.querySelector('.imp-grid')`);
  check('preview: two files, a warning that the kit was opened on 2 devices, both new items kept; the item both counted is a conflict (v0.20)', await Q(`return [$$('.imp-file .mono').length, $$('.imp .hwarn').map((w) => norm(w.textContent)), norm($('.imp-pend').textContent).includes('2 new items from helpers'), !!byText('.imp-side .small', 'already here or already dealt with'), tiles('.imp-tiles6').slice(0, 2)]`), [2, ['The count kit for “Maya’s phone” was opened on 2 devices, or opened again on one. Where they counted the same item and the numbers differ, you choose which to keep. A second device should have its own helper.'], true, false, [['Will apply', '1'], ['Conflicts', '1 left']]]);
  await shot('07-import-two-devices');
  await size(800, 1280);
  await P(`await settle(300);`);
  check('portrait: the warning fits', await P(`return document.documentElement.scrollWidth > innerWidth`), false);
  await shot('08-import-two-devices-portrait');
  await size(1280, 800);
  await P(`await click('.imp-opt', 'Use the later'); await settle(300);`);
  await P(`await click('.imp-side .btn', 'Apply'); await settle(1200);`);
  check('applied: both new items wait as pending; the helper remembers both devices', await Q(`const h = (await idbAll('frc2408-inventory', 'helpers'))[0]; const p = await idbAll('frc2408-inventory', 'pendingItems'); return [tiles('.imp-tiles').find((t) => t[0] === 'New items waiting'), p.map((x) => x.name).sort(), Object.keys(h.devices).length, Object.values(h.devices)[0].length]`), [['New items waiting', '2'], ['Fuse 40 A', 'Zip ties'], 1, 2]);
  check('…with the ids the devices gave them', [(await P(`return (await idbAll('frc2408-inventory', 'pendingItems')).map((x) => x.id).sort()`)), (await P(`return Object.values((await idbAll('frc2408-inventory', 'helpers'))[0].devices)[0]`))], [[pend1[0], pend2[0]].sort(), [dev1, dev2].sort()]);
  await P(`await click('.imp .wacts .btn', 'Undo this import'); await settle(400); await click('.dlg-actions .btn', 'Undo this import'); await settle(1000);`);
  check('Undo this import: the pending items go and the helper forgets the devices', await P(`const h = (await idbAll('frc2408-inventory', 'helpers'))[0]; return [(await idbAll('frc2408-inventory', 'pendingItems')).length, h.devices === undefined, h.lastImportAt]`), [0, true, null]);
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
  preview2.kill();
  process.exit(process.exitCode);
}
