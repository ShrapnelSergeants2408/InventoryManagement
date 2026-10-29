// M13 real-browser check: Select and bulk move (F28, SPEC v0.8; §19 Bulk move).
// Usage: npm run build && node scripts/m13-ui-check.mjs <chrome.exe> <screenshot dir>
import { tempDir, track } from './tmp-cleanup.mjs';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PIN_H } from './pin-helpers.mjs';

const [chrome, outDir] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const preview = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', '4333', '--strictPort'], { stdio: 'ignore' });
const port = 9349;
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

// Helpers that run in the page.
const H = `
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const hdr = (name) => $$('.cathdr, .subhdr').find((b) => b.querySelector('span').textContent === name);
  const typeInto = (el, v) => { el.focus(); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
  const settle = () => new Promise((r) => setTimeout(r, 400));
`;

const ORIGIN = 'http://localhost:4333';
const PAGE = `const $ = (s) => document.querySelector(s); const $$ = (s) => [...document.querySelectorAll(s)]; const norm = (s) => s.replace(/\\s+/g, ' ').trim(); const byText = (sel, t) => $$(sel).find((b) => norm(b.textContent).includes(t)); const settle = (ms = 350) => new Promise((r) => setTimeout(r, ms)); ${PIN_H}`;
const P = (expr) => js(`${PAGE} ${expr}`);
const idbAll = (store) => `return await new Promise((res, rej) => { const r = indexedDB.open('frc2408-inventory'); r.onsuccess = () => { const q = r.result.transaction('${store}').objectStore('${store}').getAll(); q.onsuccess = () => { r.result.close(); res(q.result); }; q.onerror = () => rej(q.error); }; r.onerror = () => rej(r.error); })`;
const hdr = (name) => `[...document.querySelectorAll('.cathdr.sel, .subhdr.sel')].find((h) => h.querySelector('.cb span:not(.cbox)')?.textContent === ${JSON.stringify(name)})`;
const count = `return norm($('.selcount strong').textContent)`;
const pinShown = `return !!document.querySelector('[role=dialog][aria-label="Mentor PIN"]')`;
const pick = (sel, v) => `{ const el = $(${JSON.stringify(sel)}); el.value = ${JSON.stringify(v)}; el.dispatchEvent(new Event('change', { bubbles: true })); await settle(200); }`;
const typeIn = (sel, v) => `{ const el = $(${JSON.stringify(sel)}); el.focus(); el.value = ${JSON.stringify(v)}; el.dispatchEvent(new Event('input', { bubbles: true })); await settle(200); }`;
const strip = (i) => { const { category, subcategory, updatedAt, ...rest } = i; return rest; };

try {
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await size(1280, 800);
  await send('Page.navigate', { url: ORIGIN + '/' });
  await waitFor(`document.querySelector('.setup')`, 60000);
  await P(`await doSetup();`);
  await waitFor(`document.querySelectorAll('.cathdr').length >= 11`, 60000);
  await sleep(400);
  const before = await js(idbAll('items'));

  // ── Select mode on (F28) ──
  check('Select button next to Add item; no selection bar yet', await P(`return [!!byText('.top .btn', 'Select'), !!$('.selbar')]`), [true, false]);
  await P(`byText('.top .btn', 'Select').click(); await settle();`);
  check('Select mode: bar with 0 selected, Move disabled; Done replaces Add item', await P(`return [${count.replace('return ', '')}, byText('.selbar .btn', 'Move to').disabled, !!byText('.top .btn', 'Done'), !!byText('.top a.btn', 'Add item')]`), ['0 items selected', true, true, false]);
  check('headers become checkboxes, none checked', await P(`return [$$('.cathdr.sel').length, $$('.cathdr.sel .cb[aria-checked="false"]').length]`), [11, 11]);
  check('empty categories have a disabled checkbox', await P(`return ['Public Relations', 'Programming'].map((n) => ${hdr('__N__')}.querySelector('.cb').disabled)`.replace(JSON.stringify('__N__'), 'n')), [true, true]);

  // A whole category from its header, collapsed: every item in it.
  await P(`${hdr('Misc')}.querySelector('.cb').click(); await settle();`);
  check('header checkbox selects every item under it (Misc, 3, collapsed)', await P(`return [${count.replace('return ', '')}, ${hdr('Misc')}.querySelector('.cb').getAttribute('aria-checked'), norm(${hdr('Misc')}.querySelector('.hc').textContent)]`), ['3 items selected', 'true', '3 of 3 items selected']);

  // Rows: expand Fasteners › Screws and pick two; the headers show "mixed".
  await P(`${hdr('Fasteners')}.querySelector('.exp').click(); await settle(); ${hdr('Screws')}.querySelector('.exp').click(); await settle();`);
  check('rows in Select mode: checkbox rows, no On-hand stepper', await P(`return [$$('.selrow').length > 0, $$('.stepper').length, $$('.row').length]`), [true, 0, 0]);
  await P(`const rows = $$('.selrow .cb'); rows[0].click(); await settle(80); rows[1].click(); await settle(200);`);
  check('two rows picked: Screws and Fasteners show mixed', await P(`return [${count.replace('return ', '')}, ${hdr('Screws')}.querySelector('.cb').getAttribute('aria-checked'), ${hdr('Fasteners')}.querySelector('.cb').getAttribute('aria-checked')]`), ['5 items selected', 'mixed', 'mixed']);
  await P(`$$('.selrow .cb')[1].click(); await settle(200);`);
  check('tapping a picked row unpicks it', await P(count), '4 items selected');
  await shot('01-select-mode');

  // Search, then "Select all shown": only the matches; a hidden selection is called out.
  await P(`const s = $('.searchwrap input'); s.focus(); s.value = 'NEO'; s.dispatchEvent(new Event('input', { bubbles: true })); await settle(400);`);
  const neoShown = await P(`return $$('.selrow').length`);
  await P(`byText('.selbar .btn', 'Select all shown').click(); await settle();`);
  check('search "NEO" + Select all shown: adds just the matches', await P(`return [${count.replace('return ', '')}, norm(byText('.selbar .btn', 'Select all shown').textContent), byText('.selbar .btn', 'Select all shown').disabled]`), [`${4 + neoShown} items selected`, `Select all shown (${neoShown})`, true]);
  check('items picked outside the search are counted as not shown', await P(`return norm($('.selcount').textContent)`), `${4 + neoShown} items selected · 4 not shown by this search or filter`);
  await P(`byText('.selbar .btn', 'Clear').click(); await settle();`);
  check('Clear empties the selection', await P(count), '0 items selected');
  await P(`$('.searchwrap .clr').click(); await settle(400);`);

  // ── Move to… a new subcategory (one step, no PIN) ──
  await P(`${hdr('Misc')}.querySelector('.cb').click(); await settle(); const rows = $$('.selrow .cb'); rows[0].click(); await settle(200);`);
  const moveIds = await js(`return (${idbAll('items').replace('return ', '')}).filter((i) => i.category === 'Misc').map((i) => i.id)`);
  const screwPicked = await P(`return $$('.selrow')[0].querySelector('strong').textContent`);
  await P(`byText('.selbar .btn', 'Move to').click(); await settle();`);
  check('Move dialog opens with Category / Subcategory pickers', await P(`return [!!$('[role=dialog][aria-label="Move items"]'), !!$('#mvcat'), !!$('#mvsub')]`), [true, true, true]);
  await P(`${pick('#mvcat', 'Fasteners')} ${pick('#mvsub', '\u0000new')} ${typeIn('#mvns', 'Test Bin')}`);
  check('confirmation: how many, to where, and from where', await P(`return [norm($('.dlg .h2').textContent), norm($('.mv-from').textContent), norm(byText('.dlg .btn', 'Move 4').textContent)]`), ['Move 4 items to Fasteners › Test Bin?', 'From Fasteners › Screws (1), Misc (3).', 'Move 4 items']);
  await shot('02-move-dialog');
  await P(`byText('.dlg .btn', 'Move 4 items').click(); await settle(700);`);
  check('moved: dialog closed, Select mode ended, toast, no PIN asked', await P(`return [!!$('.dlg'), !!$('.selbar'), norm($('.toast')?.textContent ?? '').startsWith('Moved 4 items to Fasteners › Test Bin'), ${pinShown.replace('return ', '')}]`), [false, false, true, false]);
  const after = await js(idbAll('items'));
  const movedNow = after.filter((i) => i.category === 'Fasteners' && i.subcategory === 'Test Bin');
  check('the 4 items are in Fasteners › Test Bin (the 3 from Misc and the picked screw)', [movedNow.length, moveIds.every((id) => movedNow.some((i) => i.id === id)), movedNow.some((i) => i.name === screwPicked)], [4, true, true]);
  check('only category and subcategory changed on the moved items', movedNow.every((a) => JSON.stringify(strip(a)) === JSON.stringify(strip(before.find((b) => b.id === a.id)))), true);
  check('no other item changed', after.filter((a) => !movedNow.some((m) => m.id === a.id)).every((a) => JSON.stringify(a) === JSON.stringify(before.find((b) => b.id === a.id))), true);
  const cats = await js(idbAll('categories'));
  check('the new subcategory is at the end of Fasteners', cats.find((c) => c.name === 'Fasteners').subcategories.at(-1), 'Test Bin');

  // ── Cancel changes nothing; then "+ New category…" ──
  await P(`byText('.top .btn', 'Select').click(); await settle(); ${hdr('Safety')}.querySelector('.cb').click(); await settle(); byText('.selbar .btn', 'Move to').click(); await settle(); ${pick('#mvcat', 'Tools')} byText('.dlg .btn', 'Cancel').click(); await settle(400);`);
  check('Cancel: nothing moved, selection kept', [(await js(idbAll('items'))).filter((i) => i.category === 'Safety').length, await P(count)], [2, '2 items selected']);
  await P(`byText('.selbar .btn', 'Move to').click(); await settle(); ${pick('#mvcat', '\u0000new')} ${typeIn('#mvnc', 'Game Pieces')}`);
  check('new category: the heading follows the typed name', await P(`return norm($('.dlg .h2').textContent)`), 'Move 2 items to Game Pieces?');
  await P(`byText('.dlg .btn', 'Move 2 items').click(); await settle(700);`);
  const cats2 = (await js(idbAll('categories'))).sort((a, b) => a.order - b.order);
  check('"+ New category…" adds it at the end and moves the items there', [cats2.at(-1).name, (await js(idbAll('items'))).filter((i) => i.category === 'Game Pieces').length, (await js(idbAll('items'))).filter((i) => i.category === 'Safety').length], ['Game Pieces', 2, 0]);
  check('the Inventory list shows the new category', await P(`return $$('.cathdr .cn').map((c) => c.textContent).at(-1)`), 'Game Pieces');

  // ── Done leaves Select mode with the steppers back ──
  await P(`byText('.top .btn', 'Select').click(); await settle(); byText('.top .btn', 'Done').click(); await settle();`);
  check('Done: normal rows and headers again', await P(`return [!!$('.selbar'), $$('.cathdr.sel').length, !!byText('.top a.btn', 'Add item')]`), [false, 0, true]);

  // ── Touch targets ≥ 48 px in Select mode and the dialog, landscape and portrait (§17) ──
  const small = `return [...document.querySelectorAll('.selbar button, .cathdr.sel button, .subhdr.sel button, .selrow button, .dlg button, .dlg select, .dlg input')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.height < 47.5 || r.width < 47.5); }).map((e) => (e.className || e.id) + ':' + Math.round(e.getBoundingClientRect().width) + 'x' + Math.round(e.getBoundingClientRect().height))`;
  await P(`byText('.top .btn', 'Select').click(); await settle(); ${hdr('Tools')}.querySelector('.exp').click(); await settle(); byText('.selbar .btn', 'Select all shown').click(); await settle(); byText('.selbar .btn', 'Move to').click(); await settle();`);
  check('landscape: touch targets ≥ 48 px', await js(small), []);
  await P(`byText('.dlg .btn', 'Cancel').click(); await settle();`);
  await size(800, 1280);
  await sleep(400);
  check('portrait: touch targets ≥ 48 px, nothing wider than the screen', [await js(small), await js(`return document.documentElement.scrollWidth <= innerWidth && [...document.querySelectorAll('.selbar, .selrow')].every((e) => e.getBoundingClientRect().right <= innerWidth + 0.5)`)], [[], true]);
  await shot('03-portrait-select');
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
