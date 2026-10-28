// M16b (§18.7): tablet screenshots of every screen that uses the keypad, the on-hand stepper
// or the Add item form, at 1280 × 800 and in portrait, so a build's shots can be compared pixel
// by pixel with another build's (the phone layouts must not move the tablet layout).
// Usage: npm run build && node scripts/m16b-tablet-shots.mjs <chrome.exe> <screenshot dir> [port]
//        node scripts/m16b-tablet-shots.mjs --compare <dir A> <dir B>
import { tempDir, track } from './tmp-cleanup.mjs';
import { spawn } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { PIN_H } from './pin-helpers.mjs';

/** Decodes Chrome's screenshot PNGs (8-bit RGB or RGBA, not interlaced) to RGBA pixels. */
function decodePng(buf) {
  let pos = 8;
  let width = 0, height = 0, channels = 4;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('latin1', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8 || data[12] !== 0 || ![2, 6].includes(data[9])) throw new Error('unsupported PNG');
      channels = data[9] === 6 ? 4 : 3;
    } else if (type === 'IDAT') idat.push(data);
    pos += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(width * height * 4);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? line[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      const p = a + b - c;
      const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const add = f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : f === 4 ? (pa <= pb && pa <= pc ? a : pb <= pc ? b : c) : 0;
      line[x] = (line[x] + add) & 0xff;
    }
    for (let x = 0; x < width; x++) {
      for (let k = 0; k < 3; k++) out[(y * width + x) * 4 + k] = line[x * channels + k];
      out[(y * width + x) * 4 + 3] = channels === 4 ? line[x * channels + 3] : 255;
    }
    prev = line;
  }
  return { width, height, data: out };
}

if (process.argv[2] === '--compare') {
  const [a, b] = process.argv.slice(3);
  const names = readdirSync(a).filter((n) => n.endsWith('.png')).sort();
  let same = 0;
  for (const n of names) {
    let other;
    try {
      other = decodePng(readFileSync(join(b, n)));
    } catch {
      console.log(`MISSING  ${n}`);
      continue;
    }
    const one = decodePng(readFileSync(join(a, n)));
    if (one.width !== other.width || one.height !== other.height) {
      console.log(`SIZE  ${n}: ${one.width}×${one.height} vs ${other.width}×${other.height}`);
      continue;
    }
    // Pixels that differ, and the box around them, so a moved layout is told from photo noise.
    let diff = 0, x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
    for (let i = 0; i < one.data.length; i += 4) {
      if (one.data[i] !== other.data[i] || one.data[i + 1] !== other.data[i + 1] || one.data[i + 2] !== other.data[i + 2]) {
        diff++;
        const x = (i / 4) % one.width, y = Math.floor(i / 4 / one.width);
        x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
      }
    }
    if (diff === 0) same++;
    console.log(diff === 0 ? `SAME  ${n}` : `DIFF  ${n}: ${diff} pixels in x ${x0}–${x1}, y ${y0}–${y1}`);
  }
  console.log(`${same} of ${names.length} pixel-identical`);
  process.exit(0);
}

const [chrome, outDir, portArg = '4341'] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const preview = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', portArg, '--strictPort'], { stdio: 'ignore' });
const port = 9361;
// No fake camera: the camera screens show "no camera", which looks the same on every run.
const proc = spawn(chrome, ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--remote-debugging-port=${port}`, `--user-data-dir=${tempDir('cdp-')}`, 'about:blank'], { stdio: 'ignore' });
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
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
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
const shots = [];
const shot = async (name) => {
  // No caret, no animations, no toasts: only the layout is compared.
  await js(`document.activeElement?.blur(); document.querySelectorAll('.toast').forEach((t) => t.remove()); await new Promise((r) => setTimeout(r, 400));`);
  const r = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(outDir, name + '.png'), Buffer.from(r.result.data, 'base64'));
  shots.push(name);
};
const size = (width, height) => send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });

const PAGE = `
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const norm = (s) => s.replace(/\\s+/g, ' ').trim();
  const byText = (sel, t) => $$(sel).find((b) => norm(b.textContent).includes(t));
  const settle = (ms = 350) => new Promise((r) => setTimeout(r, ms));
  const click = async (sel, t) => { const b = byText(sel, t); if (!b) throw new Error('nothing like ' + sel + ' with text ' + t); b.click(); await settle(); return b; };
  const go = async (h) => { location.hash = h; await settle(900); };
  ${PIN_H}
`;
const P = (expr) => js(`${PAGE} ${expr}`);

const screens = async (tag) => {
  await P(`await go('#/inventory'); const h = $$('.cathdr').find((b) => b.getAttribute('aria-expanded') === 'false'); h?.click(); await settle(600);`);
  await shot(`${tag}-1-inventory-rows`);
  await P(`await go('#/item/st-0001');`);
  await shot(`${tag}-2-detail`);
  await P(`await go('#/add');`);
  await shot(`${tag}-3-add-item`);
  await P(`await go('#/count'); await settle(300); const b = $$('.cg-row .btn')[0]; b.click(); await settle(800);`);
  await shot(`${tag}-4-count-keypad`);
  await P(`await click('.top .btn', 'Pause'); await go('#/scan'); await settle(1500); const el = $('#mc'); el.value = 'st-0001'; el.dispatchEvent(new Event('input', { bubbles: true })); await settle(200); await click('.denied-type .btn', 'Find'); await settle(600);`);
  await shot(`${tag}-5-scan-found`);
};

let failed = null;
try {
  await send('Runtime.enable');
  await send('Page.enable');
  await size(1280, 800);
  await send('Page.navigate', { url: `http://localhost:${portArg}/` });
  await waitFor(`document.querySelector('.setup')`, 60000);
  await P(`await doSetup();`);
  await waitFor(`document.querySelectorAll('.cathdr').length >= 11`, 60000);
  // The same state every run: count mode by category, nothing paused.
  await js(`localStorage.clear();`);
  await screens('land');
  await size(800, 1280);
  await sleep(600);
  await screens('port');
} catch (e) {
  failed = e.message;
} finally {
  console.log(failed ? `ERROR ${failed}` : `${shots.length} screenshots in ${outDir}`);
  ws.close();
  proc.kill();
  preview.kill();
  process.exit(0);
}
