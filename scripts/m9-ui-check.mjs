// M9 real-browser check: count-in (F24). Start screen, walks by category and by location with
// the keypad, status preview, locations, skip / back, resume after a reload, group summary,
// recount, and scan as you go with Chrome's fake camera playing a team QR label. Drives the
// production build in headless Chrome over CDP.
// Usage: npm run build && node scripts/m9-ui-check.mjs <chrome.exe> <screenshot dir>
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import qrcode from 'qrcode-generator';
import { PIN_H } from './pin-helpers.mjs';

const [chrome, outDir] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const preview = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', '4329', '--strictPort'], { stdio: 'ignore' });
const port = 9345;
// The fake camera plays a video of a printed team label: QR "2408:st-0063", black on white.
const camVideo = join(mkdtempSync(join(tmpdir(), 'm9-cam-')), 'label.y4m');
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
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); return; }
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
  const today = (() => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })();
  // Count-in screen readers.
  const prog = () => $$('.cprog-t span').map((s) => norm(s.textContent));
  const rows = () => $$('.cg-row').filter((r) => r.querySelector('.cg-n')).map((r) => [norm(r.querySelector('.cg-n strong').textContent), norm(r.querySelector('.tnum').textContent), norm(r.querySelector('.btn')?.textContent ?? '')]);
  const row = (name) => $$('.cg-row').find((r) => norm(r.querySelector('.cg-n strong')?.textContent ?? '') === name);
  const pos = () => $$('.wr-pos span').map((s) => norm(s.textContent));
  const val = () => norm($('.val').textContent);
  const preview = () => norm($('.wpv .chip')?.textContent ?? '').replace(/^After saving: /, '');
  const key = async (k) => { $$('.pad button').find((b) => b.getAttribute('aria-label') === k).click(); await settle(80); };
  const quick = async (t) => { await click('.quick .fchip', t); };
  const act = async (t) => { await click('.wacts .btn', t); await settle(300); };
  const wname = () => norm($('.wname').textContent);
  // Inventory list order, worked out here from the stored lists (independent of the app's code).
  const listOrder = async () => {
    const cats = (await idb('categories')).sort((a, b) => a.order - b.order);
    const items = await idb('items');
    const out = [];
    for (const c of cats) {
      const inCat = items.filter((i) => i.category === c.name);
      for (const sub of [...c.subcategories, ...new Set(inCat.map((i) => i.subcategory).filter((s) => s && !c.subcategories.includes(s))), '']) out.push(...inCat.filter((i) => i.subcategory === sub));
    }
    return out;
  };
`;

const COUNT_GATES = `
  window.__gates = 0;
  new MutationObserver(() => {
    const d = document.querySelector('[aria-label="Mentor PIN"]');
    if (d && !d.__seen) { d.__seen = true; window.__gates++; }
  }).observe(document.body, { childList: true, subtree: true });
`;

try {
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await size(1280, 800);
  await send('Page.navigate', { url: 'http://localhost:4329/' });
  await waitFor(`document.querySelector('.setup')`, 60000);
  await js(`await doSetup();`);
  await waitFor(`document.querySelectorAll('.cathdr').length >= 12`, 60000);

  // Two locations, walk order Shelf Z then Bin A (not alphabetical); one Motors item filed in
  // each (st-0064 NEO 550, st-0063 NEO 2.0), so the first category (Structure) has none.
  await js(`await go('#/more/locations');`);
  for (const n of ['Shelf Z', 'Bin A']) await js(`await click('.top button', 'Add location'); await type('#en-name', '${n}'); await click('.dlg button[type=submit]', 'Add location'); await settle(400);`);
  await js(`await go('#/item/st-0063/edit'); await pick('#loc', 'Bin A'); await click('.top button', 'Save'); await settle(500);`);
  await js(`await go('#/item/st-0064/edit'); await pick('#loc', 'Shelf Z'); await click('.top button', 'Save'); await settle(500);`);
  await js(COUNT_GATES);

  // ── Start screen (10a) ──
  await js(`await go('#/count'); await settle(400);`);
  await waitFor(`document.querySelector('.modes')`);
  const expectFirst = await js(`const l = await listOrder(); const cat = l[0].category; return { cat, n: l.filter((i) => i.category === cat).length, ids: l.filter((i) => i.category === cat).map((i) => i.id), names: l.filter((i) => i.category === cat).map((i) => i.name), desired: l.filter((i) => i.category === cat).map((i) => i.desired), cats: [...new Set(l.map((i) => i.category))] }`);
  check('start: title, progress 0 of 129, order total $8,413.66', await js(`return [$('.h1').textContent, prog(), norm($('.ctotal-h').textContent)]`), ['Count-in', ['0 of 129 counted', '0%'], 'Order list right now: $8,413.66']);
  check('three modes; by category chosen and recommended for the first count', await js(`return $$('.mode').map((m) => [norm(m.querySelector('.mode-h').textContent), m.getAttribute('aria-checked'), !!m.querySelector('strong')])`), [['By category', 'true', true], ['By location', 'false', false], ['Scan as you go', 'false', false]]);
  check('mode descriptions use live numbers (2 located items, 10 barcodes)', await js(`return $$('.mode .small.muted').slice(1).map((s) => norm(s.textContent).split('.')[0])`), ['2 items have a location', 'Scan a QR label or barcode and the keypad opens for that item']);
  check('options: ask for a location on, skip desired 0 off (5 items)', await js(`return $$('.tog').map((t) => [norm(t.textContent), t.getAttribute('aria-checked')])`), [['Ask for a bin/shelf location while counting', 'true'], ['Skip items with desired 0 (5)', 'false']]);
  check('categories in list order, every one at 0 / n with Start', await js(`const r = rows(); return [r.map((x) => x[0]), r.every((x) => x[1].startsWith('0 / ') && x[2] === 'Start'), r.reduce((s, x) => s + +x[1].split(' / ')[1], 0)]`), [expectFirst.cats, true, 129]);
  await shot('01-count-start');
  await js(`await click('.tog', 'Skip items with desired 0');`);
  check('skip desired 0: the walk drops 5 items; overall progress still counts 129 (D8)', await js(`return [rows().reduce((s, x) => s + +x[1].split(' / ')[1], 0), prog()[0], $$('.tog')[1].getAttribute('aria-checked')]`), [124, '0 of 129 counted', 'true']);
  await js(`await click('.tog', 'Skip items with desired 0');`);

  // ── Walk by category (10b) ──
  await js(`await click('.cg-row .btn', 'Start');`);
  check('walk opens at item 1 of the first category, in list order', await js(`return [pos(), wname(), $('.top .btn').textContent.trim()]`), [[expectFirst.cat + (await js(`return (await idb('items', ${JSON.stringify(expectFirst.ids[0])})).subcategory ? ' › ' + (await idb('items', ${JSON.stringify(expectFirst.ids[0])})).subcategory : ''`)), `Item 1 of ${expectFirst.n}`], expectFirst.names[0], 'Pause']);
  check('nothing typed: prompt shown, Save & next off, no preview', await js(`return [val(), byText('.wacts .btn', 'Save & next').disabled, preview(), !!byText('.wacts .btn', 'Back')]`), ['Type the count', true, '', false]);
  await shot('02-count-walk-empty');
  const d0 = expectFirst.desired[0];
  await js(`await key('1'); await key('2');`);
  check('keypad: 1, 2 → 12; preview', await js(`return [val(), norm($('.wpv .chip').textContent)]`), ['12', 'After saving: ' + (12 < d0 ? `SHORT ${d0 - 12}` : 'OK')]);
  await js(`await key('Delete last digit');`);
  check('delete → 1', await js(`return val()`), '1');
  await js(`await key('None — zero');`);
  check('None → 0, preview SHORT desired', await js(`return [val(), preview()]`), ['0', d0 > 0 ? `SHORT ${d0}` : 'OK']);
  await js(`await quick('= desired');`);
  check('= desired → desired, preview OK (spares 0)', await js(`return [val(), preview(), norm(byText('.quick .fchip', 'desired').textContent)]`), [String(d0), 'OK', `= desired (${d0})`]);
  await js(`await quick('+1'); await quick('+1'); await quick('−1');`);
  check('+1 +1 −1', await js(`return val()`), String(d0 + 1));
  // A hardware keyboard types too (desktop testing).
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
  await send('Input.dispatchKeyEvent', { type: 'char', text: '7' });
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: '7', code: 'Digit7', windowsVirtualKeyCode: 55 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: '7', code: 'Digit7', windowsVirtualKeyCode: 55 });
  check('hardware keys: Backspace and 7', await js(`await settle(150); return val()`), String(d0 + 1).slice(0, -1).replace(/^0$/, '') + '7');
  await js(`await key('None — zero'); await key('3');`);
  await shot('03-count-walk-typed');
  // Location: quick picks are the recently used locations; pick Bin A, saved with the count.
  check('location quick picks: recent locations, then New location…', await js(`return [norm($('.wloc-h').textContent), $$('.locs .fchip').map((b) => norm(b.textContent))]`), ['Location: not set', ['Shelf Z', 'Bin A', 'New location…']]);
  await js(`await click('.locs .fchip', 'Bin A');`);
  check('picked location shows it will be saved with the count', await js(`return norm($('.wloc-h').textContent)`), 'Location: Bin A (saved with the count)');
  await js(`await act('Save & next');`);
  check('Save sets on_hand, last_counted (today) and the location in IndexedDB', await js(`const i = await idb('items', ${JSON.stringify(expectFirst.ids[0])}); return [i.onHand, i.lastCounted === today, i.location]`), [3, true, 'Bin A']);
  check('next item, overall progress 1 of 129', await js(`return [pos()[1], wname(), prog()]`), [`Item 2 of ${expectFirst.n}`, expectFirst.names[1], ['1 of 129 counted', '1%']]);
  // New location from count-in (F25: no PIN); a duplicate is refused.
  await js(`await click('.locs .fchip', 'New location'); await type('.wloc-add input', 'bin a');`);
  check('new location: a duplicate name is refused', await js(`return [norm($('.wloc-add .err')?.textContent ?? ''), byText('.wloc-add .btn', 'Add').disabled]`), ['“bin a” is already in the list as “Bin A”. Names are compared ignoring capitals.', true]);
  await js(`await type('.wloc-add input', 'Bin Q'); await click('.wloc-add .btn', 'Add'); await settle(400);`);
  check('new location added to the list and picked', await js(`return [(await idb('locations')).sort((a, b) => a.order - b.order).map((l) => l.name), norm($('.wloc-h').textContent)]`), [['Shelf Z', 'Bin A', 'Bin Q'], 'Location: Bin Q (saved with the count)']);
  await js(`await act('Skip for now');`);
  check('Skip: next item; the skipped item is unchanged, location not saved', await js(`const i = await idb('items', ${JSON.stringify(expectFirst.ids[1])}); return [pos()[1], i.lastCounted, i.location, i.onHand]`), [`Item 3 of ${expectFirst.n}`, '', '', 0]);
  await js(`await act('Back');`);
  check('Back to the skipped item: keypad empty', await js(`return [pos()[1], val()]`), [`Item 2 of ${expectFirst.n}`, 'Type the count']);
  await js(`await act('Back');`);
  check('Back to the saved item: keypad shows what was saved', await js(`return [pos()[1], val(), preview()]`), [`Item 1 of ${expectFirst.n}`, '3', 3 < d0 ? `SHORT ${d0 - 3}` : 'OK']);
  await js(`await act('Save & next'); await key('2'); await act('Save & next');`);
  check('two saved, now at item 3', await js(`return [pos()[1], prog()[0]]`), [`Item 3 of ${expectFirst.n}`, '2 of 129 counted']);

  // ── Pause and resume across a reload ──
  await js(`await click('.top .btn', 'Pause');`);
  check('Pause: start screen; the group says Continue at 2 / n', await js(`return [!!$('.modes'), rows()[0]]`), [true, [expectFirst.cat, `2 / ${expectFirst.n}`, 'Continue']]);
  await send('Page.reload');
  await waitFor(`document.querySelector('.modes')`, 30000);
  await js(COUNT_GATES);
  check('after a reload: progress kept and a "paused" banner with Pick up there', await js(`return [prog()[0], [...($('.cpause')?.children ?? [])].map((c) => norm(c.textContent)).filter(Boolean).join(' ')]`), ['2 of 129 counted', `Paused in ${expectFirst.cat} (by category) at item 3 of ${expectFirst.n}. Pick up there`]);
  await js(`await click('.cpause .btn', 'Pick up there');`);
  check('Pick up there opens the item where the walk stopped', await js(`return [pos()[1], wname()]`), [`Item 3 of ${expectFirst.n}`, expectFirst.names[2]]);
  await js(`await click('.top .btn', 'Pause'); await click('.cg-row .btn', 'Continue');`);
  // Items 1 and 2 were saved (item 2 after going Back), so the first one not counted is item 3.
  check('Continue opens at the first item not counted yet', await js(`return [pos()[1], wname()]`), [`Item 3 of ${expectFirst.n}`, expectFirst.names[2]]);
  await js(`await click('.top .btn', 'Pause');`);

  // ── By location: walk order, a one-item group, the summary (10d) ──
  await js(`await click('.mode', 'By location');`);
  check('by location: walk order Shelf Z, Bin A, then No location; Bin Q unused so hidden', await js(`return rows().map((r) => r.slice(0, 2))`), [['Shelf Z', '0 / 1'], ['Bin A', '1 / 2'], ['No location', `1 / 126`]]);
  await js(`window.__before = norm($('.ctotal-h').textContent).split(': ')[1]; await click('.cg-row .btn', 'Start');`);
  const st1 = await js(`const i = await idb('items', 'st-0064'); return { d: i.desired, s: i.spares, name: i.name }`);
  check('Shelf Z: its one item', await js(`return [pos(), wname()]`), [['Shelf Z', 'Item 1 of 1'], st1.name]);
  await js(`await quick('= desired'); await act('Save & next');`);
  await waitFor(`document.querySelector('.done-h')`);
  check('summary: title, counted, short, skipped, order total before → after', await js(`return [norm($('.done-h .h1').textContent), $$('.sumgrid .tile').map((t) => [...t.children].map((c) => norm(c.textContent)).join(' '))]`), ['Shelf Z counted', ['Counted 1 / 1', 'Short 0', 'Skipped 0', await js(`return 'Order list ' + window.__before + ' → ' + norm(document.querySelector('.sum-tot').textContent).split(' → ')[1]`)]]);
  check('order total dropped', await js(`const [a, b] = norm($('.sum-tot').textContent).split(' → ').map((x) => +x.replace(/[$,]/g, '')); return b < a`), st1.d + st1.s > 0);
  check('just counted row: name, amount, status chip', await js(`return $$('.srow2').map((r) => [norm(r.querySelector('.srow2-n').textContent), norm(r.querySelector('.srow2-v').textContent).split(' ')[0], norm(r.querySelector('.chip').textContent)])`), [[st1.name, String(st1.d), st1.s > 0 ? 'LOW SPARES' : 'OK']]);
  check('shortcuts: next group, print labels for this group, back up now', await js(`return $$('.done-h ~ .wacts .btn').map((b) => [norm(b.textContent), b.getAttribute('href')])`), [['Next: Bin A (2)', null], ['Print labels for Shelf Z', '#/labels?ids=st-0064'], ['Back up now', '#/more/backup'], ['Done for now', null]]);
  await shot('04-count-summary');
  await js(`await click('.wacts .btn', 'Next: Bin A');`);
  // Bin A holds st-0001 (Structure, filed there and counted above) and st-0063 (Motors).
  check('Next group opens at its first item not counted yet', await js(`return [pos(), wname()]`), [['Bin A', 'Item 2 of 2'], await js(`return (await idb('items', 'st-0063')).name`)]);
  await js(`await act('Skip for now');`);
  check('the walk ends after the last item even when it was skipped; summary counts the skip', await js(`return [norm($('.done-h .h1').textContent), [...$$('.sumgrid .tile')[2].children].map((c) => norm(c.textContent)).join(' '), norm($('.done-h ~ .wacts .btn').textContent)]`), ['Bin A counted', 'Skipped 1', 'Next: No location (126)']);
  await js(`await click('.wacts .btn', 'Done for now');`);
  check('Shelf Z fully counted: Recount', await js(`return rows()[0]`), ['Shelf Z', '1 / 1', 'Recount']);
  await js(`await click('.cg-row .btn', 'Recount');`);
  check('Recount starts at item 1 with an empty keypad', await js(`return [pos()[1], val()]`), ['Item 1 of 1', 'Type the count']);
  await js(`await key('5'); await act('Save & next'); await click('.wacts .btn', 'Print labels for Shelf Z'); await settle(600);`);
  check('Print labels for this group: Labels opens at step 2 with that group', await js(`return [location.hash, norm(document.querySelector('.back-sel').textContent), [...document.querySelectorAll('.prev-page .lab[data-id]')].map((l) => l.dataset.id)]`), ['#/labels?ids=st-0064', '1 item selected', ['st-0064']]);

  // ── Elsewhere in the app ──
  await js(`await go('#/order'); await settle(500);`);
  check('order list count-in banner shows the progress', await js(`return norm($('.banner').textContent).split('.')[0]`), 'Count-in: 3 of 129 items counted');
  await js(`await go('#/item/st-0064'); await settle(500);`);
  check('detail card shows the count date', await js(`return byText('.chip', 'Counted')?.textContent.startsWith('Counted ')`), true);

  // ── Scan as you go (10c) ──
  await js(`await go('#/count'); await settle(400); await click('.mode', 'Scan as you go');`);
  check('scan mode: Start scanning; groups show progress only', await js(`return [!!byText('.cbody .btn', 'Start scanning'), $$('.cg-row .btn').length, norm($('.cg-h .small').textContent)]`), [true, 0, 'Scanning tracks progress by category']);
  await js(`await click('.cbody .btn', 'Start scanning');`);
  await waitFor(`document.querySelector('.wname')`, 20000);
  check('the camera reads the label: keypad opens for that item', await js(`return [wname(), pos(), !!$('.wscan .cam[data-state=live]')]`), [await js(`return (await idb('items', 'st-0063')).name`), ['Scan as you go', 'Scan 1'], true]);
  await shot('05-count-scan');
  check('the reticle scan line is a thin line inside the reticle', await js(`const l = $('.wscan .reticle .line').getBoundingClientRect(), r = $('.wscan .reticle').getBoundingClientRect(); const cs = getComputedStyle($('.wscan .reticle .line')); return [Math.round(l.height), l.left > r.left && l.right < r.right, cs.height, cs.width]`), [3, true, '3px', '132px']);
  await js(`await key('4'); await act('Save & scan next');`);
  check('saved; waiting for the next scan', await js(`const i = await idb('items', 'st-0063'); return [i.onHand, i.lastCounted === today, norm($('.wwait .h2').textContent)]`), [4, true, 'Scan the next item']);
  await js(`await settle(3500);`);
  check('the label still in view does not reopen the item just saved', await js(`return [!!$('.wname'), !!$('.wscan .cam[data-state=live]')]`), [false, true]);
  await js(`await type('.wscan input', 'st-0001'); await click('.wscan .btn', 'Find');`);
  await js(`await act('Skip for now'); await settle(3500);`);
  check('after another item, the camera reads the same label again (the scanner keeps scanning)', await js(`return $('.wname') ? wname() : 'nothing opened'`), await js(`return (await idb('items', 'st-0063')).name`));
  await js(`await act('Skip for now'); await type('.wscan input', 'st-0001'); await click('.wscan .btn', 'Find');`);
  check('typed ID opens the item; the camera keeps running', await js(`return [wname(), pos()[1], !!$('.wscan .cam[data-state=live]')]`), [await js(`return (await idb('items', 'st-0001')).name`), 'Scan 4', true]);
  await js(`await settle(3000);`);
  check('the label still in view does not take over the item just typed', await js(`return wname()`), await js(`return (await idb('items', 'st-0001')).name`));
  await js(`await key('9'); await type('.wscan input', 'st-0002'); await click('.wscan .btn', 'Find');`);
  check('a typed count is not lost: finishing it is asked first', await js(`return [wname(), val(), norm($('.wnote').textContent).startsWith('Save or skip')]`), [await js(`return (await idb('items', 'st-0001')).name`), '9', true]);
  await js(`await act('Skip for now'); await type('.wscan input', 'NEO'); await click('.wscan .btn', 'Find');`);
  check('a name matching several items offers a choice', await js(`return [$$('.picks .pick').length > 1, norm($('.wnote').textContent).includes('match “NEO”')]`), [true, true]);
  // Choose the item whose label the camera sees, so after skipping it the camera ignores it again.
  const neo2 = await js(`return (await idb('items', 'st-0063')).name`);
  await js(`$$('.picks .pick').find((p) => norm(p.querySelector('strong').textContent) === ${JSON.stringify(neo2)}).click(); await settle(300);`);
  check('choosing one opens it', await js(`return $('.wname') ? wname() : null`), neo2);
  await js(`await act('Skip for now'); await type('.wscan input', '000000'); await click('.wscan .btn', 'Find');`);
  check('unknown code: says so and points to the Scan tab', await js(`return norm($('.wnote').textContent)`), 'No item has the code 000000. To attach it to an item, use the Scan tab.');
  await js(`await click('.wwait .btn', 'Back to the last item');`);
  check('Back to the last item', await js(`return !!$('.wname')`), true);
  await js(`await click('.top .btn', 'Pause'); await settle(300);`);
  check('Pause leaves scanning and releases the camera', await js(`return [!!$('.modes'), document.querySelectorAll('video').length]`), [true, 0]);

  // Camera blocked: typed codes still work.
  await js(`window.__gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices); navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError')); await click('.cbody .btn', 'Start scanning'); await settle(1200);`);
  check('camera blocked: message and the Find box', await js(`return [norm($('.wcam-off')?.textContent ?? '').startsWith('The camera is blocked'), !!$('.wscan input')]`), [true, true]);
  await js(`await type('.wscan input', 'st-0005'); await click('.wscan .btn', 'Find');`);
  check('typed code with the camera blocked', await js(`return !!$('.wname')`), true);
  await js(`navigator.mediaDevices.getUserMedia = window.__gum; await click('.top .btn', 'Pause');`);

  // ── Layout ──
  await js(`await click('.mode', 'By category'); await click('.cg-row .btn', 'Continue'); await key('1');`);
  check('touch targets ≥ 48 px on the walk screen', await js(`return [...document.querySelectorAll('.main button, .main a, .main input, .main select')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.height < 47.5 || r.width < 47.5); }).map((e) => norm(e.textContent || e.getAttribute('aria-label')) + ' ' + Math.round(e.getBoundingClientRect().height))`), []);
  check('keypad keys 68 px tall (§17)', await js(`return [...new Set($$('.pad button').map((b) => Math.round(b.getBoundingClientRect().height)))]`), [68]);
  await size(800, 1280);
  await js(`await settle(400);`);
  await shot('06-count-walk-portrait');
  check('portrait walk: no horizontal overflow; keypad and Save visible without scrolling', await js(`const s = byText('.wacts .btn', 'Save').getBoundingClientRect(); return [document.documentElement.scrollWidth <= innerWidth, s.bottom <= innerHeight - 88]`), [true, true]);
  await js(`await click('.top .btn', 'Pause');`);
  await shot('07-count-start-portrait');
  check('portrait start: no horizontal overflow', await js(`return document.documentElement.scrollWidth <= innerWidth`), true);
  await size(1280, 800);
  check('touch targets ≥ 48 px on the start screen', await js(`await settle(300); return [...document.querySelectorAll('.main button, .main a, .main input')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.height < 47.5 || r.width < 47.5); }).map((e) => norm(e.textContent || e.getAttribute('aria-label')) + ' ' + Math.round(e.getBoundingClientRect().height))`), []);
  check('count-in never asked for the PIN', await js(`return gates()`), 0);
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
