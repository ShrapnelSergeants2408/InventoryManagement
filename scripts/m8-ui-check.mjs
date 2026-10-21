// M8 real-browser check: QR labels (select, layout, start position, nudge, preview, print and
// test print measured in print media and as a PDF) and Scan (camera fed a QR video, typed codes,
// found / unknown / attach / add). Drives the production build in headless Chrome over CDP.
// Usage: npm run build && node scripts/m8-ui-check.mjs <chrome.exe> <screenshot dir>
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import qrcode from 'qrcode-generator';
import { PIN_H } from './pin-helpers.mjs';

const [chrome, outDir] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const preview = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', '4328', '--strictPort'], { stdio: 'ignore' });
const port = 9344;
// The fake camera plays a video of a printed team label: QR "2408:st-0063", black on white.
const camVideo = join(mkdtempSync(join(tmpdir(), 'm8-cam-')), 'label.y4m');
{
  const qr = qrcode(0, 'M');
  qr.addData('2408:st-0063', 'Byte');
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
const proc = spawn(chrome, ['--headless=new', '--disable-gpu', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${camVideo}`, `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'cdp-'))}`, 'about:blank'], { stdio: 'ignore' });

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
  if (d.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(d.params.type)) problems.push(`console.${d.params.type}: ` + JSON.stringify(d.params.args).slice(0, 400));
};
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const js = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: `(async () => { ${H} ${expr} })()`, awaitPromise: true, returnByValue: true });
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

// Helpers that run in the page.
const H = `
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const settle = (ms = 350) => new Promise((r) => setTimeout(r, ms));
  const norm = (s) => s.replace(/\\s+/g, ' ').trim();
  const byText = (sel, t) => $$(sel).find((b) => norm(b.textContent).includes(t));
  const click = async (sel, t) => { const b = byText(sel, t); if (!b) throw new Error('nothing like ' + sel + ' with text ' + t); b.click(); await settle(); return b; };
  const type = async (el, v) => { if (typeof el === 'string') el = $(el); el.focus(); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); await settle(120); };
  const pick = async (el, v) => { if (typeof el === 'string') el = $(el); el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); await settle(200); };
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
  const gates = () => window.__gates ?? -1;
`;

const COUNT_GATES = `
  window.__gates = 0;
  new MutationObserver(() => {
    const d = document.querySelector('[aria-label="Mentor PIN"]');
    if (d && !d.__seen) { d.__seen = true; window.__gates++; }
  }).observe(document.body, { childList: true, subtree: true });
`;



// In-page label helpers: positions of labels on a sheet, in inches (1 in = 96 CSS px).
const LH = `
  const inches = (root) => { const sheet = root.closest('.sheet'); const s = sheet.getBoundingClientRect(); const k = s.width / (8.5 * 96); return [...sheet.querySelectorAll('.lab')].filter((l) => root.contains(l)).map((l) => { const r = l.getBoundingClientRect(); return { slot: +l.dataset.slot, id: l.dataset.id ?? null, cls: l.className, x: +((r.left - s.left) / k / 96).toFixed(2), y: +((r.top - s.top) / k / 96).toFixed(2), w: +(r.width / k / 96).toFixed(2), h: +(r.height / k / 96).toFixed(2) }; }); };
  const groupRow = (name) => [...document.querySelectorAll('.lgrow')].find((r) => r.querySelector('strong')?.textContent === name);
`;
const jsL = (expr) => js(`${LH} ${expr}`);

try {
  await send('Runtime.enable');
  await send('Page.enable');
  await send('DOM.enable');
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await size(1280, 800);
  await send('Page.navigate', { url: 'http://localhost:4328/' });
  await waitFor(`document.querySelector('.setup')`, 60000);
  await js(`await doSetup();`);
  await waitFor(`document.querySelectorAll('.cathdr').length >= 11`, 60000);
  await js(COUNT_GATES);
  // window.print is replaced: each call records what the print pages held at that moment.
  await js(`window.__prints = []; window.print = () => { const r = document.querySelector('#print-root'); window.__prints.push({ mode: r?.dataset.mode, sheets: r?.querySelectorAll('.sheet').length, labels: r?.querySelectorAll('.lab[data-id]').length, outlines: r?.querySelectorAll('.lab.outline').length }); };`);

  // Two locations, in a walk order that isn't alphabetical, and two items filed there.
  await js(`await go('#/more/locations');`);
  for (const n of ['Shelf Z', 'Bin A']) await js(`await click('.top button', 'Add location'); await type('#en-name', '${n}'); await click('.dlg button[type=submit]', 'Add location'); await settle(400);`);
  await js(`await go('#/item/st-0063/edit'); await pick('#loc', 'Bin A'); await click('.top button', 'Save'); await settle(500);`);
  await js(`await go('#/item/st-0001/edit'); await pick('#loc', 'Shelf Z'); await click('.top button', 'Save'); await settle(500);`);

  // ── Step 1: choose items (mockup 6a) ──
  await js(`await go('#/labels'); await settle(500);`);
  check('Labels opens on step 1, grouped by category, nothing selected', await js(`return [norm(document.querySelector('.stp.on').textContent), document.querySelector('[role=tab][aria-selected=true]').textContent, document.querySelectorAll('.lgrow').length, norm(document.querySelector('.bignum').textContent), document.querySelector('.racts .btn.pri').disabled]`), ['1Choose items', 'By category', 9, '0 labels', true]);
  // A whole category (Power Transfer, 17) plus the two NEO motors from Electrical (st-0063 is filed in Bin A): 19 labels.
  await jsL(`groupRow('Power Transfer').querySelector('.cb').click(); await settle(200); groupRow('Electrical').querySelector('.exp').click(); await settle(200);`);
  await jsL(`const rows = [...document.querySelectorAll('.irow')].filter((r) => ['NEO 2.0 Brushless Motor', 'NEO 550 Brushless Motor'].some((n) => r.textContent.includes(n))); for (const r of rows) { r.querySelector('.cb').click(); await settle(60); }`);
  check('a whole category, plus 2 items from another; mixed state shown', await jsL(`return [groupRow('Power Transfer').querySelector('.cb').getAttribute('aria-checked'), groupRow('Electrical').querySelector('.cb').getAttribute('aria-checked'), norm(document.querySelector('.bignum').textContent), norm(document.querySelector('.rsum .small').textContent), document.querySelectorAll('.rlist li').length]`), ['true', 'mixed', '19 labels', 'Electrical 2 · Power Transfer 17', 19]);
  check('tapping a fully selected category clears it', await jsL(`const b = groupRow('Power Transfer').querySelector('.cb'); b.click(); await settle(150); const a = norm(document.querySelector('.bignum').textContent); b.click(); await settle(150); return [a, norm(document.querySelector('.bignum').textContent)]`), ['2 labels', '19 labels']);
  await js(`byText('[role=tab]', 'By location').click(); await settle(300);`);
  check('By location: walk order (Shelf Z, Bin A), then No location', await js(`return [...document.querySelectorAll('.lgrow strong')].map((e) => e.textContent)`), ['Shelf Z', 'Bin A', 'No location']);
  await shot('01-labels-select');
  check('touch targets ≥ 48 px on step 1', await js(`return [...document.querySelectorAll('.lbody button')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.height < 47.5 || r.width < 47.5); }).map((e) => norm(e.textContent) + ' ' + Math.round(e.getBoundingClientRect().height))`), []);

  // ── Step 2: layout, start position, nudge, preview (mockup 6b) ──
  await js(`await click('.racts .btn', 'Next: layout'); await settle(500);`);
  check('step 2: Avery 5160 first, start at label 1, nudge 0', await js(`return [norm(document.querySelector('.stp.on').textContent), norm(document.querySelector('.lay.on strong').textContent), document.querySelectorAll('.mini .cell').length, norm(document.querySelector('.cell.start').textContent), [...document.querySelectorAll('.nv')].map((e) => e.textContent)]`), ['2Layout & print', 'Avery 5160-compatible', 30, '1', ['0.0 mm', '0.0 mm']]);
  await js(`document.querySelectorAll('.mini .cell')[6].click(); await settle(300);`);
  check('start at label 7: text, 6 cells shown used, preview shows 19 labels after 6 used', await js(`return [norm(document.querySelector('.sec-p').textContent).endsWith('Starting at label 7 (row 3, column 1).'), document.querySelectorAll('.cell.used').length, document.querySelectorAll('.prev-page .lab[data-id]').length, document.querySelectorAll('.prev-page .lab.used').length, norm(document.querySelector('.prev-t').textContent)]`), [true, 6, 19, 6, 'Sheet 1 of 1 · Avery 5160 · 19 labels on this sheet · 6 already used']);
  check('preview positions are the sheet geometry (slot 6 at 0.1875, 2.5 in; 2.625 × 1; to 0.01 in)', await jsL(`const l = inches(document.querySelector('.prev-page .sheet')).filter((x) => x.id); return [l[0].slot, l[0].x, l[0].y, l[0].w, l[0].h, l.at(-1).slot]`), [6, 0.19, 2.5, 2.63, 1, 24]);
  check('chosen by location, labels print in walk order: Bin A’s item first, then No location', await jsL(`const l = inches(document.querySelector('.prev-page .sheet')).filter((x) => x.id); return [l[0].id, l.some((x) => x.id === 'st-0001')]`), ['st-0063', false]);
  await js(`for (let i = 0; i < 3; i++) document.querySelector('[aria-label="Move down 0.5 mm"]').click(); await settle(200); document.querySelector('[aria-label="Move left 0.5 mm"]').click(); await settle(300);`);
  check('nudge +1.5 mm down, −0.5 mm right moves the preview', await jsL(`const l = inches(document.querySelector('.prev-page .sheet')).filter((x) => x.id); return [[...document.querySelectorAll('.nv')].map((e) => e.textContent), l[0].x, l[0].y]`), [['+1.5 mm', '-0.5 mm'], +(0.1875 - 0.5 / 25.4).toFixed(2), +(2.5 + 1.5 / 25.4).toFixed(2)]);
  check('nudge saved for Avery 5160 only', await js(`return [(await idb('settings', 'labelNudge.avery-5160')).value, await idb('settings', 'labelNudge.avery-5163') ?? null]`), [{ top: 1.5, left: -0.5 }, null]);
  await shot('02-labels-layout');

  // ── Print: the print pages, measured in print media, and a PDF of them ──
  await js(`await click('.pacts-row .btn', 'Print 19 labels');`);
  check('Before you print: Letter, 100%, 1 sheet (mockup 6c)', await js(`const d = dlg('Before you print'); return [norm(d.querySelector('.h2').textContent), [...d.querySelectorAll('.dlg-list li')].map((l) => norm(l.textContent))]`), ['Before you print', ['Paper size: Letter', 'Scale: 100% / Actual size — not “Fit to page”', 'Pages: All (1 sheet)']]);
  await shot('03-before-print');
  await js(`await click('.dlg button', 'Open print dialog'); await settle(400);`);
  check('Open print dialog prints 1 sheet of 19 labels; no PIN', await js(`return [window.__prints, gates()]`), [[{ mode: 'labels', sheets: 1, labels: 19, outlines: 0 }], 0]);
  await send('Emulation.setEmulatedMedia', { media: 'print' });
  check('print media: only the print page shows, at full size (8.5 × 11 in)', await js(`const s = document.querySelector('#print-root .sheet').getBoundingClientRect(); return [getComputedStyle(document.querySelector('#app')).display, getComputedStyle(document.querySelector('#print-root')).display, s.width / 96, s.height / 96]`), ['none', 'block', 8.5, 11]);
  check('print media: label 7 at its sheet position plus the nudge; QR 0.8 in; 2408:<id>', await jsL(`const l = inches(document.querySelector('#print-root .sheet')); const q = document.querySelector('#print-root .lab[data-id] svg').getBoundingClientRect(); return [l.length, l[0].slot, l[0].x, l[0].y, l[0].w, l[0].h, +(q.width / 96).toFixed(3), document.querySelector('#print-root .lab[data-id] svg').getAttribute('aria-label').startsWith('QR code 2408:st-')]`), [19, 6, +(0.1875 - 0.5 / 25.4).toFixed(2), +(2.5 + 1.5 / 25.4).toFixed(2), 2.63, 1, 0.8, true]);
  const pdf = await send('Page.printToPDF', { preferCSSPageSize: true, printBackground: true });
  const pdfText = Buffer.from(pdf.result.data, 'base64').toString('latin1');
  check('PDF: 1 page, letter size (612 × 792 pt)', [(pdfText.match(/\/Type\s*\/Page[^s]/g) || []).length, /\/MediaBox\s*\[\s*0 0 612 792\s*\]/.test(pdfText)], [1, true]);
  writeFileSync(join(outDir, '04-labels.pdf'), Buffer.from(pdf.result.data, 'base64'));
  await send('Emulation.setEmulatedMedia', { media: '' });

  // ── Test print: every label position outlined and numbered, on one page ──
  await js(`await click('.pacts-row .btn', 'Test print'); await settle(200);`);
  check('test print dialog', await js(`return norm(dlg('Before you print').querySelector('.h2').textContent)`), 'Test print: outlines on plain paper');
  await js(`await click('.dlg button', 'Open print dialog'); await settle(300);`);
  check('test print: 30 numbered outlines, no labels, 1 sheet', await js(`return window.__prints.at(-1)`), { mode: 'test', sheets: 1, labels: 0, outlines: 30 });
  await send('Emulation.setEmulatedMedia', { media: 'print' });
  check('test print outlines carry the nudge (slot 1 at 0.1875 in −0.5 mm, 0.5 in +1.5 mm)', await jsL(`const l = inches(document.querySelector('#print-root .sheet')); return [l.length, l[0].slot, l[0].x, l[0].y, norm(document.querySelector('#print-root .sheet-cap').textContent)]`), [30, 0, +(0.1875 - 0.5 / 25.4).toFixed(2), +(0.5 + 1.5 / 25.4).toFixed(2), 'Test print · Avery 5160-compatible · nudge +1.5 mm down, -0.5 mm right · print at 100%']);
  const tpdf = await send('Page.printToPDF', { preferCSSPageSize: true, printBackground: true });
  writeFileSync(join(outDir, '05-test-print.pdf'), Buffer.from(tpdf.result.data, 'base64'));
  await send('Emulation.setEmulatedMedia', { media: '' });
  await js(`dispatchEvent(new Event('afterprint')); await settle(200);`);
  check('after printing, the print pages go back to labels', await js(`return document.querySelector('#print-root').dataset.mode`), 'labels');

  // ── Other layouts, page breaks ──
  await js(`[...document.querySelectorAll('.lay')].find((b) => b.textContent.includes('5163')).click(); await settle(400);`);
  check('5163: 10 per sheet; 19 labels → 2 sheets; its own nudge (0)', await js(`return [document.querySelectorAll('.mini .cell').length, norm(document.querySelector('.prev-t').textContent), [...document.querySelectorAll('.nv')].map((e) => e.textContent)]`), [10, 'Sheet 1 of 2 · Avery 5163 · 10 labels on this sheet', ['0.0 mm', '0.0 mm']]);
  await js(`document.querySelectorAll('.mini .cell')[6].click(); await settle(200);`);
  check('5163 from label 7: 4 + 10 + 5 over 3 sheets; next sheet has no used labels', await js(`const t = []; t.push(norm(document.querySelector('.prev-t').textContent)); document.querySelector('[aria-label="Next sheet"]').click(); await settle(200); t.push(norm(document.querySelector('.prev-t').textContent), document.querySelectorAll('.prev-page .lab.used').length); document.querySelector('[aria-label="Next sheet"]').click(); await settle(200); t.push(norm(document.querySelector('.prev-t').textContent)); return t`), ['Sheet 1 of 3 · Avery 5163 · 4 labels on this sheet · 6 already used', 'Sheet 2 of 3 · Avery 5163 · 10 labels on this sheet', 0, 'Sheet 3 of 3 · Avery 5163 · 5 labels on this sheet']);
  check('5163 label text: name, location, part #', await js(`const l = document.querySelector('#print-root .lab[data-id="st-0063"]'); return l ? [...l.querySelectorAll('.lab-t span')].map((s) => s.textContent) : null`), ['NEO 2.0 Brushless Motor (15T spline shaft)', 'Bin A', 'REV REV-21-1653']);
  await js(`await click('.pacts-row .btn', 'Print 19 labels'); await click('.dlg button', 'Open print dialog'); await settle(300);`);
  const pdf3 = await send('Page.printToPDF', { preferCSSPageSize: true, printBackground: true });
  check('5163 print: 3 sheets of labels; the PDF has 3 pages', [await js(`return window.__prints.at(-1)`), (Buffer.from(pdf3.result.data, 'base64').toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length], [{ mode: 'labels', sheets: 3, labels: 19, outlines: 0 }, 3]);
  await js(`[...document.querySelectorAll('.lay')].find((b) => b.textContent.includes('22805')).click(); await settle(300);`);
  check('22805: 24 per sheet, square labels', await jsL(`const l = inches(document.querySelector('.prev-page .sheet')).filter((x) => x.id); return [document.querySelectorAll('.mini .cell').length, l[0].w, l[0].h, l[0].x, l[0].y]`), [24, 1.5, 1.5, 0.69, 0.69]);
  await js(`[...document.querySelectorAll('.lay')].find((b) => b.textContent.includes('Plain')).click(); await settle(300);`);
  check('plain paper: no start position; QR sizes; labels with dashed cut lines', await js(`return [!!document.querySelector('.mini'), [...document.querySelectorAll('.qr-sizes .fchip')].map((b) => b.textContent), document.querySelectorAll('.prev-page .lab.cut').length, norm(document.querySelector('.prev-t').textContent)]`), [false, ['1 in', '1½ in', '2 in'], 19, 'Sheet 1 of 1 · plain paper, 1 in QR · 19 labels on this sheet']);
  await js(`byText('.qr-sizes .fchip', '2 in').click(); await settle(300);`);
  check('plain 2 in: 6 per page → 4 pages; the QR is 2 in', await js(`return [norm(document.querySelector('.prev-t').textContent), document.querySelector('.prev-page .lab svg').getAttribute('width')]`), ['Sheet 1 of 4 · plain paper, 2 in QR · 6 labels on this sheet', '2in']);
  await shot('06-plain-2in');
  check('the layout choice is remembered', await js(`return JSON.parse(localStorage.getItem('frc2408.labels.layout'))`), { layoutId: 'plain', plainQr: 2 });

  // ── From an item's card: Print QR label preselects it ──
  await js(`await go('#/item/st-0063'); await settle(400); await click('.dacts a', 'Print QR label'); await settle(500);`);
  check('Print QR label on the card opens step 2 with just that item', await js(`return [location.hash, norm(document.querySelector('.back-sel').textContent), document.querySelectorAll('.prev-page .lab[data-id]').length, document.querySelector('.prev-page .lab[data-id]').dataset.id]`), ['#/labels?ids=st-0063', '1 item selected', 1, 'st-0063']);
  await size(800, 1280);
  await js(`await settle(300);`);
  await shot('07-labels-portrait');
  check('portrait: no horizontal overflow on either step', await js(`const out = []; if (document.documentElement.scrollWidth > innerWidth) out.push('layout'); document.querySelector('.back-sel').click(); await settle(300); if (document.documentElement.scrollWidth > innerWidth) out.push('select'); return out`), []);
  await size(1280, 800);
  check('touch targets ≥ 48 px on step 2', await js(`await click('.racts .btn', 'Next: layout'); await settle(300); return [...document.querySelectorAll('.cfg button')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.height < 47.5 || r.width < 47.5); }).map((e) => norm(e.textContent) + ' ' + Math.round(e.getBoundingClientRect().height))`), []);
  check('labels never asked for the PIN', await js(`return gates()`), 0);

  // ══ Scan (F21) ══
  const panel = () => `document.querySelector('.spanel')?.getAttribute('aria-label') ?? null`;
  await js(`window.__gates = 0; await go('#/scan');`);
  await waitFor(`document.querySelector('.cam[data-state=live]')`, 20000);
  check('Scan opens the camera (mockup 5a): Type a code, lock button, hint', await js(`return [!!document.querySelector('.cam video'), byText('.ctop .btn', 'Type a code') !== undefined, !!document.querySelector('.ctop .lockpill'), norm(document.querySelector('.chint').textContent)]`), [true, true, true, 'Point at a QR label or a barcode — it scans by itself']);
  await waitFor(`document.querySelector('.spanel[aria-label="Item found"]')`, 20000);
  check('the camera reads the team label and opens the item (5b)', await js(`return [norm(document.querySelector('.found-by').textContent), document.querySelector('.found-t .h2').textContent, norm(document.querySelector('.cam-paused')?.textContent ?? ''), [...document.querySelectorAll('.sp-foot .btn')].map((b) => norm(b.textContent))]`), ['QR label 2408:st-0063', 'NEO 2.0 Brushless Motor (15T spline shaft)', 'Camera paused', ['Done — scan next', 'Open full details']]);
  check('no built-in BarcodeDetector here, so the bundled zxing .wasm was loaded from this site; nothing from a CDN', await js(`const r = performance.getEntriesByType('resource').map((e) => e.name); return ['BarcodeDetector' in window, r.filter((n) => n.endsWith('.wasm')).map((n) => new URL(n).host), r.filter((n) => /jsdelivr|unpkg|cdn/.test(n))]`), [false, ['localhost:4328'], []]);
  await shot('08-scan-found');
  const before = await js(`return (await idb('items', 'st-0063')).onHand`);
  await js(`document.querySelector('.spanel [aria-label="Plus one"]').click(); await settle(400); document.querySelector('.spanel [aria-label="Plus one"]').click(); await settle(400); document.querySelector('.spanel [aria-label="Minus one"]').click(); await settle(500);`);
  check('On hand ± in the panel saves at once; no PIN', await js(`return [(await idb('items', 'st-0063')).onHand - ${before}, document.querySelector('.spanel input[aria-label="On hand"]').value, gates()]`), [1, String(before + 1), 0]);
  await js(`await click('.sp-foot .btn', 'Done — scan next'); await settle(1200);`);
  check('Done — scan next: the label still in view is ignored for a moment…', await js(`return ${panel()}`), null);
  await waitFor(`document.querySelector('.spanel[aria-label="Item found"]')`, 10000);
  check('…then scanned again', await js(`return document.querySelector('.found-t .h2').textContent`), 'NEO 2.0 Brushless Motor (15T spline shaft)');
  await js(`await click('.sp-foot .btn', 'Done — scan next');`);

  // Typed codes: the same resolution as the camera.
  const typeCode = async (code) => js(`await click('.ctop .btn', 'Type a code'); await type('.spanel input[aria-label=Code]', ${JSON.stringify(code)}); await click('.spanel button[type=submit]', 'Find item'); await settle(400);`);
  await typeCode('ST-0001');
  check('typed item id (any case) opens it', await js(`return [${panel()}, norm(document.querySelector('.found-by').textContent), document.querySelector('.found-t .h2').textContent.length > 0]`), ['Item found', 'Typed ID st-0001', true]);
  await js(`await click('.sp-foot a', 'Open full details'); await settle(500);`);
  check('Open full details opens the card', await js(`return location.hash`), '#/item/st-0001');
  await js(`history.back(); await settle(800);`);
  await waitFor(`document.querySelector('.cam[data-state=live]') || document.querySelector('.spanel')`, 15000);
  await js(`if (document.querySelector('.spanel')) await click('.sp-foot .btn', 'Done');`);
  await typeCode(' 7 22787 60063 0 ');
  check('typed manufacturer barcode, in groups, opens its item (PDH)', await js(`return [norm(document.querySelector('.found-by').textContent), document.querySelector('.found-t .h2').textContent]`), ['Typed code 722787600630', 'Power Distribution Hub (PDH)']);
  await js(`await click('.sp-foot .btn', 'Done');`);
  await typeCode('0722787600630');
  check('EAN-13 form of a stored UPC-A opens the same item', await js(`return document.querySelector('.found-t .h2').textContent`), 'Power Distribution Hub (PDH)');
  await js(`await click('.sp-foot .btn', 'Done');`);
  await typeCode('2408:st-9999');
  check('a team label for an item not on this tablet', await js(`return [${panel()}, document.querySelector('.spanel .h2').textContent, document.querySelector('.spanel .code-big').textContent]`), ['Label for a missing item', 'This label’s item isn’t here', 'st-9999']);
  await js(`await click('.sp-foot .btn', 'Scan again');`);

  // Unknown → attach (no PIN), then the next scan finds it.
  await typeCode('012345678905');
  check('unknown code (5c): code, kind, attach / add / scan again', await js(`return [${panel()}, document.querySelector('.spanel .code-big').textContent, norm(document.querySelector('.spanel .small.muted').textContent), [...document.querySelectorAll('.sp-foot .btn')].map((b) => norm(b.textContent))]`), ['Unknown code', '012345678905', 'Typed code · no item has this code', ['Attach to an existing item', 'Add a new item with this barcode', 'Scan again']]);
  await shot('09-scan-unknown');
  await js(`await click('.sp-foot .btn', 'Attach to an existing item'); await type('.spanel input[type=search]', 'gamepad'); await settle(300);`);
  check('attach (5d): search finds the item; the button names it', await js(`const p = document.querySelectorAll('.spanel .pick'); p[0]?.click(); await settle(200); return [p.length > 0, norm(p[0].querySelector('strong').textContent), norm(document.querySelector('.sp-foot .btn.pri').textContent)]`), [true, 'Logitech F310 gamepad', 'Attach to Logitech F310 gamepad']);
  await shot('10-scan-attach');
  const gamepadId = await js(`return (await idb('items')).find((i) => i.name === 'Logitech F310 gamepad').id`);
  await js(`await click('.sp-foot .btn', 'Attach to'); await settle(500);`);
  check('attached: stored, panel shows the item, no PIN', await js(`return [(await idb('items', ${JSON.stringify(gamepadId)})).barcode, ${panel()}, document.querySelector('.found-t .h2').textContent, gates()]`), ['012345678905', 'Item found', 'Logitech F310 gamepad', 0]);
  await js(`await click('.sp-foot .btn', 'Done');`);
  await typeCode('012345678905');
  check('the next scan of that barcode opens it straight away', await js(`return document.querySelector('.found-t .h2')?.textContent ?? ${panel()}`), 'Logitech F310 gamepad');
  await js(`await click('.sp-foot .btn', 'Done');`);
  await typeCode('5012345678900');
  await js(`await click('.sp-foot .btn', 'Attach to an existing item'); await type('.spanel input[type=search]', 'PDH'); await settle(300); document.querySelector('.spanel .pick').click(); await settle(200);`);
  check('attaching to an item that has a barcode says it replaces it', await js(`return [norm(document.querySelector('.sp-foot .btn.pri').textContent), norm(document.querySelector('.spanel .sp-body > .small').textContent)]`), ['Replace the barcode on Power Distribution Hub (PDH)', 'This item already has barcode 722787600630; attaching replaces it.']);
  await js(`await click('.sp-foot .btn', 'Back'); await click('.sp-foot a', 'Add a new item with this barcode'); await settle(600);`);
  check('Add a new item with this barcode: the add form has it filled in', await js(`return [location.hash, document.querySelector('#bc').value]`), ['#/add?barcode=5012345678900', '5012345678900']);

  // Two items with the same barcode (typed in the editor): Scan lets you choose.
  await js(`await go('#/item/st-0002/edit'); await settle(500); await type('#bc', '012345678905'); await click('.top button', 'Save'); await settle(600);`);
  await js(`await go('#/scan');`);
  await waitFor(`document.querySelector('.cam[data-state=live]') || document.querySelector('.spanel')`, 15000);
  await js(`if (document.querySelector('.spanel')) await click('.sp-foot .btn', 'Done');`);
  await typeCode('012345678905');
  check('a barcode on two items: both offered', await js(`return [${panel()}, document.querySelectorAll('.spanel .pick').length]`), ['Several items', 2]);
  await js(`document.querySelectorAll('.spanel .pick')[1].click(); await settle(300);`);
  check('choosing one opens it', await js(`return [${panel()}, !!document.querySelector('.found-t .h2')]`), ['Item found', true]);
  await js(`await click('.sp-foot .btn', 'Done');`);

  // Camera blocked (5e), with the typed fallback, then allowed again.
  // The fake-camera flag grants every request, so the refusal Chrome gives a blocked site
  // (getUserMedia rejects with NotAllowedError) is reproduced in the page.
  await js(`window.__gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices); navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError')); await go('#/inventory'); await go('#/scan'); await settle(1200);`);
  check('camera blocked: steps to allow it, Try again, and a typed code', await js(`return [document.querySelector('.denied .h1')?.textContent, document.querySelectorAll('.denied-steps li').length, !!byText('.denied .btn', 'Try again'), !!document.querySelector('#mc')]`), ['The camera is blocked', 3, true, true]);
  await shot('11-scan-denied');
  await js(`await type('#mc', 'st-0063'); document.querySelector('.denied-type button[type=submit]').click(); await settle(500);`);
  check('typed code works with the camera blocked', await js(`return document.querySelector('.found-t .h2')?.textContent`), 'NEO 2.0 Brushless Motor (15T spline shaft)');
  await js(`await click('.sp-foot .btn', 'Done');`);
  await js(`navigator.mediaDevices.getUserMedia = window.__gum; await click('.denied .btn', 'Try again');`);
  await waitFor(`document.querySelector('.cam[data-state=live]')`, 15000);
  check('Try again after allowing: the camera is back', await js(`return !!document.querySelector('.cam[data-state=live]')`), true);
  await waitFor(`document.querySelector('.spanel')`, 15000);
  await js(`await click('.sp-foot .btn', 'Done');`);
  await js(`await go('#/inventory'); await settle(600);`);
  check('leaving Scan releases the camera', await js(`return document.querySelectorAll('video').length`), 0);

  // Editor: Scan button next to the barcode; a team label is refused there.
  await js(`await go('#/item/st-0005/edit'); await settle(500); await click('.inline-add .btn', 'Scan');`);
  await waitFor(`document.querySelector('[aria-label="Scan a barcode"] .err')`, 20000);
  check('editor Scan: the camera opens; a team QR label is refused, the field stays empty', await js(`return [norm(document.querySelector('[aria-label="Scan a barcode"] .err').textContent), document.querySelector('#bc').value]`), ['That’s a team QR label, not a manufacturer barcode. Scan the barcode on the packaging.', '']);
  await js(`await click('[aria-label="Scan a barcode"] .btn', 'Cancel'); await settle(300);`);
  check('Cancel closes the scan and the camera', await js(`return [!!document.querySelector('[aria-label="Scan a barcode"]'), document.querySelectorAll('video').length]`), [false, 0]);

  // Layout: portrait, touch targets.
  await js(`await go('#/scan');`);
  await waitFor(`document.querySelector('.spanel')`, 20000);
  await size(800, 1280);
  await js(`await settle(400);`);
  await shot('12-scan-portrait');
  check('portrait: no horizontal overflow on Scan', await js(`return document.documentElement.scrollWidth <= innerWidth`), true);
  await size(1280, 800);
  check('touch targets ≥ 48 px in the scan panel and top bar', await js(`return [...document.querySelectorAll('.spanel button, .spanel a, .spanel input, .ctop button')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.height < 47.5 || r.width < 47.5); }).map((e) => norm(e.textContent || e.getAttribute('aria-label')) + ' ' + Math.round(e.getBoundingClientRect().height))`), []);
  check('the reticle scan line is a thin line (M9 fix: the order list .line class no longer applies)', await js(`return Math.round(document.querySelector('.scan .reticle .line').getBoundingClientRect().height)`), 3);
  check('scanning never asked for the PIN', await js(`return gates()`), 0);
} catch (e) {
  results.push('FAIL  script error: ' + e.message);
  await shot('zz-error').catch(() => {});
} finally {
  console.log(results.join('\n'));
  console.log(problems.length ? 'Console problems:\n' + problems.join('\n') : 'No console errors or warnings');
  ws.close();
  proc.kill();
  preview.kill();
}
