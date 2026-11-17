// M32 real-browser check (SPEC v0.27): photos in a count kit are made small (320 px), the tablet keeps
// its own, and the kit's size is measured. First with the starter catalog's real photos, then with 200
// large photos (1024 × 768, busy, like vendor product shots) added to the tablet. Also: progress on the
// busy button, the size in the toast, and Send all kits reusing the small copies. Headless Chrome.
// Usage: npm run build && node scripts/m32-ui-check.mjs <chrome.exe> <screenshot dir>
import JSZip from 'jszip';
import { PIN_H } from './pin-helpers.mjs';
import { startCheck } from './check-lib.mjs';

const H = `
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const settle = (ms = 350) => new Promise((r) => setTimeout(r, ms));
  const norm = (s) => s.replace(/\\s+/g, ' ').trim();
  const byText = (sel, t) => $$(sel).find((b) => norm(b.textContent).includes(t));
  const click = async (sel, t) => { const b = byText(sel, t); if (!b) throw new Error('nothing like ' + sel + ' with text ' + t); b.click(); await settle(); return b; };
${PIN_H}
  const go = async (h) => { location.hash = h; await settle(700); };
  const toast = () => norm($('.toast span')?.textContent ?? '');
  const type = async (sel, v) => { const el = $(sel); el.focus(); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); await settle(300); };
  const group = async (name) => { const b = $$('.hgroup').find((x) => norm(x.querySelector('strong').textContent) === name); if (!b) throw new Error('no group ' + name); b.click(); await settle(150); };
  const card = (name) => $$('.hcard').find((c) => norm(c.querySelector('.h2').textContent) === name);
  const idbAll = (store) => new Promise((res, rej) => {
    const r = indexedDB.open('frc2408-inventory');
    r.onsuccess = () => { const db = r.result; const q = db.transaction(store).objectStore(store).getAll(); q.onsuccess = () => { res(q.result); db.close(); }; q.onerror = () => rej(q.error); };
    r.onerror = () => rej(r.error);
  });
  // The share sheet, caught: every file's name and bytes (base64), and when it was called.
  const catchShare = () => {
    window.__shared = null;
    navigator.canShare = () => true;
    navigator.share = async (d) => {
      const files = [];
      for (const f of d.files) {
        const b = new Uint8Array(await f.arrayBuffer());
        let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
        files.push({ name: f.name, size: f.size, b64: btoa(s) });
      }
      window.__shared = { files, at: performance.now() };
    };
  };
  // Every text the busy button shows while the kit is built.
  const watchButton = () => {
    window.__labels = new Set();
    const mo = new MutationObserver(() => { const b = $('.dlg-actions .btn.pri'); if (b) window.__labels.add(norm(b.textContent)); });
    mo.observe(document.body, { subtree: true, childList: true, characterData: true });
    window.__stopWatch = () => mo.disconnect();
  };
  // 200 items with a busy 1024 × 768 JPEG each, written straight into IndexedDB (like vendor photos).
  const addBigPhotos = async () => {
    const c = document.createElement('canvas'); c.width = 1024; c.height = 768;
    const g = c.getContext('2d');
    const r = indexedDB.open('frc2408-inventory');
    const db = await new Promise((res) => (r.onsuccess = () => res(r.result)));
    const base = await new Promise((res) => { const q = db.transaction('items').objectStore('items').getAll(); q.onsuccess = () => res(q.result[0]); });
    const blobs = [];
    for (let i = 0; i < 200; i++) {
      // Gradients and many small shapes: detail a JPEG can't squeeze much, like a product photo.
      const grad = g.createLinearGradient(0, 0, 1024, 768); grad.addColorStop(0, 'hsl(' + (i * 37) % 360 + ',60%,70%)'); grad.addColorStop(1, '#222');
      g.fillStyle = grad; g.fillRect(0, 0, 1024, 768);
      for (let k = 0; k < 1500; k++) { g.fillStyle = 'hsl(' + ((k * 13 + i) % 360) + ',70%,' + (30 + (k % 50)) + '%)'; g.fillRect((k * 97 + i * 31) % 1024, (k * 53 + i * 7) % 768, 3 + (k % 17), 3 + (k % 11)); }
      blobs.push(await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.85)));
    }
    const tx = db.transaction(['items', 'photos'], 'readwrite');
    for (let i = 0; i < 200; i++) {
      const id = 'big-' + String(i).padStart(3, '0');
      tx.objectStore('items').put({ ...base, id, name: 'Big photo part ' + i, barcode: '', hasPhoto: true });
      tx.objectStore('photos').put({ itemId: id, full: blobs[i], thumb: null, updatedAt: Date.now() });
    }
    await new Promise((res) => (tx.oncomplete = res));
    db.close();
  };
  const photoBytes = async () => (await idbAll('photos')).reduce((n, p) => n + p.full.size, 0);
`;

const { js, waitFor, check, shot, size, send, fail, finish } = await startCheck({ previewPort: 4370, cdpPort: 9400, prelude: () => H });

/** The kit the share sheet got: its size, and each photo's size and pixel dimensions. */
async function kitFrom(file) {
  const zip = await JSZip.loadAsync(Buffer.from(file.b64, 'base64'));
  const photos = Object.keys(zip.files).filter((n) => n.startsWith('photos/') && !n.endsWith('/'));
  const dims = [];
  for (const n of photos) {
    const b = await zip.file(n).async('uint8array');
    // JPEG size from the SOF0/SOF2 marker.
    let w = 0, h = 0;
    for (let i = 2; i < b.length - 9; ) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m === 0xc0 || m === 0xc2) { h = (b[i + 5] << 8) | b[i + 6]; w = (b[i + 7] << 8) | b[i + 8]; break; }
      i += 2 + ((b[i + 2] << 8) | b[i + 3]);
    }
    dims.push([w, h, b.length]);
  }
  return { size: file.size, photos: photos.length, dims };
}
const MB = (n) => (n / 1024 / 1024).toFixed(2) + ' MB';
const sizes = [];

try {
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await size(1280, 800);
  await send('Page.navigate', { url: 'http://localhost:4370/' });
  await waitFor(`document.querySelector('.setup')`, 60000);
  await js(`await doSetup();`);
  await waitFor(`document.querySelectorAll('.cathdr').length >= 11`, 60000);

  // ── A helper ──
  await js(`await go('#/count/helpers'); await click('.top .btn', 'Add helper'); await type('#hname', 'Kit size'); await group('Electrical'); await click('.dlg .btn', 'Add helper'); await settle(500);`);
  await waitFor(`!!card('Kit size')`);

  // ── Starter catalog: 128 real product photos ──
  const tablet1 = await js(`return [(await idbAll('photos')).length, await photoBytes()]`);
  await js(`catchShare(); watchButton(); card('Kit size').querySelector('.btn.pri').click(); await settle(600);`);
  check('the dialog says photos are made small', await js(`return norm($('.dlg .tog').textContent)`), 'Include photos (128 photos, made small for phones). Turn off for slow transfers like Bluetooth.');
  await shot('01-send-dialog');
  await js(`window.__t0 = performance.now(); await click('.dlg .btn', 'Send count kit');`);
  await waitFor(`window.__shared`, 120000);
  const first = await js(`window.__stopWatch(); return { file: window.__shared.files[0], ms: Math.round(window.__shared.at - window.__t0), labels: [...window.__labels] }`);
  const k1 = await kitFrom(first.file);
  sizes.push(`starter catalog: ${tablet1[0]} photos, ${MB(tablet1[1])} on the tablet → kit ${MB(k1.size)} (${first.ms} ms to build)`);
  check('every photo is in the kit', k1.photos, tablet1[0]);
  check('no kit photo is larger than 320 px on its long side', k1.dims.filter(([w, h]) => Math.max(w, h) > 320 || w === 0).length, 0);
  check('the busy button said how far making photos small got', first.labels.some((l) => /^Making photos small… \d+ of 128$/.test(l)), true);
  await waitFor(`/^Sent Kit_size_Helper\\.zip/.test(toast())`, 30000);
  check('the toast gives the kit size', await js(`return /^Sent Kit_size_Helper\\.zip \\([\\d.]+ [KM]B\\)\\.$/.test(toast())`), true);
  check('the tablet keeps its own photos, unchanged', await js(`return [(await idbAll('photos')).length, await photoBytes()]`), tablet1);

  // ── 200 large photos, like vendor product shots ──
  await js(`await addBigPhotos();`);
  await send('Page.reload');
  await waitFor(`document.querySelector('.main')`, 60000);
  await js(`await go('#/count/helpers');`);
  await waitFor(`!!card('Kit size')`);
  const tablet2 = await js(`return [(await idbAll('photos')).length, await photoBytes()]`);
  await js(`catchShare(); card('Kit size').querySelector('.btn.pri').click(); await settle(600); window.__t0 = performance.now(); await click('.dlg .btn', 'Send count kit');`);
  await waitFor(`window.__shared`, 180000);
  const second = await js(`return { file: window.__shared.files[0], ms: Math.round(window.__shared.at - window.__t0) }`);
  const k2 = await kitFrom(second.file);
  const big = k2.dims.filter(([w]) => w > 0);
  sizes.push(`with 200 large photos: ${tablet2[0]} photos, ${MB(tablet2[1])} on the tablet → kit ${MB(k2.size)} (${second.ms} ms to build, after a reload)`);
  check('with 200 large photos: every photo in the kit, none over 320 px', [k2.photos, big.filter(([w, h]) => Math.max(w, h) > 320).length], [tablet2[0], 0]);
  check('the kit is less than a fifth of the tablet’s photos', k2.size * 5 < tablet2[1], true);
  check('a large photo becomes 320 × 240', k2.dims.some(([w, h]) => w === 320 && h === 240), true);
  await waitFor(`/^Sent Kit_size_Helper\\.zip/.test(toast())`, 30000);

  // ── The same kit again: the small copies are reused ──
  await js(`catchShare(); await settle(6500); card('Kit size').querySelector('.btn.pri').click(); await settle(600); window.__t0 = performance.now(); await click('.dlg .btn', 'Send count kit');`);
  await waitFor(`window.__shared`, 180000);
  const third = await js(`return { file: window.__shared.files[0], ms: Math.round(window.__shared.at - window.__t0) }`);
  sizes.push(`the same kit again: ${third.ms} ms to build (small copies reused), kit ${MB(third.file.size)}`);
  const k3 = await kitFrom(third.file);
  const photoSum = (k) => k.dims.reduce((n, d) => n + d[2], 0);
  // The kit id and time differ, so the ZIPs aren't byte for byte equal; the photos are.
  check('the next kit reuses the small copies: same photos, built at least twice as fast', [photoSum(k3) === photoSum(k2), third.ms * 2 < second.ms], [true, true]);
  await shot('02-sent');
} catch (e) {
  await fail(e);
} finally {
  console.log(sizes.map((s) => 'SIZE  ' + s).join('\n'));
  await finish();
}
