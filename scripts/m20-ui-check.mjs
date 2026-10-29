// M20 real-browser check: the order history (F32, §21.5): ranges on boundary dates, the
// filters, both summaries, both CSV exports, Print summary, and the season start and school
// year start settings (PIN), with real IndexedDB.
// Usage: npm run build && node scripts/m20-ui-check.mjs <chrome.exe> <screenshot dir>
import { tempDir, track } from './tmp-cleanup.mjs';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PIN_H } from './pin-helpers.mjs';

const [chrome, outDir] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const preview = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', '4353', '--strictPort'], { stdio: 'ignore' });
const port = 9383;
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
const first = isoOf(new Date(now.getFullYear(), now.getMonth(), 1));
const lastOfPrev = isoOf(new Date(now.getFullYear(), now.getMonth(), 0));
const syYear = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
const syStart = `${syYear}-08-01`;
const sySep = `${now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1}-09-01`;
const lastSyStart = `${syYear - 1}-08-01`;
const dayBefore = (iso) => { const [y, m, d] = iso.split('-').map(Number); return isoOf(new Date(y, m - 1, d - 1)); };

// Orders on the boundaries of each range. Money is whole cents.
const L = (over) => ({ itemId: '', description: 'Part', partNo: '', unit: 'each', category: '', packs: 1, packSize: 1, packPriceCents: 1000, received: 0, ...over });
const seeds = [
  { id: 'po-T0DAY1', supplier: 'REV', placedOn: today, taxCents: 80, shippingCents: 995, discount: { kind: '%', value: 1000 }, lines: [L({ itemId: 'A', category: 'Electrical', packs: 2, packPriceCents: 4999 }), L({ description: 'Team shirts', unit: 'shirt', packs: 3, packSize: 2, packPriceCents: 1500 })] },
  { id: 'po-F1RST1', supplier: 'WCP', placedOn: first, lines: [L({ itemId: 'B', category: 'Fasteners', packPriceCents: 333, received: 1 })] },
  { id: 'po-PREV01', supplier: 'rev', placedOn: lastOfPrev, feesCents: 50, lines: [L({ itemId: 'A', category: 'Electrical', packPriceCents: 700 })] },
  { id: 'po-D29AGO', supplier: 'AndyMark', placedOn: daysAgo(29), discount: { kind: '$', value: 500 }, lines: [L({ itemId: 'C', category: 'Old category', packs: 4, packPriceCents: 1250 })] },
  { id: 'po-D30AGO', supplier: 'AndyMark', placedOn: daysAgo(30), lines: [L({ itemId: 'C', category: 'Old category', packPriceCents: 2000 })] },
  { id: 'po-SYSTRT', supplier: 'WCP', placedOn: syStart, lines: [L({ itemId: 'B', category: 'Fasteners', packPriceCents: 1100 })] },
  { id: 'po-SYPREV', supplier: 'WCP', placedOn: dayBefore(syStart), lines: [L({ itemId: 'B', category: 'Fasteners', packPriceCents: 1200 })] },
  { id: 'po-LSYSTR', supplier: 'REV', placedOn: lastSyStart, lines: [L({ itemId: 'A', category: 'Electrical', packPriceCents: 1300 })] },
  { id: 'po-OLDEST', supplier: 'REV', placedOn: dayBefore(lastSyStart), lines: [L({ itemId: 'A', category: 'Electrical', packPriceCents: 1400 })] },
  { id: 'po-CANCEL', supplier: 'REV', placedOn: today, cancelled: true, taxCents: 999, lines: [L({ itemId: 'A', category: 'Electrical', packPriceCents: 99999 })] },
].map((o, i) => ({ orderNo: '', payment: '', cancelled: false, taxCents: 0, shippingCents: 0, feesCents: 0, discount: { kind: '$', value: 0 }, notes: '', fromList: 'Automatic', receipts: [], created: 1000 + i, updated: 1000 + i, ...o }));

const within = (from, to) => seeds.filter((o) => o.placedOn >= from && o.placedOn <= to).sort((a, b) => (a.placedOn === b.placedOn ? b.created - a.created : a.placedOn < b.placedOn ? 1 : -1)).map((o) => o.id);
const totalOf = (o) => {
  const parts = o.lines.reduce((n, l) => n + l.packs * l.packPriceCents, 0);
  const disc = o.discount.kind === '$' ? o.discount.value : Math.floor((parts * o.discount.value + 5000) / 10000);
  return parts - disc + o.taxCents + o.shippingCents + o.feesCents;
};
const spent = (ids) => seeds.filter((o) => ids.includes(o.id) && !o.cancelled).reduce((n, o) => n + totalOf(o), 0);

try {
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await size(1280, 800);
  await send('Page.navigate', { url: 'http://localhost:4353/' });
  await waitFor(`document.querySelector('.setup')`, 60000);
  await js(`await doSetup();`);
  await waitFor(`document.querySelectorAll('.cathdr').length >= 11`, 60000);

  // ── No orders yet: the History tab explains ──
  await js(`await go('#/placed');`);
  check('History tab, empty: the explanation, no export or print buttons', await js(`return [norm($('.ltab.on').textContent), norm($('.top h1').textContent), !!$('.state'), !byText('.top button', 'Export CSV')]`), ['History', 'Order history', true, true]);

  // Seed the orders straight into IndexedDB, then reload so the app reads them.
  await js(`for (const o of ${JSON.stringify(seeds)}) await idbPut('orders', { ...o, supplierKey: o.supplier.toLowerCase(), itemIds: [...new Set(o.lines.map((l) => l.itemId).filter(Boolean))] }); location.reload();`);
  await sleep(1500);
  await waitFor(`document.querySelector('.po-row')`, 30000);

  const rows = `$$('.po-row').map((r) => r.getAttribute('href').split('/').pop())`;
  const pickRange = async (label) => js(`const s = $('select[aria-label="Date range"]'); s.value = [...s.options].find((o) => o.textContent === ${JSON.stringify(label)}).value; s.dispatchEvent(new Event('change', { bubbles: true })); await settle(400);`);
  const ranges = await js(`return [...$('select[aria-label="Date range"]').options].map((o) => o.textContent)`);
  check('ranges offered: no “This season” until it’s set; This school year to start', [ranges, await js(`const s = $('select[aria-label="Date range"]'); return s.options[s.selectedIndex].textContent`)], [['This month', 'Last 30 days', 'This school year', 'Last school year', 'Custom'], 'This school year']);
  check('This school year: from its first day (Aug 1) to today, newest first, cancelled listed', await js(`return ${rows}`), within(syStart, today));
  check('subtitle: the range, orders counted (not cancelled) and the amount spent', await js(`return norm($('.top h1').parentElement.querySelector('.small.muted')?.textContent ?? '')`), `This school year · ${within(syStart, today).filter((id) => id !== 'po-CANCEL').length} orders · ${money0(spent(within(syStart, today)))} spent`);
  await shot('01-history-school-year');

  await pickRange('This month');
  check('This month: the 1st to today; the last day of last month is out', await js(`return ${rows}`), within(first, today));
  await pickRange('Last 30 days');
  check('Last 30 days: 29 days ago is in, 30 days ago is out', await js(`return [${rows}.includes('po-D29AGO'), ${rows}.includes('po-D30AGO'), ${rows}]`), [true, false, within(daysAgo(29), today)]);
  await pickRange('Last school year');
  check('Last school year: its Aug 1 and the day before this year’s start are in; the day before it is out', await js(`return ${rows}`), within(lastSyStart, dayBefore(syStart)));

  await pickRange('Custom');
  check('Custom with no dates asks for them', await js(`return [norm($('.po-none')?.textContent ?? ''), $$('.po-row').length]`), ['Choose the From and To dates.', 0]);
  await js(`await type('input[aria-label=From]', ${JSON.stringify(daysAgo(30))}); await type('input[aria-label=To]', ${JSON.stringify(first)}); await settle(300);`);
  check('Custom From–To: both days included', await js(`return ${rows}`), within(daysAgo(30), first));
  await js(`location.reload();`);
  await sleep(1500);
  await waitFor(`document.querySelector('select[aria-label="Date range"]')`, 30000);
  check('the range is remembered on the device after a reload', await js(`const s = $('select[aria-label="Date range"]'); return [s.options[s.selectedIndex].textContent, $('input[aria-label=From]').value, $('input[aria-label=To]').value]`), ['Custom', daysAgo(30), first]);
  await pickRange('This school year');

  // ── Filters ──
  const syIds = within(syStart, today);
  const bySup = (k) => syIds.filter((id) => seeds.find((o) => o.id === id).supplier.toLowerCase() === k);
  await js(`const s = $('select[aria-label=Supplier]'); s.value = 'REV'; s.dispatchEvent(new Event('change', { bubbles: true })); await settle(300);`);
  check('supplier filter: REV and rev are one supplier', await js(`return [[...$('select[aria-label=Supplier]').options].map((o) => o.textContent), ${rows}]`), [['Any supplier', 'AndyMark', 'REV', 'WCP'], bySup('rev')]);
  await js(`const s = $('select[aria-label=Supplier]'); s.value = ''; s.dispatchEvent(new Event('change', { bubbles: true })); await settle(300);`);
  const statusOf = (o) => (o.cancelled ? 'cancelled' : o.lines.every((l) => l.received >= l.packs * l.packSize) ? 'received' : 'open');
  const want = (st) => syIds.filter((id) => st === 'all' || statusOf(seeds.find((o) => o.id === id)) === st);
  check('status buttons show their counts', await js(`return $$('[aria-label=Status] .segb').map((b) => norm(b.textContent))`), [`All (${want('all').length})`, `Open (${want('open').length})`, `Received (${want('received').length})`, `Cancelled (${want('cancelled').length})`]);
  for (const st of ['Open', 'Received', 'Cancelled']) {
    await js(`await click('[aria-label=Status] .segb', ${JSON.stringify(st)}); await settle(200);`);
    check(`status ${st}`, await js(`return ${rows}`), want(st.toLowerCase()));
  }
  await js(`await click('[aria-label=Status] .segb', 'All'); await settle(200);`);
  check('a cancelled order’s total is struck through', await js(`return getComputedStyle($('a[href$="po-CANCEL"] .po-total')).textDecorationLine`), 'line-through');

  // ── Spending summary ──
  await js(`await click('[aria-label=Show] .segb', 'Spending summary'); await settle(300);`);
  const tableRows = (label) => `[...document.querySelectorAll('table[aria-label="${label}"] tr')].map((r) => [...r.cells].map((c) => norm(c.textContent)))`;
  const sup = await js(`return ${tableRows('Spending by supplier')}`);
  const cat = await js(`return ${tableRows('Spending by category')}`);
  const syCounted = seeds.filter((o) => syIds.includes(o.id) && !o.cancelled);
  check('by supplier: a row per supplier A–Z, then Total = what was spent; cancelled left out', [sup.slice(1).map((r) => r[0]), sup.at(-1)[1], sup.at(-1).at(-1)], [[...new Set(syCounted.map((o) => (o.supplier.toLowerCase() === 'rev' ? 'REV' : o.supplier)))].sort((a, b) => a.localeCompare(b)).concat('Total'), String(syCounted.length), money0(spent(syIds))]);
  check('by category: ends on the same Total; discount shown as a minus', [cat.at(-1), cat.some((r) => r[0] === 'Discount' && r[1].startsWith('−'))], [['Total', money0(spent(syIds))], true]);
  check('by category: Other holds the typed line', cat.find((r) => r[0] === 'Other'), ['Other', '$45.00']);
  await shot('02-summary');

  // ── Exports (download fallback captured) ──
  await js(CAPTURE + `await click('.top button', 'Export CSV'); for (let i = 0; i < 50 && !window.__files.length; i++) await settle(100);`);
  const csv = await js(`const f = window.__files[0]; return { name: f.name, text: new TextDecoder().decode(f.bytes) }`);
  const csvRows = csv.text.replace(/^﻿/, '').split('\r\n');
  check('Export CSV: file name from the range', csv.name, `order-history-${syStart}-to-${today}.csv`);
  check('Export CSV: first row names the range and filters; headings; ends on the category Total', [csvRows[0], csvRows[1].startsWith('Placed,Supplier,Order #'), csvRows.includes('Spending by supplier (cancelled orders left out)'), csvRows.includes('Spending by category (cancelled orders left out)'), csvRows.filter(Boolean).at(-1)], [`Order history: This school year (${syStart} to ${today}) · Supplier: any · Status: all`, true, true, true, `Total,${(spent(syIds) / 100).toFixed(2)}`]);
  await js(CAPTURE + `await click('.top button', 'Export lines CSV'); for (let i = 0; i < 50 && !window.__files.length; i++) await settle(100);`);
  const lines = await js(`const f = window.__files[0]; return { name: f.name, text: new TextDecoder().decode(f.bytes) }`);
  const lineRows = lines.text.replace(/^﻿/, '').split('\r\n').filter(Boolean);
  check('Export lines CSV: name, one row per line, the typed line in its unit under Other', [lines.name, lineRows.length - 2, lineRows.some((r) => r.includes(',Team shirts,,Other,shirt,3,2,6,15.00,45.00,0'))], [`order-history-lines-${syStart}-to-${today}.csv`, seeds.filter((o) => syIds.includes(o.id)).reduce((n, o) => n + o.lines.length, 0), true]);
  check('exporting asked for no PIN', await js(`return !$('[role=dialog][aria-label="Mentor PIN"]')`), true);

  // ── Print summary: the page goes to the print dialog (stubbed), shown as printed ──
  await js(`window.__printed = []; window.print = () => window.__printed.push(document.getElementById('print-root')?.innerText ?? ''); await click('.top button', 'Print summary'); await settle(500);`);
  const printed = await js(`return window.__printed[0] ?? ''`);
  check('Print summary: title, range, filters, printed date, both summaries and the orders', [printed.includes('FRC 2408 order history'), printed.includes('This school year:'), printed.includes('Supplier: any · Status: all'), printed.includes('Printed'), printed.includes('By supplier'), printed.includes('By category'), printed.includes(`Orders (${syIds.length})`)], [true, true, true, true, true, true, true]);
  await send('Emulation.setEmulatedMedia', { media: 'print' });
  await sleep(300);
  await shot('03-printed-summary');
  check('as printed: only the summary page shows', await js(`return [getComputedStyle($('#app')).display, getComputedStyle($('#print-root')).display]`), ['none', 'block']);
  await send('Emulation.setEmulatedMedia', { media: '' });
  await js(`dispatchEvent(new Event('afterprint')); await settle(300);`);
  check('after printing the page is removed', await js(`return !document.getElementById('print-root')`), true);

  // ── Settings: season start and school year start (PIN) ──
  await js(`await go('#/more/settings'); await settle(400);`);
  check('settings: the order history fields are locked until the PIN', await js(`return [$('#set-season').disabled, $('select[aria-label="School year start month"]').disabled, $('select[aria-label="School year start month"]').value, $('select[aria-label="School year start day"]').value]`), [true, true, '8', '1']);
  const season = daysAgo(29);
  await js(`await click('.lockbar button', 'Unlock'); await answerGate(true, true);
            await type('#set-season', ${JSON.stringify(season)});
            const m = $('select[aria-label="School year start month"]'); m.value = '9'; m.dispatchEvent(new Event('change', { bubbles: true })); await settle(200);
            await click('.top button', 'Save'); await settle(500);`);
  check('saved: season start and September 1', await js(`const s = await idb('settings'); return [s.find((r) => r.key === 'seasonStart')?.value, s.find((r) => r.key === 'schoolYearStart')?.value]`), [season, '09-01']);
  await shot('04-settings');
  await js(`await relockNow(); await go('#/placed'); await settle(500);`);
  check('This season is offered now', await js(`return [...$('select[aria-label="Date range"]').options].map((o) => o.textContent).includes('This season')`), true);
  check('This school year now starts on September 1', await js(`return ${rows}`), within(sySep, today));
  await pickRange('This season');
  check('This season: from the season start to today', await js(`return ${rows}`), within(season, today));

  // Clearing the season start: the remembered "This season" falls back to This school year.
  await js(`await go('#/more/settings'); await settle(300); await click('.lockbar button', 'Unlock'); await answerGate(true, true); await click('.setin button', 'Clear'); await click('.top button', 'Save'); await settle(500); await relockNow(); await go('#/placed'); await settle(500);`);
  check('season cleared: not offered, and the list falls back to This school year', await js(`const s = $('select[aria-label="Date range"]'); return [[...s.options].map((o) => o.textContent).includes('This season'), s.options[s.selectedIndex].textContent]`), [false, 'This school year']);

  // ── A row opens its order ──
  await js(`$('a[href$="po-T0DAY1"]').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); await settle(700);`);
  check('a row opens the order page', await js(`return [location.hash, norm($('.top h1').textContent)]`), ['#/placed/po-T0DAY1', `REV · ${new Date(now.getFullYear(), now.getMonth(), now.getDate()).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`]);
  await js(`await go('#/placed'); await settle(400);`);

  // ── Layout ──
  check('history: touch targets ≥ 48 px, text ≥ 15 px', await js(`return [targets($('.main')), smallText($('.main'))]`), [[], []]);
  await js(`await click('[aria-label=Show] .segb', 'Spending summary'); await settle(300);`);
  check('summary: text ≥ 15 px', await js(`return smallText($('.main'))`), []);
  await size(800, 1280);
  await sleep(500);
  await shot('05-summary-portrait');
  check('portrait summary: nothing wider than the screen', await js(`return document.documentElement.scrollWidth <= innerWidth`), true);
  await js(`await click('[aria-label=Show] .segb', 'Orders'); await settle(300);`);
  await shot('06-orders-portrait');
  check('portrait orders: nothing wider than the screen; targets ≥ 48 px', await js(`return [document.documentElement.scrollWidth <= innerWidth, targets($('.main'))]`), [true, []]);
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

function money0(c) {
  return '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
