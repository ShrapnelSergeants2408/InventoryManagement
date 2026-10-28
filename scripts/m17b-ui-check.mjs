// M17b real-browser check: aim and hold (F21, F29; Dan 2026-10-28). Chrome's fake camera plays
// three bin codes side by side, "Tools 6", "Tools 7" and "Tools 8", as on a crowded shelf. Only the
// one in the on-screen square (the middle) may be used, and only after it is held there.
// Usage: npm run build && node scripts/m17b-ui-check.mjs <chrome.exe> <screenshot dir>
import { tempDir, track } from './tmp-cleanup.mjs';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import qrcode from 'qrcode-generator';
import { PIN_H } from './pin-helpers.mjs';

const [chrome, outDir] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const preview = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', '4342', '--strictPort'], { stdio: 'ignore' });
const port = 9358;
// Three QR codes across a 960×480 frame, black on white, each 25 modules × 8 px with space between.
const camVideo = join(tempDir('m17b-cam-'), 'shelf.y4m');
{
  const W = 960, H = 480, cell = 8;
  const Y = Buffer.alloc(W * H, 235);
  ['Tools 6', 'Tools 7', 'Tools 8'].forEach((text, k) => {
    const qr = qrcode(0, 'M');
    qr.addData(text, 'Byte');
    qr.make();
    const n = qr.getModuleCount();
    const cx = (W / 3) * k + W / 6;
    const x0 = Math.floor(cx - (n * cell) / 2), y0 = Math.floor((H - n * cell) / 2);
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) for (let dy = 0; dy < cell; dy++) Y.fill(16, (y0 + r * cell + dy) * W + x0 + c * cell, (y0 + r * cell + dy) * W + x0 + (c + 1) * cell);
  });
  const UV = Buffer.alloc((W / 2) * (H / 2), 128);
  const frame = Buffer.concat([Buffer.from('FRAME\n'), Y, UV, UV]);
  writeFileSync(camVideo, Buffer.concat([Buffer.from(`YUV4MPEG2 W${W} H${H} F10:1 Ip A1:1 C420jpeg\n`), ...Array(10).fill(frame)]));
}
const proc = spawn(chrome, ['--headless=new', '--disable-gpu', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${camVideo}`, `--remote-debugging-port=${port}`, `--user-data-dir=${tempDir('cdp-')}`, 'about:blank'], { stdio: 'ignore' });
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

const ORIGIN = 'http://localhost:4342';
const PAGE = `
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const norm = (s) => s.replace(/\\s+/g, ' ').trim();
  const byText = (sel, t) => $$(sel).find((b) => norm(b.textContent).includes(t));
  const settle = (ms = 350) => new Promise((r) => setTimeout(r, ms));
  const click = async (sel, t) => { const b = byText(sel, t); if (!b) throw new Error('nothing like ' + sel + ' with text ' + t); b.click(); await settle(); return b; };
  const go = async (h) => { location.hash = h; await settle(700); };
  const dlg = () => $('.dlg');
  // Watches one scan: when the camera went live, when the square first showed a hold, the
  // largest progress seen, and when 'done' became true. Times in ms from going live.
  const watch = async (done) => {
    let live = null, held = null, max = 0, end = null;
    for (let i = 0; i < 1000 && end === null; i++) {
      const now = performance.now();
      const cam = $('.cam');
      if (live === null && cam?.dataset.state === 'live') live = now;
      if (cam?.dataset.hold !== undefined) { held ??= now; max = Math.max(max, Number(getComputedStyle(cam).getPropertyValue('--hold')) || 0); }
      if (done()) end = now;
      await new Promise((r) => setTimeout(r, 20));
    }
    return { held: held !== null && live !== null ? Math.round(held - live) : null, used: end !== null && live !== null ? Math.round(end - live) : null, max, holdBeforeUse: held !== null && end !== null && held < end };
  };
  ${PIN_H}
`;
const P = (expr) => js(`${PAGE} ${expr}`);

try {
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await size(1280, 800);
  await send('Page.navigate', { url: ORIGIN + '/' });
  await waitFor(`document.querySelector('.setup')`, 60000);
  await P(`await doSetup();`);
  await waitFor(`document.querySelectorAll('.cathdr').length >= 11`, 60000);

  // ── Scan tab: three codes in view ──
  const t1 = await P(`location.hash = '#/scan'; return await watch(() => !!$('.spanel'));`);
  check('Scan tab: of three codes side by side, the one in the square (Tools 7) is used', await P(`return [$('.spanel').getAttribute('aria-label'), $('.spanel .code-big').textContent]`), ['Location not found', 'Tools 7']);
  check('…only after the square showed it held, and not before 0.6 s of holding', [t1.holdBeforeUse, t1.used !== null && t1.held !== null && t1.used - t1.held >= 550], [true, true]);
  check('the square reached a full hold', t1.max >= 0.66, true);
  results.push(`INFO  Scan tab timings (ms from camera live): ${JSON.stringify(t1)}`);
  await P(`await click('.sp-foot .btn', 'Add “Tools 7”'); await settle(500);`);

  // ── Location dialog: the same, in the editor ──
  const t2 = await P(`await go('#/item/st-0063/edit'); $('.fbody .btn[aria-label="Scan a location"]').click(); for (let i = 0; i < 100 && !dlg(); i++) await settle(20); return await watch(() => !dlg());`);
  check('editor location Scan: Tools 7 (the middle code), after a hold', [await P(`return $('#loc').value`), t2.holdBeforeUse, t2.used - t2.held >= 550], ['Tools 7', true, true]);

  // ── Count-in, scan as you go: a smaller camera box and square ──
  await P(`await go('#/count'); await click('.mode', 'Scan as you go'); await click('.cbody .btn', 'Start scanning'); await settle(400);`);
  const t3 = await P(`return await watch(() => !!byText('.wscan *', 'the code Tools7') || !!$('.wname'));`);
  check('count-in scan mode: the middle code is the one read, after a hold (its message names it, spaces removed as for item codes)', [!!t3.used, t3.holdBeforeUse, await P(`return !!byText('.wscan *', 'the code Tools7')`)], [true, true, true]);
  results.push(`INFO  count-in timings: ${JSON.stringify(t3)}; screen text: ${JSON.stringify(await P(`return norm($('.wscan')?.textContent ?? '').slice(0, 160)`))}`);
  await shot('02-count-scan');

  // ── Portrait: the square moves; aim follows it ──
  await size(800, 1280);
  await sleep(500);
  await P(`await go('#/inventory'); location.hash = '#/scan'; for (let i = 0; i < 300 && $('.cam')?.dataset.hold === undefined; i++) await settle(10);`);
  // Mid-hold: amber corners and a part-filled bar.
  await shot('03-portrait-holding');
  const mid = await P(`return [$('.cam')?.dataset.hold ?? null, getComputedStyle($('.reticle .a')).borderTopColor, !$('.spanel')]`);
  check('portrait: mid-hold the corners are amber and no panel yet', [mid[0], mid[1] !== 'rgb(255, 255, 255)', mid[2]], ['on', true, true]);
  await P(`for (let i = 0; i < 200 && !$('.spanel'); i++) await settle(20);`);
  check('portrait Scan tab: then Tools 7 (found now) is used', await P(`return norm($('.spanel .h2').textContent)`), 'Tools 7');
  await shot('04-portrait-used');
} catch (e) {
  results.push('ERROR ' + e.message);
  await shot('error').catch(() => {});
} finally {
  console.log(results.join('\n'));
  console.log(problems.length ? 'Console problems:\n' + problems.join('\n') : 'No console errors or warnings');
  ws.close();
  proc.kill();
  preview.kill();
  process.exit(0);
}
