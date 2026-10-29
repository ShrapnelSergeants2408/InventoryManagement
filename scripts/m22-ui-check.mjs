// M22 real-browser check (SPEC v0.16): spending by funding and the school-year budget, overdue
// deliveries (history, order page, setting) and the Inventory shop status strip, search by
// subcategory and barcode, and recently viewed items. Real IndexedDB, headless Chrome.
// Usage: npm run build && node scripts/m22-ui-check.mjs <chrome.exe> <screenshot dir>
import { tempDir, track } from './tmp-cleanup.mjs';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PIN_H } from './pin-helpers.mjs';

const [chrome, outDir] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const preview = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', '4361', '--strictPort'], { stdio: 'ignore' });
const port = 9391;
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

// ── Dates, worked out here (not with the app's code) from today on this machine ──
const p2 = (n) => String(n).padStart(2, '0');
const isoOf = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
const now = new Date();
const today = isoOf(now);
const daysAgo = (k) => isoOf(new Date(now.getFullYear(), now.getMonth(), now.getDate() - k));
const syStart = `${now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1}-08-01`;

const L = (over) => ({ itemId: '', description: 'Part', partNo: '', unit: 'each', category: '', packs: 1, packSize: 1, packPriceCents: 1000, received: 0, ...over });
const seeds = [
  // Open, 40 days: overdue at the default 14 days, not at 60.
  { id: 'po-OLD40D', supplier: 'REV', placedOn: daysAgo(40), funding: 'School budget', lines: [L({ packPriceCents: 1000 })] },
  { id: 'po-NEW03D', supplier: 'WCP', placedOn: daysAgo(3), funding: 'FIRST grant', lines: [L({ packPriceCents: 2500 })] },
  // Received: never overdue. Same funding with other capitals: one row, named as on the newest order.
  { id: 'po-RCV60D', supplier: 'REV', placedOn: daysAgo(60), funding: 'school budget', lines: [L({ packPriceCents: 700, received: 1 })] },
  { id: 'po-CANCEL', supplier: 'REV', placedOn: daysAgo(2), funding: 'Sponsor', cancelled: true, lines: [L({ packPriceCents: 99999 })] },
  // Recorded before v0.16: no funding field at all.
  { id: 'po-NOFUND', supplier: 'AndyMark', placedOn: daysAgo(1), lines: [L({ packPriceCents: 300 })] },
].map((o, i) => ({ orderNo: '', payment: '', cancelled: false, taxCents: 0, shippingCents: 0, feesCents: 0, discount: { kind: '$', value: 0 }, notes: '', fromList: 'Automatic', receipts: [], created: 1000 + i, updated: 1000 + i, ...o }));
const inSchoolYear = seeds.filter((o) => !o.cancelled && o.placedOn >= syStart);
const money = (c) => "$" + (c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const spentCents = inSchoolYear.reduce((n, o) => n + o.lines.reduce((m, l) => m + l.packs * l.packPriceCents, 0), 0);

try {
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await size(1280, 800);
  await send('Page.navigate', { url: 'http://localhost:4361/' });
  await waitFor(`document.querySelector('.setup')`, 60000);
  await js(`await doSetup();`);
  await waitFor(`document.querySelectorAll('.cathdr').length >= 11`, 60000);

  check('no orders or pending items: no shop status strip', await js(`return !!$('.shopst')`), false);

  await js(`for (const o of ${JSON.stringify(seeds)}) await idbPut('orders', { ...o, supplierKey: o.supplier.toLowerCase(), itemIds: [] }); location.reload();`);
  await sleep(1500);
  await waitFor(`document.querySelector('.shopst')`, 30000);
  check('strip: 3 orders on the way, 1 overdue at the default 14 days', await js(`return $$('.shopst .sschip').map((a) => [norm(a.textContent), a.getAttribute('href'), a.classList.contains('att')])`), [['3 orders on the way', '#/placed', false], ['1 overdue (over 14 days)', '#/placed', true]]);
  check('strip: links are ≥ 48 px', await js(`return targets($('.shopst'))`), []);
  await shot('01-inventory-strip');

  await js(`await click('.shopst a', 'overdue'); await settle(700);`);
  check('the overdue link opens the order history', await js(`return location.hash`), '#/placed');
  const chips = await js(`return $$('.po-row').map((r) => [r.getAttribute('href').split('/').pop(), [...r.querySelector('.po-st').children].map((c) => norm(c.textContent)).join(' ')])`);
  check('history rows: only the open order placed 40 days ago is overdue', chips, [
    ['po-NOFUND', 'Placed'],
    ['po-CANCEL', 'Cancelled'],
    ['po-NEW03D', 'Placed'],
    ['po-OLD40D', 'Placed Overdue · 40 days'],
    ['po-RCV60D', 'Received'],
  ].filter(([id]) => seeds.find((o) => o.id === id).placedOn >= syStart));
  await shot('02-history-overdue');

  await js(`await go('#/placed/po-OLD40D');`);
  check('order page: overdue chip and "From School budget funds"', await js(`return [norm($('.chip.att')?.textContent ?? ''), norm($('.po-head').textContent).includes('From School budget funds')]`), ['Overdue · 40 days', true]);

  await js(`await go('#/placed'); await click('[aria-label=Show] .segb', 'Spending summary'); await settle(300);`);
  check('no budget set: no budget card', await js(`return !!$('.hi-budget')`), false);
  const fundRows = await js(`return [...$('[aria-label="Spending by funding"]').querySelectorAll('tr')].map((r) => [...r.children].map((c) => norm(c.textContent)))`);
  check('by funding: A–Z, capitals ignored (named as on the newest order), Not recorded last, cancelled left out, Total', fundRows, [
    ['Paid from', 'Orders', 'Total'],
    ['FIRST grant', '1', '$25.00'],
    ['School budget', '2', '$17.00'],
    ['Not recorded', '1', '$3.00'],
    ['Total', '4', '$45.00'],
  ]);

  // ── Settings: overdue after 60 days and a budget (PIN) ──
  await js(`await go('#/more/settings'); await click('.lockbar button', 'Unlock'); await answerGate(true, true);`);
  check('settings: Delivery overdue after (default 14) and School-year budget (blank) fields', await js(`return [$('#set-overdueDays').value, $('#set-budget').value, $('#set-budget').disabled]`), ['14', '', false]);
  await js(`await type('#set-budget', '4o'); await click('.top .btn', 'Save'); await settle(300);`);
  check('a budget that isn’t an amount is refused beside the field', await js(`return norm($('.set-err')?.textContent ?? '')`), 'School-year budget: price "4o" is not a dollar amount');
  await js(`await type('#set-budget', '40'); await type('#set-overdueDays', '60'); await click('.top .btn', 'Save'); await settle(500);`);
  check('saved', await js(`const rows = await idb('settings'); const v = (k) => rows.find((r) => r.key === k)?.value; return [v('overdueDays'), v('budgetCents')]`), [60, 4000]);
  await shot('03-settings');

  await js(`await go('#/placed'); await click('[aria-label=Show] .segb', 'Spending summary'); await settle(300);`);
  const over = spentCents > 4000;
  check('budget card: budget, spent this school year (cancelled left out), over or left', await js(`return [...$('.hi-budget').querySelectorAll(':scope > div')].map((d) => [...d.children].map((c) => norm(c.textContent)).join(' '))`), [
    'School-year budget $40.00',
    `Spent ${money(spentCents)}`,
    `${over ? 'Over budget by' : 'Left'} ${money(Math.abs(4000 - spentCents))}`,
  ]);
  check('over budget uses the attention style', await js(`return $('.hi-budget').classList.contains('over')`), over);
  await js(`await click('[aria-label=Show] .segb', 'Orders'); await click('.seg button', 'Open'); await settle(300);`);
  check('overdue after 60 days: no overdue chip on the 40-day order', await js(`return $$('.po-row .chip.att').length`), 0);
  await js(`await click('[aria-label=Show] .segb', 'Spending summary'); await settle(300);`);
  await shot('04-summary-budget-funding');

  await js(CAPTURE + `await click('.top button', 'Export CSV'); for (let i = 0; i < 50 && !window.__files.length; i++) await settle(100);`);
  const csv = await js(`return new TextDecoder().decode(window.__files[0].bytes)`);
  check('Export CSV: a Paid from column and the funding summary', [csv.split('\r\n')[1].split(',').slice(3, 6), csv.includes('Spending by funding (cancelled orders left out)'), csv.includes('FIRST grant,1,25.00')], [['Payment', 'Paid from', 'Status'], true, true]);

  await js(`await go('#/inventory'); await settle(500);`);
  check('strip after the change: still 3 on the way, none overdue', await js(`return $$('.shopst .sschip').map((a) => norm(a.textContent))`), ['3 orders on the way']);

  // ── Order form: Paid from, with earlier names offered ──
  await js(`await go('#/order'); await settle(600); markBtn('REV').click(); await settle(400); if (pinDlg()) await answerGate(true, true); await waitDlg('Mark ordered: REV');`);
  check('order form: Paid from field, earlier names offered A–Z', await js(`const f = field('Paid from'); return [!!f, f.getAttribute('list'), [...document.getElementById(f.getAttribute('list')).options].map((o) => o.value)]`), [true, 'of-funding', ['FIRST grant', 'School budget', 'Sponsor']]);
  await js(`await type(field('Paid from'), 'FIRST grant'); await click('.dlg button', 'Record order'); await waitDlg('Update catalog prices?'); await click('.dlg button', 'Skip'); await settle(600);`);
  const recorded = await js(`return (await idb('orders')).filter((o) => !${JSON.stringify(seeds.map((o) => o.id))}.includes(o.id)).map((o) => o.funding)`);
  check('Record order saves the funding', recorded, ['FIRST grant']);

  // ── Search by subcategory and barcode; recently viewed ──
  await js(`await go('#/inventory'); await type('.searchwrap .field', 'bearings'); await settle(400);`);
  const bearings = await js(`return $$('.row .rname').map((n) => n.firstChild.textContent)`);
  check('search "bearings" finds items in the Bearings subcategory', bearings.length > 0 && (await js(`return $$('.subhdr .sn, .subhdr').some((h) => norm(h.textContent).startsWith('Bearings'))`)), true);
  await js(`await type('.searchwrap .field', '722787604386'); await settle(400);`);
  check('search by barcode finds the NEO 2.0', await js(`return $$('.row .rname').map((n) => n.firstChild.textContent)`), ['NEO 2.0 Brushless Motor (15T spline shaft)']);
  await js(`await type('.searchwrap .field', ''); $('.searchwrap .field').blur(); await go('#/item/st-0063'); await go('#/item/st-0001'); await go('#/item/st-0063'); await go('#/inventory');`);
  await js(`$('.searchwrap .field').focus(); await settle(400);`);
  check('focused, empty search box: recently viewed, newest first, each once', await js(`return $$('.recent .recent-i').map((a) => a.getAttribute('href'))`), ['#/item/st-0063', '#/item/st-0001']);
  check('recently viewed: rows ≥ 48 px', await js(`return targets($('.recent'))`), []);
  await shot('05-recently-viewed');
  await js(`await type('.searchwrap .field', 'n'); await settle(300);`);
  check('typing hides it', await js(`return !!$('.recent')`), false);
  await js(`await type('.searchwrap .field', ''); await settle(300); const a = $$('.recent .recent-i')[1]; a.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true })); a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); await settle(700);`); // the export step replaced HTMLAnchorElement.click
  check('tapping one opens that item', await js(`return location.hash`), '#/item/st-0001');

  // ── Portrait ──
  await js(`await go('#/inventory');`);
  await size(800, 1280);
  await sleep(500);
  await shot('06-inventory-portrait');
  check('portrait: nothing wider than the screen; strip targets ≥ 48 px', await js(`return [document.documentElement.scrollWidth <= innerWidth, targets($('.shopst'))]`), [true, []]);
  await js(`await go('#/placed'); await click('[aria-label=Show] .segb', 'Spending summary'); await settle(400);`);
  await shot('07-summary-portrait');
  check('portrait summary: nothing wider than the screen; text ≥ 15 px', await js(`return [document.documentElement.scrollWidth <= innerWidth, smallText($('.main'))]`), [true, []]);
  await size(1280, 800);
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
