// M23 real-browser check (cleanup): the PIN pad's answer (cancel, wrong PIN, right PIN) for a
// delete and a settings save (M6 review, finding 7); the delete confirmation's text with a list
// and units on order (M19 review, finding 8); a restore of a hand-edited ZIP with a Windows-1252
// inventory.csv and a javascript: link (M5 review, findings 3 and 4); the reminder with a backup
// dated in the future (finding 6); Import counts' top bar.
// Usage: npm run build && node scripts/m23-ui-check.mjs <chrome.exe> <screenshot dir>
import { tempDir, track } from './tmp-cleanup.mjs';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import JSZip from 'jszip';
import { PIN_H } from './pin-helpers.mjs';

const [chrome, outDir] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const preview = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', '4363', '--strictPort'], { stdio: 'ignore' });
const port = 9393;
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
  const type = async (el, v) => { if (typeof el === 'string') el = $(el); if (!el) throw new Error('no field'); el.focus(); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); await settle(120); };
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
  const go = async (h) => { location.hash = h; await settle(700); };
`;

const EDIT = `
  const idbTx = (store, fn) => new Promise((res, rej) => {
    const r = indexedDB.open('frc2408-inventory');
    r.onsuccess = () => {
      const db = r.result;
      const t = db.transaction(store, 'readwrite');
      Promise.resolve(fn(t.objectStore(store)));
      t.oncomplete = () => { db.close(); res(); };
      t.onerror = () => rej(t.error);
    };
  });
  const idbPut = (store, value) => idbTx(store, (s) => void s.put(value));
  const choose = async (input, name, data, type) => {
    const dt = new DataTransfer();
    dt.items.add(new File([data], name, { type }));
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await settle(300);
  };
  const waitDlg = async (label, ms = 30000) => { const end = Date.now() + ms; while (Date.now() < end) { const d = dlg(label); if (d) return d; await settle(100); } throw new Error('no dialog ' + label); };
  const waitGone = async (label, ms = 30000) => { const end = Date.now() + ms; while (Date.now() < end && dlg(label)) await settle(100); };
  const toast = () => norm(document.querySelector('.toast span')?.textContent ?? '');
  const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const group = (name) => $$('.shdr').find((s) => norm(s.querySelector('.oname')?.textContent ?? '') === name);
  const markBtn = (name) => [...group(name).querySelectorAll('button')].find((b) => norm(b.textContent).startsWith('Mark ordered'));
  const formRows = () => $$('.of-row:not(.of-h)');
  const rowInput = (row, label) => row.querySelector('input[aria-label^="' + label + '"]');
  const field = (label) => [...document.querySelectorAll('.of-fields label')].find((l) => norm(l.querySelector('.lbl')?.textContent ?? '').startsWith(label))?.querySelector('input,textarea');
  const cents = (s) => Math.round(Number(s) * 100);
  const money = (c) => '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const targets = (root) => [...root.querySelectorAll('button, a, input:not([type=file]):not([type=checkbox]), select, textarea, label.btn')].filter((e) => { if (e.classList.contains('vh')) return false; const r = e.getBoundingClientRect(); return r.width > 0 && (r.height < 47.5 || r.width < 47.5); }).map((e) => (e.getAttribute('aria-label') || norm(e.textContent)).slice(0, 40) + ' ' + Math.round(e.getBoundingClientRect().height));
  const smallText = (root) => { const bad = new Set(); for (const e of root.querySelectorAll('*')) { if (![...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue; const fs = parseFloat(getComputedStyle(e).fontSize); if (fs < 15 && e.getBoundingClientRect().width > 0) bad.add(e.className + ' ' + fs); } return [...bad]; };
`;
const CAPTURE = `
  window.__files = [];
  HTMLAnchorElement.prototype.click = function () { if (this.download) fetch(this.href).then((r) => r.arrayBuffer()).then((b) => window.__files.push({ name: this.download, bytes: new Uint8Array(b) })); };
`;

const NEO = 'st-0063';
const order = {
  id: 'po-NEO001', supplier: 'REV', placedOn: '2026-10-20', orderNo: '', payment: '', funding: '', cancelled: false, taxCents: 0, shippingCents: 0, feesCents: 0,
  discount: { kind: '$', value: 0 }, notes: '', fromList: 'Automatic', receipts: [], created: 1, updated: 1,
  lines: [{ itemId: NEO, description: 'NEO', partNo: '', unit: 'each', category: 'Electrical', packs: 2, packSize: 1, packPriceCents: 5500, received: 0 }],
};
const list = { id: 'ol-NEO001', name: 'Swerve spares', notes: '', created: 1, updated: 1, lines: [{ itemId: NEO, quantity: 2 }] };
const enc = (s) => [...Buffer.from(s, 'latin1')];

try {
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await size(1280, 800);
  await send('Page.navigate', { url: 'http://localhost:4363/' });
  await waitFor(`document.querySelector('.setup')`, 60000);
  await js(`await doSetup();`);
  await waitFor(`document.querySelectorAll('.cathdr').length >= 11`, 60000);
  await js(`await idbPut('orders', { ...${JSON.stringify(order)}, supplierKey: 'rev', itemIds: [${JSON.stringify(NEO)}] }); await idbPut('orderLists', { ...${JSON.stringify(list)}, key: 'swerve spares', itemIds: [${JSON.stringify(NEO)}] }); location.reload();`);
  await sleep(1500);
  await waitFor(`document.querySelectorAll('.cathdr').length >= 11`, 30000);
  const items0 = await js(`return (await idb('items')).length`);

  // ── The PIN pad's answer, not only that it appears (M6 review, finding 7) ──
  const pinDel = () => js(`await go('#/item/${NEO}'); if ($('.lockpill.on')) { $('.lockpill.on').click(); await settle(200); } await click('.dacts button', 'Delete item'); for (let i = 0; i < 30 && !pinDlg(); i++) await settle(100);`);
  await pinDel();
  check('Delete item: the PIN pad says why', await js(`return [!!pinDlg(), norm(pinDlg().textContent).includes('PIN')]`), [true, true]);
  await js(`byText('[aria-label="Mentor PIN"] button', 'Cancel').click(); await settle(400);`);
  check('PIN cancelled: no delete confirmation, item kept, still locked', await js(`return [!!dlg('Delete item'), !!(await idb('items', ${JSON.stringify(NEO)})), !!$('.lockpill.on')]`), [false, true, false]);
  await pinDel();
  await js(`await enterPin('1111');`);
  check('wrong PIN: the pad stays with the message; no confirmation; still locked', await js(`return [!!pinDlg(), norm($('.pin-err').textContent), !!dlg('Delete item'), !!$('.lockpill.on')]`), [true, 'Wrong PIN. Try again — 1 wrong try so far.', false, false]);
  await js(`byText('[aria-label="Mentor PIN"] button', 'Cancel').click(); await settle(400);`);
  check('…cancelled after a wrong PIN: the item is still there', await js(`return !!(await idb('items', ${JSON.stringify(NEO)}))`), true);

  // ── The delete confirmation's text (M19 review, finding 8) ──
  await pinDel();
  await js(`await enterPin('2408'); for (let i = 0; i < 30 && !dlg('Delete item'); i++) await settle(100);`);
  const delText = await js(`return [...dlg('Delete item').querySelectorAll('.del-name, .dlg-big, .dlg-p')].map((e) => norm(e.textContent))`);
  check('right PIN: unlocked, and the confirmation names the item, its on hand, its list and what is on order', [await js(`return !!$('.lockpill.on')`), delText], [true, [
    'NEO 2.0 Brushless Motor (15T spline shaft)',
    'On hand: 0 each',
    'It disappears from the list, the order list and QR label scans. The only way back is restoring a backup made before now.',
    'It’s also on 1 named order list (Swerve spares) and will be taken off it.',
    '2 each are on order (1 open order). The orders keep their record; when the parts arrive, receiving marks them received without adding them anywhere.',
  ]]);
  await shot('01-delete-confirm');
  await js(`await click('[aria-label="Delete item"] button', 'Keep item');`);
  check('Keep item: nothing deleted', await js(`return [(await idb('items')).length, !!(await idb('items', ${JSON.stringify(NEO)}))]`), [items0, true]);
  await js(`await click('.dacts button', 'Delete item'); for (let i = 0; i < 30 && !dlg('Delete item'); i++) await settle(100); await click('[aria-label="Delete item"] button.danger', 'Delete item'); await settle(800);`);
  check('Delete item: gone from the items and the list; the order keeps its line', await js(`return [(await idb('items')).length, !!(await idb('items', ${JSON.stringify(NEO)})), (await idb('orderLists', 'ol-NEO001')).lines.length, (await idb('orders', 'po-NEO001')).lines.length, location.hash]`), [items0 - 1, false, 0, 1, '#/inventory']);

  // Settings save: wrong PIN saves nothing; right PIN saves.
  await js(`$('.lockpill.on')?.click(); await settle(200); await go('#/more/settings'); await click('.lockbar button', 'Unlock'); await enterPin('2408'); await type('#set-reminderDays', '9'); $('.lockpill.on').click(); await settle(300); await click('.top .btn', 'Save'); for (let i = 0; i < 30 && !pinDlg(); i++) await settle(100); await enterPin('9999');`);
  check('settings: relocked, Save asks again; a wrong PIN saves nothing', await js(`return [!!pinDlg(), (await idb('settings', 'reminderDays'))?.value ?? 7]`), [true, 7]);
  await js(`await enterPin('2408'); await settle(500);`);
  check('…the right PIN saves', await js(`return (await idb('settings', 'reminderDays')).value`), 9);

  // ── Restore: links and a Windows-1252 file inside a ZIP (M5 review, findings 3 and 4) ──
  await js(`await go('#/more/backup');`);
  const csv = 'id,name,category,unit,on_hand,desired,v1_supplier,v1_pack_size,v1_url\r\nr1,Bolt ' + '×' + ' 2,Fasteners,each,1,1,REV,1,javascript:alert(1)\r\nr2,Nut,Fasteners,each,1,1,REV,1,www.revrobotics.com/nut\r\n';
  const z = new JSZip();
  z.file('inventory.csv', Buffer.from(enc(csv)));
  const zipB64 = Buffer.from(await z.generateAsync({ type: 'uint8array' })).toString('base64');
  await js(`await choose($$('input[type=file]')[0], 'hand-edited.zip', Uint8Array.from(atob(${JSON.stringify(zipB64)}), (c) => c.charCodeAt(0)), 'application/zip'); await waitDlg('Replace all inventory with this backup?');`);
  const notes = await js(`return $$('.notes-list li').map((e) => norm(e.textContent))`);
  check('restore preview: the Windows file and the cleared link are named', [notes.some((n) => n.startsWith('inventory.csv isn’t UTF-8')), notes.includes("Links that aren't web addresses were left blank: r1 option 1 (javascript:alert(1))")], [true, true]);
  await shot('02-restore-notes');
  await js(`$('.tick input').click(); await settle(200); await click('.dlg button', 'Replace everything'); for (let i = 0; i < 30 && pinDlg(); i++) await settle(100); if (pinDlg()) await enterPin('2408'); await settle(1500);`);
  check('restored: the name read as Windows-1252, the bad link blank, the bare address made https', await js(`return [(await idb('items', 'r1')).name, (await idb('items', 'r1')).vendors[0].url, (await idb('items', 'r2')).vendors[0].url]`), ['Bolt × 2', '', 'https://www.revrobotics.com/nut']);

  // ── A backup dated in the future (M5 review, finding 6) ──
  await js(`await idbPut('settings', { key: 'lastBackupAt', value: Date.now() + 200 * 86400000 }); location.hash = '#/inventory'; location.reload();`);
  await sleep(1500);
  await waitFor(`document.querySelector('.cathdr')`, 30000);
  check('Inventory: the reminder shows, and says the clock was changed', await js(`return [norm($('.banner .grow')?.textContent ?? ''), [...$('.banner').querySelectorAll('.btn')].map((b) => norm(b.textContent))]`), ['The last backup is dated later than this tablet’s clock, so the clock was changed since. A backup is the only way back if this tablet is lost, reset or broken.', ['Back up now', 'Later']]);
  await shot('03-future-backup');

  // ── Import counts: "No PIN needed" sits before the lock (M21 rule) ──
  await js(`await go('#/count/import');`);
  check('Import counts top bar: … No PIN needed, then the lock last', await js(`const kids = [...$('.top').children]; return [kids.at(-1).classList.contains('lockpill'), kids.findIndex((e) => e.classList.contains('chip')) < kids.findIndex((e) => e.classList.contains('lockpill'))]`), [true, true]);
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
