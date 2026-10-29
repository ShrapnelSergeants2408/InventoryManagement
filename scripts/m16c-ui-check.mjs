// M16c real-browser check: a full kit → helper → counts → import round trip in two browser
// contexts at the same address (the shop tablet and a helper phone, each with its own storage),
// then the preview with a conflict, Apply, the summary, accepting the pending item, and Undo
// this import from the Backup screen (§18.5, stage6-plan M16c).
// Usage: npm run build && node scripts/m16c-ui-check.mjs <chrome.exe> <screenshot dir>
import { tempDir, track } from './tmp-cleanup.mjs';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PIN_H } from './pin-helpers.mjs';

const [chrome, outDir] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const files = tempDir('m16c-files-');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PORT = 4344;
const ORIGIN = `http://localhost:${PORT}`;
const preview = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
const port = 9363;
const proc = spawn(chrome, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${port}`, `--user-data-dir=${tempDir('cdp-')}`, 'about:blank'], { stdio: 'ignore' });
track(proc);

let version;
for (let i = 0; i < 50 && !version; i++) {
  await sleep(200);
  try { version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); } catch {}
}
const problems = [];
async function socket(url, tag, choosers) {
  const ws = new WebSocket(url);
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const pending = new Map();
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); return; }
    if (d.method === 'Page.fileChooserOpened') choosers?.push(d.params);
    if (d.method === 'Runtime.exceptionThrown') problems.push(`${tag} exception: ` + JSON.stringify(d.params.exceptionDetails).slice(0, 400));
    if (d.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(d.params.type)) problems.push(`${tag} console.${d.params.type}: ` + JSON.stringify(d.params.args).slice(0, 400));
  };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  return { ws, send };
}
const browser = await socket(version.webSocketDebuggerUrl, 'browser');

/** A page in its own browser context: its own IndexedDB and localStorage, like a separate device. */
async function device(tag, width, height, mobile) {
  const { result: ctx } = await browser.send('Target.createBrowserContext');
  const { result: t } = await browser.send('Target.createTarget', { url: 'about:blank', browserContextId: ctx.browserContextId });
  let info;
  for (let i = 0; i < 30 && !info; i++) {
    await sleep(150);
    info = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((x) => x.id === t.targetId);
  }
  const choosers = [];
  const s = await socket(info.webSocketDebuggerUrl, tag, choosers);
  for (const m of ['Runtime.enable', 'Page.enable', 'DOM.enable']) await s.send(m);
  await s.send('Page.setInterceptFileChooserDialog', { enabled: true });
  await s.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await s.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
  const js = async (expr) => {
    const r = await s.send('Runtime.evaluate', { expression: `(async () => { ${PAGE} ${expr} })()`, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(`${tag}: ` + JSON.stringify(r.result.exceptionDetails).slice(0, 500));
    return r.result?.result?.value;
  };
  const waitFor = async (cond, ms = 30000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { try { if (await js(`return !!(${cond})`)) return; } catch {} await sleep(150); }
    throw new Error(`${tag}: timeout waiting for ${cond}`);
  };
  const shot = async (name) => {
    const r = await s.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(outDir, name + '.png'), Buffer.from(r.result.data, 'base64'));
  };
  const choose = async (sel, text, paths) => {
    const before = choosers.length;
    await s.send('Runtime.evaluate', { expression: `(() => { ${PAGE} byText(${JSON.stringify(sel)}, ${JSON.stringify(text)}).click(); })()`, userGesture: true });
    for (let i = 0; i < 50 && choosers.length === before; i++) await sleep(100);
    if (choosers.length === before) throw new Error(`${tag}: no file chooser for ${text}`);
    await s.send('DOM.setFileInputFiles', { files: paths, backendNodeId: choosers.at(-1).backendNodeId });
    await sleep(900);
  };
  const size = (w, h) => s.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile });
  return { ...s, js, waitFor, shot, choose, size };
}

const PAGE = `
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const norm = (s) => s.replace(/\\s+/g, ' ').trim();
  const byText = (sel, t) => $$(sel).find((b) => norm(b.textContent).includes(t));
  const settle = (ms = 350) => new Promise((r) => setTimeout(r, ms));
  const click = async (sel, t) => { const b = byText(sel, t); if (!b) throw new Error('nothing like ' + sel + ' with text ' + t); b.click(); await settle(); return b; };
  const type = async (sel, v) => { const el = $(sel); if (!el) throw new Error('no field ' + sel); el.focus(); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); await settle(250); };
  const pick = async (sel, v) => { const el = $(sel); el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); await settle(250); };
  const go = async (h) => { location.hash = h; await settle(800); };
  const toast = () => norm($('.toast span')?.textContent ?? '');
  const keys = async (digits) => { for (const d of digits) { $$('.pad button').find((b) => b.getAttribute('aria-label') === d).click(); await settle(60); } };
  const idbAll = (name, store) => new Promise((res, rej) => {
    const r = indexedDB.open(name);
    r.onsuccess = () => { const db = r.result; const q = db.transaction(store).objectStore(store).getAll(); q.onsuccess = () => { res(q.result); db.close(); }; q.onerror = () => rej(q.error); };
    r.onerror = () => rej(r.error);
  });
  const item = async (id) => (await idbAll('frc2408-inventory', 'items')).find((i) => i.id === id);
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
  const shared = async () => { for (let i = 0; i < 100 && !window.__shared; i++) await settle(100); return window.__shared; };
  const small = () => $$('.main button, .main a.btn, .main input:not(.vh), .main select').filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (r.height < 47.5 || r.width < 47.5); }).map((e) => norm(e.textContent || e.getAttribute('aria-label') || e.tagName) + ' ' + Math.round(e.getBoundingClientRect().height));
  const tiles = (sel) => $$(sel + ' .tile').map((t) => [norm(t.querySelector('.k').textContent), norm(t.querySelector('.v').textContent)]);
  ${PIN_H}
`;

const results = [];
const check = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${JSON.stringify(actual)}${ok ? '' : ` (expected ${JSON.stringify(expected)})`}`);
};
const save = (s, name) => {
  const path = join(files, name || s.name);
  writeFileSync(path, Buffer.from(s.b64, 'base64'));
  return path;
};

let A, B;
try {
  // ── Shop tablet: set up, a helper, its kit ──
  A = await device('main', 1280, 800, false);
  await A.send('Page.navigate', { url: ORIGIN + '/' });
  await A.waitFor(`document.querySelector('.setup')`, 60000);
  await A.js(`await doSetup();`);
  await A.waitFor(`document.querySelectorAll('.cathdr').length >= 11`, 60000);
  await A.js(`await go('#/count/helpers'); await click('.top .btn', 'Add helper'); await type('#hname', 'Maya’s phone'); $$('.hgroup').find((x) => norm(x.querySelector('strong').textContent) === 'Electrical').click(); await settle(150); await click('.dlg .btn', 'Add helper'); await settle(500);`);
  await A.js(`catchShare(); $$('.hcard').find((c) => norm(c.querySelector('.h2').textContent) === 'Maya’s phone').querySelector('.btn.pri').click(); await settle(600); $('.dlg .tog').click(); await settle(150); await click('.dlg .btn', 'Send count kit');`);
  const kitPath = save(await A.js(`return await shared()`));
  // After the kit: the first Electrical item is counted here too (9), so the helper's count of it is a conflict.
  await A.js(`await go('#/count'); await settle(400); $$('.cg-row .btn')[0].click(); await settle(800);`);
  const first = await A.js(`return norm($('.wname').textContent)`);
  await A.js(`await keys('9'); await click('.wsave', 'Save & next'); await settle(400); await click('.top .btn', 'Pause');`);
  check('count-in start (shop tablet): Helper devices and Import counts; no pending yet', await A.js(`return [$$('.chelp-acts .btn').map((b) => norm(b.textContent))]`), [['Helper devices', 'Import counts']]);

  // ── Helper phone, its own context at the same address ──
  B = await device('helper', 360, 780, true);
  await B.send('Page.navigate', { url: ORIGIN + '/' });
  await B.waitFor(`document.querySelector('.role-opt')`, 60000);
  await B.js(`await click('.role-opt', 'Join as a helper');`);
  await B.choose('.kitpick .btn', 'Choose the count kit', [kitPath]);
  await B.waitFor(`document.querySelector('.sfile strong')`);
  await B.js(`await click('.setup-acts .btn', 'Start counting'); await settle(1200);`);
  await B.waitFor(`document.querySelector('.hbar')`);
  check('two devices at one address: the helper has only its own database', await B.js(`return (await indexedDB.databases()).map((d) => d.name)`), ['frc2408-helper']);
  await B.js(`await click('.cg-row .btn', 'Start');`);
  check('the helper walks the same first item', await B.js(`return norm($('.wname').textContent)`), first);
  await B.js(`await keys('4'); await click('.wsave', 'Save & next'); await settle(400);`);
  const second = await B.js(`return norm($('.wname').textContent)`);
  await B.js(`await click('.wloc .fchip', 'New location'); await type('[aria-label="New location name"]', 'Bin Z'); await click('.wloc-add .btn', 'Add'); await settle(300); await keys('12'); await click('.wsave', 'Save & next'); await settle(400); await click('.top .btn', 'Pause');`);
  await B.js(`await go('#/add'); await type('#pn', 'Talon SRX, old model'); $('[aria-label="On hand plus one"]').click(); await settle(100); $('[aria-label="On hand plus one"]').click(); await settle(100); await pick('#pl', 'Bin Z'); await type('#pb', '777000222'); await type('#pno', 'red bin, top\\nleft side'); await click('.hadd-acts .btn', 'Save as pending'); await settle(800);`);
  await B.js(`await go('#/send'); catchShare(); await click('.hsend-go .btn', 'Send my counts');`);
  const c1 = save(await B.js(`return await shared()`), 'counts-1.zip');
  // A third count, then the cumulative second file.
  await B.js(`await go('#/count'); await settle(400); await click('.cg-row .btn', 'Continue'); await settle(500);`);
  const third = await B.js(`return norm($('.wname').textContent)`);
  await B.js(`await keys('5'); await click('.wsave', 'Save & next'); await settle(400); await click('.top .btn', 'Pause'); await go('#/send'); catchShare(); await click('.hsend-go .btn', 'Send my counts');`);
  const c2 = save(await B.js(`return await shared()`), 'counts-2.zip');
  check('the helper sent two cumulative files', [c1.endsWith('counts-1.zip'), c2.endsWith('counts-2.zip')], [true, true]);

  // ── Shop tablet: Import counts ──
  const ids = await A.js(`const it = await idbAll('frc2408-inventory', 'items'); const by = (n) => it.find((i) => i.name === n).id; return [by(${JSON.stringify(first)}), by(${JSON.stringify(second)}), by(${JSON.stringify(third)})]`);
  const before = await A.js(`return await Promise.all(${JSON.stringify(ids)}.map(item))`);
  await A.js(`await go('#/count'); await click('.chelp-acts .btn', 'Import counts');`);
  check('Import counts: own screen, no PIN', await A.js(`return [location.hash, norm($('.top h1').textContent), norm($('.top .chip.ok').textContent), $$('.pinmark').length]`), ['#/count/import', 'Import counts', 'No PIN needed', 0]);
  await A.choose('.imp-start .btn', 'Choose counts files', [kitPath]);
  await A.waitFor(`document.querySelector('.sfile[role=alert]')`);
  check('a count kit is refused, pointing to Join as a helper; nothing saved', await A.js(`return [/count kit for a helper device.*Join as a helper/.test(norm($('.sfile[role=alert]').textContent)), !!$('.imp-grid')]`), [true, false]);
  await A.shot('01-refused-kit');
  await A.choose('.imp-start .btn', 'Choose counts files', [c2, c1]);
  await A.waitFor(`document.querySelector('.imp-grid')`);
  check('preview: two files, nothing saved yet', await A.js(`return [norm($('.top .small').textContent), $$('.imp-file .mono').length, (await item(${JSON.stringify(ids[0])})).onHand]`), ['Nothing has been saved yet', 2, 9]);
  check('preview tiles: the second file’s repeats count as already applied', await A.js(`return tiles('.imp-tiles6')`), [['Will apply', '2'], ['Conflicts', '1 left'], ['Same number', '0'], ['Outside groups', '0'], ['Already applied', '2'], ['Unknown items', '0']]);
  check('the conflict: both numbers, who and when; Keep / Use helper’s / Add together', await A.js(`const c = $('.imp-conf'); return [norm(c.querySelector('.imp-conf-n').textContent), $$('.imp-opt').map((o) => [norm(o.querySelector('strong').textContent), norm(o.querySelector('.imp-opt-v').textContent)])]`), [first, [['Keep this tablet’s', '9'], ['Use helper’s', '4'], ['Add together', '13']]]);
  check('new location Bin Z listed with Add; a new item waits as pending; Apply off until the conflict is chosen', await A.js(`return [norm($('.imp-loc strong').textContent), $('.imp-loc select').value, norm($('.imp-pend').textContent).includes('1 new item from helpers'), byText('.imp-side .btn', 'Apply').disabled]`), ['Bin Z', '', true, true]);
  check('tablet preview: touch targets ≥ 48 px', await A.js(`return small()`), []);
  await A.shot('02-preview');
  await A.js(`await click('.imp-opt', 'Use helper’s'); await settle(300);`);
  check('chosen: Apply 3 counts, the order total estimate', await A.js(`return [norm(byText('.imp-side .btn', 'Apply').textContent), byText('.imp-side .btn', 'Apply').disabled, /^\\$[\\d,.]+ → \\$[\\d,.]+$/.test(norm($('.imp-money').textContent)), tiles('.imp-tiles6')[1]]`), ['Apply 3 counts', false, true, ['Conflicts', '1']]);
  await A.js(`await click('.imp-side .btn', 'Apply 3 counts'); await settle(1000);`);
  check('summary: applied, settled, skipped, outside, new items', await A.js(`return [norm($('.done-h .h1').textContent), tiles('.imp-tiles'), $$('.imp .wacts .btn').map((b) => norm(b.textContent))]`), ['Counts from Maya’s phone applied', [['Applied', '3'], ['Conflicts settled', '1'], ['Skipped', '2'], ['Outside groups', '0'], ['New items waiting', '1']], ['1Review new items', 'Back up now', 'Undo this import', 'Done']]);
  await A.shot('03-summary');
  const after = await A.js(`return await Promise.all(${JSON.stringify(ids)}.map(item))`);
  const STAMP = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d[+-]\d\d:\d\d$/;
  check('saved: the helper’s numbers, times and name; Bin Z on the second item and in the list', [after.map((i) => [i.onHand, STAMP.test(i.lastCounted), i.countedBy, i.location]), (await A.js(`return (await idbAll('frc2408-inventory', 'locations')).map((l) => l.name)`))], [[[4, true, 'Maya’s phone', ''], [12, true, 'Maya’s phone', 'Bin Z'], [5, true, 'Maya’s phone', '']], ['Bin Z']]);

  // ── Pending from helpers: accept ──
  await A.js(`await click('.imp .wacts .btn', 'Review new items');`);
  check('pending screen: the card, PENDING, details and three actions', await A.js(`const c = $('.pcard'); return [location.hash, norm(c.querySelector('.h2').textContent), norm(c.querySelector('.chip.pend').textContent), /^From Maya’s phone · counted .* · Electrical · each$/.test(norm(c.querySelector('.small.muted').textContent)), norm(c.querySelector('.pcard-notes').textContent), $$('.pcard-acts .btn').map((b) => norm(b.textContent))]`), ['#/count/pending', 'Talon SRX, old model', 'PENDING', true, '“red bin, top left side”', ['Accept…', 'Same as existing…', 'Discard']]);
  check('pending screen: touch targets ≥ 48 px', await A.js(`return small()`), []);
  await A.shot('04-pending');
  await A.js(`await click('.pcard-acts .btn', 'Accept'); await settle(900);`);
  check('Accept opens Add item filled in, no PIN', await A.js(`return [norm($('.top .small').textContent), $('#nm').value, $$('input').find((i) => i.value === '777000222') !== undefined, $$('textarea')[0]?.value]`), ['Accepting a pending item from Maya’s phone — anyone can accept', 'Talon SRX, old model', true, 'red bin, top\nleft side']);
  check('the helper gave no supplier: the form asks for one, as for any new item (F6)', await A.js(`return $('#v1-sup').value`), '');
  await A.js(`await pick('#v1-sup', 'other'); await click('.top .btn.pri', 'Add item'); await settle(1000);`);
  const accepted = await A.js(`const it = await idbAll('frc2408-inventory', 'items'); return it.find((i) => i.name === 'Talon SRX, old model')`);
  check('accepted: a real item (tm- id) with the helper’s count; the pending item is gone', [accepted?.id?.startsWith('tm-'), accepted?.onHand, accepted?.location, accepted?.countedBy, await A.js(`return [(await idbAll('frc2408-inventory', 'pendingItems')).length, toast()]`)], [true, 2, 'Bin Z', 'Maya’s phone', [0, 'Accepted “Talon SRX, old model” into the inventory.']]);

  // ── Undo this import, from the Backup screen ──
  await A.js(`await go('#/more/backup');`);
  check('Backup screen: Counts from helpers, Import counts and Undo this import', await A.js(`const c = $('[aria-labelledby=ic-h]'); return [c.querySelectorAll('.btn').length, [...c.querySelectorAll('.btn')].map((b) => norm(b.textContent))]`), [2, ['Import counts…', 'Undo this import']]);
  await A.js(`await click('[aria-labelledby=ic-h] .btn', 'Undo this import');`);
  check('Undo: a destructive confirmation saying what goes back', await A.js(`return [$('.dlg').getAttribute('role'), /3 items, 1 pending item, 1 new location/.test(norm($('.dlg .dlg-p').textContent)), byText('.dlg-actions .btn', 'Undo this import').classList.contains('danger')]`), ['alertdialog', true, true]);
  await A.shot('05-undo');
  await A.js(`await click('.dlg-actions .btn', 'Undo this import'); await settle(900);`);
  const undone = await A.js(`return await Promise.all(${JSON.stringify(ids)}.map(item))`);
  const pick5 = (i) => [i.onHand, i.lastCounted, i.countedBy, i.location, i.barcode];
  check('undone: every changed field back exactly', undone.map(pick5), before.map(pick5));
  check('Bin Z stays (the accepted item uses it); the accepted item stays; Undo is gone', await A.js(`return [(await idbAll('frc2408-inventory', 'locations')).map((l) => l.name), (await idbAll('frc2408-inventory', 'items')).some((i) => i.name === 'Talon SRX, old model'), !byText('[aria-labelledby=ic-h] .btn', 'Undo'), /Import undone: 3 items put back/.test(toast())]`), [['Bin Z'], true, true, true]);

  // ── Importing again after Undo: the pending item isn't brought back ──
  await A.js(`await go('#/count/import');`);
  await A.choose('.imp-start .btn', 'Choose counts files', [c2]);
  await A.waitFor(`document.querySelector('.imp-grid')`);
  check('re-import after Undo: counts again, the accepted item not pending again', await A.js(`return [tiles('.imp-tiles6').map((t) => t[1]), !!$('.imp-pend'), norm($('.imp-side').textContent).includes('1 new item already here or already dealt with')]`), [['2', '1 left', '0', '0', '0', '0'], false, true]);
  await A.size(800, 1280);
  await sleep(500);
  check('portrait preview: nothing wider than the screen', await A.js(`return document.documentElement.scrollWidth <= innerWidth`), true);
  await A.shot('06-portrait-preview');
} catch (e) {
  results.push('ERROR ' + e.message);
  await A?.shot('error-main').catch(() => {});
  await B?.shot('error-helper').catch(() => {});
} finally {
  console.log(results.join('\n'));
  process.exitCode = results.some((r) => /^(FAIL|ERROR)/.test(r)) ? 1 : 0;
  console.log(problems.length ? 'Console problems:\n' + problems.join('\n') : 'No console errors or warnings');
  browser.ws.close();
  proc.kill();
  preview.kill();
  process.exit(process.exitCode);
}
