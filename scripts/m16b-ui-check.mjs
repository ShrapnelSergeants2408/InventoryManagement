// M16b real-browser check: helper mode on a helper device (§18.2–§18.4, F22, §17). The shop
// tablet (localhost) sends a real count kit; the helper (127.0.0.1, a separate origin, so its
// own storage like a separate phone) joins at 360 px wide, counts, adds a location, attaches a
// barcode, adds a pending item and sends the counts file, which is read back here. Then the
// unsent-changes checks, Leave helper mode, and phone layout (no sideways scroll, keys ≥ 64 px).
// Usage: npm run build && node scripts/m16b-ui-check.mjs <chrome.exe> <screenshot dir>
import { tempDir, track } from './tmp-cleanup.mjs';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from 'node:path';
import JSZip from 'jszip';
import Papa from 'papaparse';
import { PIN_H } from './pin-helpers.mjs';

const [chrome, outDir] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const files = tempDir('m16b-files-');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const preview = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', '4342', '--strictPort', '--host', '127.0.0.1'], { stdio: 'ignore' });
const preview2 = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', '4343', '--strictPort'], { stdio: 'ignore' });
const port = 9362;
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

const MAIN = 'http://localhost:4343';
const HELP = 'http://127.0.0.1:4342';
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

try {
  await send('Runtime.enable');
  await send('Page.enable');
  await send('DOM.enable');
  await send('Page.setInterceptFileChooserDialog', { enabled: true });
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });

  // ── Shop tablet: the first question, then setup, a helper and its kit ──
  await size(1280, 800);
  await send('Page.navigate', { url: MAIN + '/' });
  await waitFor(`document.querySelector('.setup')`, 60000);
  check('fresh device: the first question, two choices, no database made yet', await P(`return [norm($('.setup-h').textContent), $$('.role-opt .sopt-h').map((e) => norm(e.textContent)), await dbNames()]`), ['What is this device?', ['Set up the shop tablet', 'Join as a helper'], []]);
  await shot('01-first-question');
  await P(`await doSetup();`);
  await waitFor(`document.querySelectorAll('.cathdr').length >= 11`, 60000);
  check('shop tablet: set up as before (PIN, starter catalog), only the inventory database', await P(`return [(await idbAll('frc2408-inventory', 'items')).length, await dbNames()]`), [129, ['frc2408-inventory']]);
  await P(`location.reload();`);
  await sleep(2500);
  await waitFor(`document.querySelectorAll('.cathdr').length >= 11`, 30000);
  check('a device with an inventory never sees the question again', await P(`return [!$('.setup'), !$('.role-opt')]`), [true, true]);

  await P(`await go('#/count/helpers'); await click('.top .btn', 'Add helper'); await type('#hname', 'Maya’s phone'); $$('.hgroup').find((x) => norm(x.querySelector('strong').textContent) === 'Electrical').click(); await settle(150); await click('.dlg .btn', 'Add helper'); await settle(500);`);
  await P(`catchShare(); $$('.hcard').find((c) => norm(c.querySelector('.h2').textContent) === 'Maya’s phone').querySelector('.btn.pri').click(); await settle(600); await click('.dlg .btn', 'Send count kit');`);
  const kitFile = await shared();
  const kitPath = join(files, kitFile.name);
  writeFileSync(kitPath, kitFile.bytes);
  const kitZip = await JSZip.loadAsync(kitFile.bytes);
  const kitCsv = await csvOf(kitZip, 'inventory.csv');
  const elec = kitCsv.filter((r) => r.category === 'Electrical');
  const other = kitCsv.find((r) => r.category !== 'Electrical');
  // A kit from a newer app (format_version 2) and a backup that isn't a kit.
  const kitJson = JSON.parse(await kitZip.file('kit.json').async('string'));
  kitZip.file('kit.json', JSON.stringify({ ...kitJson, format_version: 2 }));
  const newerPath = join(files, 'count-kit-newer.zip');
  writeFileSync(newerPath, await kitZip.generateAsync({ type: 'nodebuffer' }));
  kitZip.file('kit.json', JSON.stringify(kitJson));
  const seedPath = join(process.cwd(), 'seed', 'frc2408-starter-catalog-2026-10-21.zip');

  // ── Helper: join at 360 px ──
  await size(360, 780, true);
  await send('Page.navigate', { url: HELP + '/' });
  await waitFor(`document.querySelector('.role-opt')`, 60000);
  check('phone, first question: fits 360 px; targets ≥ 48 px', await P(`return [wide(), $$('.setup button').filter((e) => e.getBoundingClientRect().height < 47.5).length]`), [false, 0]);
  await P(`await click('.role-opt', 'Join as a helper');`);
  check('Join: the kit step, still no database', await P(`return [norm($('.setup-h').textContent), !!byText('.kitpick .btn', 'Choose the count kit'), await dbNames()]`), ['Open your count kit', true, []]);
  await shot('02-join');
  await chooseFile('.kitpick .btn', 'Choose the count kit', seedPath);
  await waitFor(`document.querySelector('.kitpick [role=alert]')`);
  check('a backup is refused with where to get a kit; nothing made', await P(`return [norm($('.kitpick [role=alert] li').textContent), await dbNames()]`), ['This is an inventory backup, not a count kit. Ask for a count kit from the shop tablet (Count › Helper devices › Send count kit).', []]);
  await chooseFile('.kitpick .btn', 'Choose the count kit', newerPath);
  await waitFor(`document.querySelector('.kitpick [role=alert] .btn')`);
  check('a newer kit format: refused with “reload” and a Reload button', await P(`return [/newer version of the app\\. Reload the app/.test(norm($('.kitpick [role=alert] li').textContent)), norm($('.kitpick [role=alert] .btn').textContent), await dbNames()]`), [true, 'Reload the app', []]);
  await shot('03-newer-kit');
  await chooseFile('.kitpick .btn', 'Choose the count kit', kitPath);
  await waitFor(`document.querySelector('.sfile strong')`);
  check('the kit: helper, groups, items and photos, before joining', await P(`return [$$('.sfile > *').map((e) => norm(e.textContent))]`), [['Maya’s phone', 'Categories: Electrical', `129 items · ${kitCsv.filter((r) => r.photo_file).length} photos · new items allowed`]]);
  await P(`await click('.setup-acts .btn', 'Start counting'); await settle(1200);`);
  await waitFor(`document.querySelector('.hbar')`);
  check('helper mode: the navy bar, three tabs, Count open, its own database only', await P(`return [norm($('.hbar strong').textContent) + ' ' + norm($('.hbar-t').textContent), getComputedStyle($('.hbar')).backgroundColor, $$('.hnav a').map((a) => norm(a.textContent)), norm($('.hnav a.on').textContent), location.hash, await dbNames()]`), ['HELPER · Maya’s phone · Electrical', 'rgb(31, 58, 95)', ['Count', 'Scan', 'Send'], 'Count', '#/count', ['frc2408-helper']]);
  check('no PIN, order total, count rounds or helper devices on a helper', await P(`return [$$('.lockpill').length, !!$('.ctotal'), !!$('.cround'), !!byText('.btn', 'Helper devices')]`), [0, false, false, false]);
  check('start: my groups only, the item count, Add item not on the list', await P(`return [norm($('.hmine .chelp-h').textContent), norm($('.hmine .small').textContent).split('.')[0], !!byText('.hmine .btn', 'Add item not on the list'), $$('.cg-row strong:first-child').map((e) => norm(e.textContent)), norm($('.cprog-t span').textContent)]`), ['Your category: Electrical', `${elec.length} items to count`, true, ['Electrical'], `0 of ${elec.length} in your groups counted`]);
  check('phone start screen: no sideways scroll; targets ≥ 48 px', await P(`return [wide(), small()]`), [false, []]);
  await shot('04-helper-start');

  // ── Count two items in the walk; add a location on the way ──
  await P(`await click('.cg-row .btn', 'Start');`);
  const first = await P(`return norm($('.wname').textContent)`);
  check('the walk: keypad keys ≥ 64 px tall, stepper-free, fits 360 px', await P(`return [$$('.pad button').every((b) => b.getBoundingClientRect().height >= 64), $$('.pad button').length, wide(), small()]`), [true, 12, false, []]);
  await shot('05-walk-phone');
  await P(`await keys('3'); await click('.wsave', 'Save & next'); await settle(400);`);
  const second = await P(`return norm($('.wname').textContent)`);
  await P(`await click('.wloc .fchip', 'New location'); await type('[aria-label="New location name"]', 'Bin Z'); await click('.wloc-add .btn', 'Add'); await settle(300); await keys('12'); await click('.wsave', 'Save & next'); await settle(400);`);
  check('no "No location" choice on a helper (blank means unchanged)', await P(`return $$('.wloc-all option').map((o) => o.textContent).includes('No location')`), false);
  await P(`await click('.top .btn', 'Pause'); await settle(400);`);
  check('after counting: progress, the navy send reminder, the Send badge', await P(`return [norm($('.cprog-t span').textContent), norm($('.hremind .grow').textContent), getComputedStyle($('.hremind')).backgroundColor, norm($('.hnav a[href="#/send"]').textContent)]`), [`2 of ${elec.length} in your groups counted`, '3 changes not sent yet. Send your counts to the shop tablet before you leave.', 'rgb(31, 58, 95)', 'Send3']);
  await shot('06-reminder');

  // ── Scan tab: an item outside my groups; an unknown code; attach it ──
  await P(`await go('#/scan'); await settle(1200);`);
  check('Scan tab: scan as you go, no Pause, a code box', await P(`return [norm($('.top .small').textContent), !byText('.top .btn', 'Pause'), !!$('.wscan input')]`), ['Scan as you go · any item, in your groups or not', true, true]);
  await P(`await type('.wscan input', '${other.id}'); await click('.wscan .btn', 'Find'); await settle(500);`);
  check('an item outside my groups opens, marked', await P(`return [norm($('.wname').textContent), norm($('.hout').textContent)]`), [other.name, 'Not in your groups. Count it anyway if it’s here; the shop tablet will see it was outside your groups.']);
  await P(`await keys('4'); await click('.wsave', 'Save & scan next'); await settle(400);`);
  await P(`await type('.wscan input', '999000111'); await click('.wscan .btn', 'Find'); await settle(400);`);
  check('an unknown code: Attach or Add item not on the list', await P(`return [norm($('.hunk strong').textContent), $$('.hunk .btn').map((b) => norm(b.textContent))]`), ['No item has the code 999000111', ['Attach to an item…', 'Add item not on the list']]);
  await shot('07-unknown');
  await P(`await click('.hunk .btn', 'Attach'); await type('.dlg input', ${JSON.stringify(elec[3].name)}); await settle(300); $$('.dlg .pick')[0].click(); await settle(700);`);
  check('attached: the item opens with its new barcode', await P(`return [toast(), norm($('.wname').textContent)]`), [`Barcode attached to “${elec[3].name}”.`, elec[3].name]);
  await P(`await click('.wacts .btn', 'Skip for now');`);

  // ── Add item not on the list ──
  await P(`await type('.wscan input', '777000222'); await click('.wscan .btn', 'Find'); await settle(300); await click('.hunk .btn', 'Add item not on the list'); await settle(700);`);
  const wideEls = await P(`return $$('.main *').filter((e) => e.getBoundingClientRect().right > innerWidth + 1).map((e) => e.tagName + '.' + e.className + ' ' + norm(e.textContent).slice(0, 30))`);
  if (wideEls.length) results.push('INFO wider than the screen: ' + JSON.stringify(wideEls.slice(0, 5)));
  check('the form: PENDING note, barcode filled in, fits 360 px, targets ≥ 48 px', await P(`return [location.hash, norm($('.chip.pend').textContent), getComputedStyle($('.chip.pend')).borderStyle, $('#pb').value, wide(), small()]`), ['#/add?barcode=777000222', 'PENDING', 'dashed', '777000222', false, []]);
  await shot('08-add-phone');
  await P(`await click('.hadd-acts .btn', 'Save as pending'); await settle(300);`);
  check('nothing typed: name and on hand asked for, nothing saved', [await P(`return $$('.hadd .err').map((e) => norm(e.textContent))`), (await P(`return await idbAll('frc2408-helper', 'pendingItems')`)).length], [['Name is required.', 'On hand is required: how many are here?'], 0]);
  await P(`await type('#pn', 'Talon SRX, old model'); $('[aria-label="On hand plus one"]').click(); await settle(100); $('[aria-label="On hand plus one"]').click(); await settle(100); await pick('#pl', 'Bin Z'); await type('#pno', 'red bin, top\\nleft side'); await click('.hadd .btn', 'Add supplier'); await pick('#pvs', 'REV'); await type('#pvr', '45'); await click('.hadd-acts .btn', 'Save as pending'); await settle(800);`);
  const pend = await P(`return await idbAll('frc2408-helper', 'pendingItems')`);
  check('saved as pending: id, fields, back to Count', [pend.map((p) => [p.id, p.name, p.onHand, p.location, p.barcode, p.notes, p.vendor?.supplier, p.vendor?.packPriceCents, p.helperName]), await P(`return [location.hash, toast()]`)], [[[`pending-${kitJson.helper_id}-1`, 'Talon SRX, old model', 2, 'Bin Z', '777000222', 'red bin, top\nleft side', 'REV', 4500, 'Maya’s phone']], ['#/count', 'Saved “Talon SRX, old model” as pending. It goes with your counts.']]);

  // ── Send ──
  await P(`await go('#/send');`);
  check('Send: not sent yet, what will go, the file name', await P(`return [norm($('.hlast').textContent), $$('.hsum-r').map((r) => [norm(r.firstElementChild.textContent), +r.lastElementChild.textContent]), /^Creates counts-maya-s-phone-\\d{4}-\\d\\d-\\d\\d-\\d{4}\\.zip and opens the share menu\\.$/.test(norm($('.hsend-go p').textContent))]`), ['Not sent yet6 changes not sent yet', [['Items counted', 3], ['Location changes', 1], ['Barcodes attached', 1], ['New locations', 1], ['New items (pending)', 1], ['Counted outside my groups', 1]], true]);
  check('phone Send screen: fits; targets ≥ 48 px', await P(`return [wide(), small()]`), [false, []]);
  await shot('09-send-phone');
  await P(`catchShare(); await click('.hsend-go .btn', 'Send my counts');`);
  const c1 = await shared();
  const z1 = await JSZip.loadAsync(c1.bytes);
  const j1 = JSON.parse(await z1.file('counts.json').async('string'));
  const rows1 = await csvOf(z1, 'counts.csv');
  const byName = Object.fromEntries(kitCsv.map((r) => [r.name, r.id]));
  check('the counts file: name, counts.json', [/^counts-maya-s-phone-\d{4}-\d\d-\d\d-\d{4}\.zip$/.test(c1.name), c1.title, j1.format, j1.format_version, j1.kit_id === kitJson.kit_id, j1.helper_id === kitJson.helper_id, j1.helper_name, j1.sequence, j1.app_version], [true, 'Counts from Maya’s phone', 'frc2408-counts', 1, true, true, 'Maya’s phone', 1, kitJson.app_version]);
  const STAMP = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d[+-]\d\d:\d\d$/;
  check('counts.csv: one row per item changed, latest values, blank = unchanged, outside marked', rows1.map((r) => [r.item_id, r.on_hand, STAMP.test(r.counted_at) || r.counted_at, r.location, r.barcode, r.outside_assignment]).sort(), [
    [byName[first], '3', true, '', '', ''],
    [byName[second], '12', true, 'Bin Z', '', ''],
    [other.id, '4', true, '', '', 'yes'],
    [elec[3].id, '', '', '', '999000111', ''],
  ].sort());
  const ni = await csvOf(z1, 'new-items.csv');
  check('new-items.csv, locations-new.csv and the files in the ZIP', [ni.map((r) => [r.pending_id, r.name, r.on_hand, r.location, r.barcode, r.notes, r.v1_supplier, r.v1_pack_price, r.photo_file]), await csvOf(z1, 'locations-new.csv'), Object.keys(z1.files).sort()], [[[`pending-${kitJson.helper_id}-1`, 'Talon SRX, old model', '2', 'Bin Z', '777000222', 'red bin, top\nleft side', 'REV', '45.00', '']], [{ name: 'Bin Z' }], ['counts.csv', 'counts.json', 'locations-new.csv', 'new-items.csv']]);
  await sleep(500);
  check('sent: Last sent today, everything is sent, the badge and reminder gone', await P(`return [/^Last sent today \\d+:\\d\\d [AP]M$/.test(norm($('.hlast-h').textContent)), norm($('.hlast .small').textContent), norm($('.hnav a[href="#/send"]').textContent), toast().startsWith('Sent counts-maya-s-phone-')]`), [true, 'Everything is sent', 'Send', true]);
  await P(`catchShare(); await click('.hsend-go .btn', 'Send my counts');`);
  const c2 = await shared();
  const z2 = await JSZip.loadAsync(c2.bytes);
  check('sending again: the same rows (cumulative), sequence 2', [JSON.parse(await z2.file('counts.json').async('string')).sequence, JSON.stringify(await csvOf(z2, 'counts.csv')) === JSON.stringify(rows1)], [2, true]);

  // ── Unsent changes guard a new kit and leaving ──
  await P(`await go('#/count'); await settle(400); await click('.cg-row .btn', 'Continue'); await keys('1'); await click('.wsave', 'Save & next'); await settle(300); await click('.top .btn', 'Pause'); await go('#/send');`);
  check('one more count: 1 change not sent', await P(`return norm($('.hlast .small').textContent)`), '1 change not sent yet');
  await chooseFile('.hmore .kitpick .btn', 'Open a new kit', kitPath);
  await waitFor(`document.querySelector('.dlg')`);
  check('Open a new kit with unsent changes: asks, Send first or Discard (destructive)', await P(`return [norm($('.dlg .h2').textContent), norm($('.dlg .dlg-p').textContent), $$('.dlg-actions .btn').map((b) => [norm(b.textContent), b.classList.contains('danger')])]`), ['Open a new kit?', '1 change hasn’t been sent to the shop tablet. Send your counts first, or they’re lost.', [['Cancel', false], ['Send my counts first', false], ['Discard unsent counts', true]]]);
  await shot('10-new-kit-ask');
  await P(`await click('.dlg-actions .btn', 'Cancel'); await click('.hmore .btn', 'Leave helper mode');`);
  check('Leave with unsent changes: the same question', await P(`return [norm($('.dlg .h2').textContent), $$('.dlg-actions .btn').map((b) => norm(b.textContent))]`), ['Leave helper mode?', ['Cancel', 'Send my counts first', 'Discard and leave']]);
  await P(`catchShare(); await click('.dlg-actions .btn', 'Send my counts first'); await settle(800);`);
  const c3 = await shared();
  check('Send first: sequence 3 goes, then the dialog offers to leave', [JSON.parse(await (await JSZip.loadAsync(c3.bytes)).file('counts.json').async('string')).sequence, await P(`return [norm($('.dlg .dlg-p').textContent), $$('.dlg-actions .btn').map((b) => norm(b.textContent))]`)], [3, ['This clears this device’s copy of the inventory. Everything you counted was sent.', ['Cancel', 'Leave helper mode']]]);
  await P(`await click('.dlg-actions .btn', 'Leave helper mode'); await settle(1200);`);
  await waitFor(`document.querySelector('.role-opt')`);
  check('left: back to the first question; the helper database is gone', await P(`return [norm($('.setup-h').textContent), await dbNames()]`), ['What is this device?', []]);
  await P(`location.reload();`);
  await sleep(2500);
  await waitFor(`document.querySelector('.role-opt')`);
  check('after a reload: still the first question (nothing left behind)', await P(`return [!!$('.role-opt'), await dbNames()]`), [true, []]);

  // ── The shop tablet was never touched ──
  await size(1280, 800);
  await send('Page.navigate', { url: MAIN + '/#/inventory' });
  await waitFor(`document.querySelectorAll('.cathdr').length >= 11`, 30000);
  check('shop tablet afterwards: same items, nothing counted, no helper database', await P(`const it = await idbAll('frc2408-inventory', 'items'); return [it.length, it.filter((i) => i.lastCounted !== '').length, await dbNames()]`), [129, 0, ['frc2408-inventory']]);
} catch (e) {
  results.push('ERROR ' + e.message);
  await shot('error').catch(() => {});
} finally {
  console.log(results.join('\n'));
  console.log(problems.length ? 'Console problems:\n' + problems.join('\n') : 'No console errors or warnings');
  ws.close();
  proc.kill();
  preview.kill();
  preview2.kill();
  process.exit(0);
}

