// M18 real-browser check: the Stage 5 leftovers (SPEC v0.13): the cleared-storage line on the
// first setup step, the Downloads-only toast, the storage status updating on a grant, a ZIP
// with a missing photo (attention row, tablet's photo kept) and a full backup with no items.
// Usage: npm run build && node scripts/m18-ui-check.mjs <chrome.exe> <screenshot dir>
import { tempDir, track } from './tmp-cleanup.mjs';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import JSZip from 'jszip';
import { PIN_H, TEST_PIN } from './pin-helpers.mjs';

const [chrome, outDir] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const preview = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', '4351', '--strictPort'], { stdio: 'ignore' });
const port = 9381;
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
  const r = await send('Runtime.evaluate', { expression: `(async () => { ${H} ${EDIT} ${expr} })()`, awaitPromise: true, returnByValue: true });
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
const size = (width, height) => send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
const results = [];
const check = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${JSON.stringify(actual)}${ok ? '' : ` (expected ${JSON.stringify(expected)})`}`);
};

const H = `
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const settle = (ms = 350) => new Promise((r) => setTimeout(r, ms));
  const norm = (s) => s.replace(/\\s+/g, ' ').trim();
  const byText = (sel, t) => $$(sel).find((b) => norm(b.textContent).includes(t));
  const click = async (sel, t) => { const b = byText(sel, t); if (!b) throw new Error('nothing like ' + sel + ' with text ' + t); b.click(); await settle(); return b; };
${PIN_H}
  const dlg = (label) => $('[role=dialog][aria-label="' + label + '"], [role=alertdialog][aria-label="' + label + '"]');
  const idb = (store, key) => new Promise((res, rej) => {
    const r = indexedDB.open('frc2408-inventory');
    r.onsuccess = () => {
      const db = r.result;
      const s = db.transaction(store).objectStore(store);
      const q = key === undefined ? s.getAll() : s.get(key);
      q.onsuccess = () => { res(q.result); db.close(); };
      q.onerror = () => rej(q.error);
    };
    r.onerror = () => rej(r.error);
  });
  const go = async (h) => { location.hash = h; await settle(600); };
`;

const EDIT = `
  const idbCount = (store) => new Promise((res) => { const r = indexedDB.open('frc2408-inventory'); r.onsuccess = () => { const db = r.result; const q = db.transaction(store).objectStore(store).count(); q.onsuccess = () => { res(q.result); db.close(); }; }; });
  const choose = async (index, name, data, type) => {
    const input = document.querySelectorAll('input[type=file]')[index];
    const dt = new DataTransfer();
    dt.items.add(new File([data], name, { type }));
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await settle(300);
  };
  const waitDlg = async (label, ms = 30000) => { const end = Date.now() + ms; while (Date.now() < end) { const d = dlg(label); if (d) return d; await settle(100); } throw new Error('no dialog ' + label); };
  const waitGone = async (sel, ms = 30000) => { const end = Date.now() + ms; while (Date.now() < end && document.querySelector(sel)) await settle(100); };
  const toast = () => norm(document.querySelector('.toast span')?.textContent ?? '');
  const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const cmpRows = () => [...document.querySelectorAll('.cmp tbody tr')].map((r) => [...r.cells].map((c) => norm(c.textContent)));
  const cmpAttn = () => [...document.querySelectorAll('.cmp tbody tr')].filter((r) => r.querySelector('td.attn')).map((r) => norm(r.cells[0].textContent));
  const storeNote = () => norm(document.querySelector('.bk-store')?.textContent ?? '');
`;
const CAPTURE = `
  window.__files = [];
  HTMLAnchorElement.prototype.click = function () { if (this.download) fetch(this.href).then((r) => r.arrayBuffer()).then((b) => window.__files.push({ name: this.download, bytes: new Uint8Array(b) })); };
`;
const restoreZip = async (name, bytes) => {
  await js(`await choose(0, ${JSON.stringify(name)}, unb64(${JSON.stringify(Buffer.from(bytes).toString('base64'))}), 'application/zip'); await waitDlg('Replace all inventory with this backup?');`);
  await sleep(300);
};
const replaceEverything = () => js(`document.querySelector('.tick input').click(); await settle(150); await click('.dlg button', 'Replace everything'); await answerGate(true); await waitGone('.dlg'); await settle(800);`);

try {
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await size(1280, 800);
  await send('Page.navigate', { url: 'http://localhost:4351/' });
  await waitFor(`document.querySelector('.setup')`, 60000);

  // ── Finding 3: the first setup step says what to do after cleared storage ──
  await js(`await pickShopTablet(); for (let i = 0; i < 100 && !$('.setup-pin'); i++) await settle(100);`);
  check('setup step 1: cleared-storage line pointing to Restore', await js(`return norm($('.setup-cleared')?.textContent ?? '')`), 'If this tablet had inventory before, its storage was cleared. Set a PIN, then choose Restore a backup file.');
  await shot('01-setup-cleared-line');
  check('setup step 3 still offers Restore from a backup file', await js(`await enterPin('${TEST_PIN}'); await enterPin('${TEST_PIN}'); $('.recovery input[type=checkbox]').click(); await settle(150); byText('.recovery button', 'Next').click(); for (let i = 0; i < 100 && !$('.sopts'); i++) await settle(100); return norm($('.sopts').textContent).includes('Restore')`), true);
  await js(`await finishStart();`);
  await waitFor(`document.querySelectorAll('.cathdr').length >= 11`, 60000);

  // ── Finding 9: the storage note updates when Chrome grants persistence ──
  await js(`window.__granted = false;
            Object.defineProperty(navigator.storage, 'persisted', { configurable: true, value: async () => window.__granted });
            Object.defineProperty(navigator.storage, 'persist', { configurable: true, value: async () => (window.__granted = true) });
            await go('#/more/backup');`);
  await waitFor(`document.querySelector('.bk-store')`);
  await sleep(400);
  check('Backup: not granted at first', await js(`return storeNote().startsWith('Persistent storage not granted.')`), true);
  await js(`window.dispatchEvent(new Event('appinstalled')); await settle(600);`);
  check('after a grant (asked again on install): granted, without reopening the screen', [await js(`return storeNote().startsWith('Persistent storage granted.')`), await js(`return location.hash`)], [true, '#/more/backup']);

  // ── Finding 7: a backup saved only to Downloads says so ──
  await js(CAPTURE + `document.querySelectorAll('.bkopt')[0].click(); for (let i = 0; i < 150 && !window.__files.length; i++) await settle(100); await settle(400);`);
  const full = await js(`const f = window.__files[0]; return f && { name: f.name, b64: b64(f.bytes) }`);
  check('Downloads toast: on this tablet only, send it elsewhere', await js(`return [toast().startsWith('Saved inventory-backup-'), toast().includes('to Downloads on this tablet only'), toast().includes('lost with the tablet')]`), [true, true, true]);
  check('the reminder clock still resets (F16)', await js(`return Date.now() - (await idb('settings', 'lastBackupAt')).value < 60000`), true);
  await shot('02-downloads-toast');

  // ── Finding 5: a ZIP missing one named photo ──
  const zip = await JSZip.loadAsync(Buffer.from(full.b64, 'base64'));
  const photoNames = Object.keys(zip.files).filter((n) => n.startsWith('photos/') && !zip.files[n].dir);
  const gone = photoNames[0];
  const goneId = gone.slice('photos/'.length).replace(/\.\w+$/, '');
  zip.remove(gone);
  const missingZip = await zip.generateAsync({ type: 'uint8array' });
  const tabletPhoto = await js(`return (await idb('photos', ${JSON.stringify(goneId)})).full.size`);
  await restoreZip('inventory-backup-2026-10-28-1700.zip', missingZip);
  check('Photos row: n, 1 missing (1 kept from this tablet), in the attention style', await js(`const r = cmpRows().find((x) => x[0] === 'Photos'); return [r[2], cmpAttn()]`), [`${photoNames.length - 1}, 1 missing (1 kept from this tablet)`, ['Photos']]);
  check('attention note under the table', await js(`return norm($('.dlg .bk-store.warn').textContent)`), '1 photo named in the backup is missing from the ZIP. This tablet keeps its own photo for that item.');
  await shot('03-restore-missing-photo');
  await replaceEverything();
  check('after the restore: every photo still there, the missing one is the tablet’s own', await js(`const p = await idb('photos', ${JSON.stringify(goneId)}); return [await idbCount('photos'), p?.full.size, (await idb('items', ${JSON.stringify(goneId)})).hasPhoto]`), [photoNames.length, tabletPhoto, true]);
  check('toast counts the kept photo', await js(`return toast()`), `Restored 129 items and ${photoNames.length} photos from inventory-backup-2026-10-28-1700.zip.`);

  // ── Finding 4: a full backup with no items but with its lists ──
  const empty = new JSZip();
  empty.file('inventory.csv', 'id,name,category,subcategory,location,unit,on_hand,desired,spares,barcode,notes,source,preferred_vendor,photo_file\r\n');
  empty.file('suppliers.csv', 'name,website,notes\r\nREV,,\r\nother,,\r\n');
  empty.file('locations.csv', 'name,notes,order\r\nShelf C1,,0\r\n');
  empty.file('categories.csv', 'category,subcategory,order\r\nElectrical,,0\r\nElectrical,Motors,0\r\n');
  await restoreZip('inventory-backup-2026-10-28-1710.zip', await empty.generateAsync({ type: 'uint8array' }));
  check('empty backup: dialog opens, Items row 0 in the attention style', await js(`return [cmpRows().find((x) => x[0] === 'Items')[2], cmpAttn()]`), ['0', ['Items']]);
  check('empty backup: says the inventory will be empty', await js(`return norm($('.dlg .bk-store.warn').textContent)`), 'This backup has no items. Restoring it leaves the inventory empty; only its lists come back.');
  await shot('04-restore-empty-backup');
  await replaceEverything();
  check('restored: no items, its lists', await js(`return [await idbCount('items'), await idbCount('photos'), (await idb('locations')).map((l) => l.name), (await idb('categories')).map((c) => c.name)]`), [0, 0, ['Shelf C1'], ['Electrical']]);

  // ── A CSV with no items is still refused ──
  await js(`await choose(0, 'x.csv', new TextEncoder().encode('id,name,category,unit,on_hand,desired\\n'), 'text/csv'); await waitDlg('Can’t restore this file — nothing was changed');`);
  check('empty CSV still refused', await js(`return norm($('.problems li').textContent)`), 'the backup has no items, so restoring it would empty the tablet');
  await js(`await click('.dlg button', 'OK');`);
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
