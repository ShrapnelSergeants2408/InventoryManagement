// M28 real-browser check (SPEC v0.23): finding the count kit in Google Drive from "Join as a helper".
// Besides the file list, the helper can open Google Drive (or the team's Kits folder) in the browser, or
// scan the Kits QR code from the shop tablet and open the folder it points to. Chrome's fake camera plays a
// QR code holding the Kits folder link. Real IndexedDB, headless Chrome.
// Usage: npm run build && node scripts/m28-ui-check.mjs <chrome.exe> <screenshot dir>
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import qrcode from 'qrcode-generator';
import { tempDir } from './tmp-cleanup.mjs';
import { PIN_H } from './pin-helpers.mjs';
import { startCheck } from './check-lib.mjs';

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

const KITS = 'https://drive.google.com/drive/folders/KITS1';

// The fake camera: the Kits folder link as a QR code, black on white.
const camDir = tempDir('m28-cam-');
mkdirSync(camDir, { recursive: true });
const camVideo = join(camDir, 'kits.y4m');
{
  const qr = qrcode(0, 'M');
  qr.addData(KITS, 'Byte');
  qr.make();
  const n = qr.getModuleCount();
  const W = 640, H2 = 480, cell = 8;
  const x0 = Math.floor((W - n * cell) / 2), y0 = Math.floor((H2 - n * cell) / 2);
  const Y = Buffer.alloc(W * H2, 235);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) for (let dy = 0; dy < cell; dy++) Y.fill(16, (y0 + r * cell + dy) * W + x0 + c * cell, (y0 + r * cell + dy) * W + x0 + (c + 1) * cell);
  const UV = Buffer.alloc((W / 2) * (H2 / 2), 128);
  const frame = Buffer.concat([Buffer.from('FRAME\n'), Y, UV, UV]);
  writeFileSync(camVideo, Buffer.concat([Buffer.from(`YUV4MPEG2 W${W} H${H2} F10:1 Ip A1:1 C420jpeg\n`), ...Array(10).fill(frame)]));
}

const { js, waitFor, check, shot, size, send, fail, finish } = await startCheck({
  previewPort: 4367,
  cdpPort: 9397,
  prelude: () => H,
  chromeArgs: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${camVideo}`],
});

try {
  await send('Runtime.enable');
  await send('Page.enable');
  await size(390, 844);
  await send('Page.navigate', { url: 'http://localhost:4367/' });
  await waitFor(`document.querySelector('.role-opt')`, 60000);
  await js(`await click('.role-opt', 'Join as a helper'); await settle(500);`);

  check('Join as a helper: Choose the count kit, plus Open Google Drive and Scan the Kits QR code', await js(`return [norm($('.kitpick .btn.pri').textContent), norm($('.kitfind a').textContent), norm($('.kitfind button').textContent)]`), ['Choose the count kit…', 'Open Google Drive', 'Scan the Kits QR code']);
  check('Open Google Drive goes to Drive in a new tab', await js(`const a = $('.kitfind a'); return [a.getAttribute('href'), a.target, a.rel]`), ['https://drive.google.com/', '_blank', 'noopener noreferrer']);
  check('the page says what to do when Drive isn’t in the file list', await js(`return norm($('.kitfind .small').textContent).includes('open the Kits folder in Drive, download your kit, then choose it here from Downloads')`), true);
  check('the picker has no file-type filter', await js(`return $('.kitpick input[type=file]').getAttribute('accept')`), null);
  check('phone width: nothing wider than the screen; the buttons are at least 48 px tall', await js(`return [document.documentElement.scrollWidth <= innerWidth, [...document.querySelectorAll('.kitfind a, .kitfind button, .kitpick .btn')].every((b) => b.getBoundingClientRect().height >= 47.5)]`), [true, true]);
  await shot('01-join-kit-picker');

  // ── Scan the Kits QR code ──
  await js(`await click('.kitfind button', 'Scan the Kits QR code'); await settle(500);`);
  check('the scan dialog opens with the camera', await js(`return [norm($('.dlg .h2').textContent), !!$('.dlg video')]`), ['Scan the Kits QR code', true]);
  await waitFor(`[...document.querySelectorAll('.dlg a.btn')].some((a) => a.textContent.includes('Open the Kits folder'))`, 30000);
  await shot('02-kits-folder-found');
  check('the code is read: the folder is shown and Open the Kits folder is a link to it', await js(`const a = byText('.dlg a.btn', 'Open the Kits folder'); return [norm($('.kitfind-url').textContent), a.getAttribute('href'), a.target, a.rel]`), ['drive.google.com/drive/folders/KITS1', KITS, '_blank', 'noopener noreferrer']);
  // The fake camera keeps showing the code, so after Scan again it is read again at once.
  await js(`await click('.dlg .btn', 'Scan again');`);
  await waitFor(`[...document.querySelectorAll('.dlg a.btn')].some((a) => a.textContent.includes('Open the Kits folder'))`, 30000);
  check('Scan again reads it again', await js(`return norm($('.kitfind-url').textContent)`), 'drive.google.com/drive/folders/KITS1');
  await js(`await click('.dlg .btn', 'Close'); await settle(300);`);
  check('Close leaves the picker', await js(`return [!$('.dlg'), !!$('.kitpick .btn.pri')]`), [true, true]);
} catch (e) {
  await fail(e);
}
await finish();
