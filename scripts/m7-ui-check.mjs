// M7 real-browser check: take, choose, replace and remove part photos (F19, SPEC §8), with no
// PIN. Pictures are made in the page (canvas) and handed to the file inputs; the enlarged
// photo's Replace button is checked through Chrome's file chooser.
// Usage: npm run build && node scripts/m7-ui-check.mjs <chrome.exe> <screenshot dir>
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PIN_H } from './pin-helpers.mjs';

const [chrome, outDir] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const preview = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', '4327', '--strictPort'], { stdio: 'ignore' });
const port = 9343;
const proc = spawn(chrome, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'cdp-'))}`, 'about:blank'], { stdio: 'ignore' });

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


// Pictures made in the page, the photo helpers, and IndexedDB reads of the stored photo.
const P = `
  const picture = async (w, h, type = 'image/jpeg', alpha = false) => {
    const c = new OffscreenCanvas(w, h);
    const g = c.getContext('2d');
    if (!alpha) { g.fillStyle = '#c04020'; g.fillRect(0, 0, w, h); }
    g.fillStyle = '#2040c0'; g.fillRect(0, 0, w / 2, h / 2);
    const b = await c.convertToBlob({ type, quality: 0.9 });
    return new File([b], 'pic.' + type.split('/')[1], { type });
  };
  const give = async (which, file) => {
    const input = document.querySelector('input[data-photo=' + which + ']');
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    for (let i = 0; i < 100 && document.querySelector('.pacts[aria-busy=true]'); i++) await settle(100);
    await settle(400);
  };
  const dims = async (blob) => { const b = await createImageBitmap(blob); const r = [b.width, b.height]; b.close(); return r; };
  const stored = async (id) => {
    const row = await idb('photos', id);
    if (!row) return null;
    return { full: [...(await dims(row.full)), row.full.type], thumb: row.thumb ? await dims(row.thumb) : null, taken: typeof row.taken === 'number' };
  };
  const toast = () => norm(document.querySelector('.toast span')?.textContent ?? '');
  const closeToast = async () => { document.querySelector('.toast .btn')?.click(); await settle(150); };
  const camLabel = () => norm(document.querySelector('input[data-photo=camera]').closest('label').textContent);
  const removeBtn = () => byText('.pacts button', 'Remove');
  const rowThumb = () => document.querySelector('a.rlink[href="#/item/st-0099"] img.thumb');
`;
const jsP = (expr) => js(`${P} ${expr}`);

try {
  await send('Runtime.enable');
  await send('Page.enable');
  await send('DOM.enable');
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await size(1280, 800);
  await send('Page.navigate', { url: 'http://localhost:4327/' });
  await waitFor(`document.querySelector('.setup')`, 60000);
  await js(`await doSetup();`);
  await waitFor(`document.querySelectorAll('.cathdr').length >= 11`, 60000);
  await js(COUNT_GATES);

  // ── No photo yet (mockup 2d) ──
  await js(`await go('#/item/st-0099'); await settle(400);`);
  check('no-photo card: placeholder, Take photo and Gallery, no Remove, note (2d)', await jsP(`return [[...$('.photo.nophoto').children].map((e) => norm(e.textContent)).filter(Boolean).join(' '), [...document.querySelectorAll('.dphoto .pacts > *')].map((e) => norm(e.textContent)), norm($('.dphoto > .small').textContent)]`), ['No photo yet Add one so students can recognize the part.', ['Take photo', 'Gallery'], 'Photos are optional; one per item.']);
  check('camera button opens the camera; Gallery opens the picker', await js(`return [...document.querySelectorAll('input[data-photo]')].map((i) => [i.dataset.photo, i.type, i.accept, i.getAttribute('capture')])`), [['camera', 'file', 'image/*', 'environment'], ['gallery', 'file', 'image/*', null]]);
  await shot('01-detail-nophoto');

  // ── Gallery: a big landscape picture is resized to 1024 px (§8) ──
  await jsP(`await give('gallery', await picture(4000, 3000));`);
  check('landscape 4000×3000 stored as a 1024×768 JPEG with a 160×120 thumbnail; no PIN', await jsP(`return [await stored('st-0099'), (await idb('items', 'st-0099')).hasPhoto, gates(), toast()]`), [{ full: [1024, 768, 'image/jpeg'], thumb: [160, 120], taken: true }, true, 0, 'Photo saved.']);
  check('card shows the photo; Retake, Gallery, Remove; "Team photo."', await jsP(`await closeToast(); return [!!$('.photo img'), [...document.querySelectorAll('.dphoto .pacts > *')].map((e) => norm(e.textContent)), norm($('.dphoto > .small').textContent)]`), [true, ['Retake', 'Gallery', 'Remove'], 'Team photo.']);
  check('last change recorded (backup reminder and restore compare)', await js(`return typeof (await idb('settings', 'lastChangeAt'))?.value`), 'number');
  await shot('02-detail-photo');

  // ── The list thumbnail follows a replaced photo without a reload (F2) ──
  await js(`await go('#/inventory'); for (const [sel, t] of [['.cathdr', 'Electrical'], ['.subhdr', 'Control System']]) { const h = [...document.querySelectorAll(sel)].find((b) => b.textContent.includes(t)); if (h.getAttribute('aria-expanded') !== 'true') { h.click(); await settle(400); } } document.querySelector('a.rlink[href="#/item/st-0099"]').scrollIntoView(); await settle(800);`);
  check('row thumbnail is the new photo (160×120)', await jsP(`const i = rowThumb(); return i ? [i.naturalWidth, i.naturalHeight] : null`), [160, 120]);
  await js(`await go('#/item/st-0099'); await settle(400);`);
  await jsP(`await give('camera', await picture(1500, 3000));`);
  check('camera: portrait 1500×3000 replaces it as 512×1024 (80×160 thumbnail)', await jsP(`return [await stored('st-0099'), gates()]`), [{ full: [512, 1024, 'image/jpeg'], thumb: [80, 160], taken: true }, 0]);
  // The delete confirmation's thumbnail stays mounted on the card while the photo changes.
  await jsP(`await closeToast(); await click('.dacts button', 'Delete item'); await answerGate(true, true); await settle(600);`);
  check('delete confirmation shows the replaced photo (80×160), not the old one', await js(`const i = dlg('Delete item')?.querySelector('.del-thumb'); return i ? [i.naturalWidth, i.naturalHeight] : null`), [80, 160]);
  await js(`await click('.dlg button', 'Keep item'); await relockNow(); window.__gates = 0;`); // Delete needs the PIN (F8); photos don't
  await js(`history.back(); await settle(900); document.querySelector('a.rlink[href="#/item/st-0099"]')?.scrollIntoView(); await settle(800);`);
  check('back on the list, the row thumbnail is the replacement (80×160)', await jsP(`const i = rowThumb(); return i ? [i.naturalWidth, i.naturalHeight] : null`), [80, 160]);

  // ── Small and transparent pictures; bad files ──
  await js(`await go('#/item/st-0099'); await settle(400);`);
  await jsP(`await closeToast(); await give('gallery', await picture(300, 200, 'image/png', true));`);
  check('small transparent PNG is not upscaled and becomes a JPEG on white', await jsP(`const row = await idb('photos', 'st-0099'); const b = await createImageBitmap(row.full); const c = new OffscreenCanvas(1, 1).getContext('2d'); c.drawImage(b, 290, 190, 1, 1, 0, 0, 1, 1); const px = [...c.getImageData(0, 0, 1, 1).data].slice(0, 3).every((v) => v > 240); return [await stored('st-0099'), px]`), [{ full: [300, 200, 'image/jpeg'], thumb: [160, 107], taken: true }, true]);
  const before = await jsP(`await closeToast(); return (await idb('photos', 'st-0099')).updatedAt`);
  await jsP(`await give('gallery', new File(['hello'], 'notes.txt', { type: 'text/plain' }));`);
  check('a text file is refused with a message; the photo is unchanged', await jsP(`return [toast(), (await idb('photos', 'st-0099')).updatedAt === ${before}]`), ['That file isn’t a picture. Choose a photo (JPEG or PNG).', true]);
  await jsP(`await closeToast(); await give('gallery', new File([new Uint8Array([0xff, 0xd8, 1, 2, 3, 4])], 'broken.jpg', { type: 'image/jpeg' }));`);
  check('a broken JPEG is refused with a message; the photo is unchanged', await jsP(`return [toast(), (await idb('photos', 'st-0099')).updatedAt === ${before}, document.querySelectorAll('.pacts[aria-busy=true]').length]`), ['This tablet can’t read that picture. Try a JPEG or PNG, or take a new photo.', true, 0]);

  // ── Remove (no PIN; confirmation, since there is no undo) ──
  await jsP(`await closeToast(); removeBtn().click(); await settle();`);
  check('Remove asks first (no PIN pad)', await js(`const d = dlg('Remove photo'); return [!!d, d && norm(d.querySelector('.dlg-p').textContent), gates()]`), [true, 'The photo is deleted from this tablet. Backups made before now still have it.', 0]);
  await shot('03-remove-confirm');
  await js(`await click('.dlg button', 'Keep photo');`);
  check('Keep photo keeps it', await jsP(`return [!!dlg('Remove photo'), !!(await idb('photos', 'st-0099'))]`), [false, true]);
  await jsP(`removeBtn().click(); await settle(); await click('.dlg button', 'Remove photo'); await settle(500);`);
  check('Remove photo: row gone, hasPhoto false, card back to "No photo yet", no PIN', await jsP(`return [await idb('photos', 'st-0099') ?? null, (await idb('items', 'st-0099')).hasPhoto, norm($('.nophoto-t').textContent), camLabel(), !!removeBtn(), gates(), toast()]`), [null, false, 'No photo yet', 'Take photo', false, 0, 'Photo removed.']);

  // ── Starter vendor photo, enlarged, Replace opens the camera ──
  await jsP(`await closeToast(); await go('#/item/st-0063'); await settle(600);`);
  check('starter photo note (§8)', await js(`return norm(document.querySelector('.dphoto > .small').textContent)`), 'Vendor product photo from the starter catalog. Replace it with a photo of your own part any time.');
  await js(`document.querySelector('.photo').click(); await settle(400);`);
  check('enlarged photo has Replace with my photo and Close (2b)', await js(`return [...document.querySelectorAll('.lb .btn')].map((b) => norm(b.textContent))`), ['Replace with my photo', 'Close']);
  await shot('04-lightbox');
  await send('Page.setInterceptFileChooserDialog', { enabled: true });
  // A real tap (CDP mouse events): Chrome opens a file chooser only from a user gesture.
  const at = await js(`const r = byText('.lb .btn', 'Replace with my photo').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]`);
  for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: at[0], y: at[1], button: 'left', clickCount: 1 });
  await js(`await settle(400);`);
  await sleep(300);
  check('Replace opens the camera chooser and closes the enlarged view', [choosers.length, await js(`return !!document.querySelector('.lb')`)], [1, false]);
  if (choosers[0]) {
    // The camera input gets a real seed JPEG (a vendor photo), like a picture from the camera.
    const JSZip = (await import('jszip')).default;
    const { readFileSync } = await import('node:fs');
    const zip = await JSZip.loadAsync(readFileSync('seed/frc2408-starter-catalog-2026-10-21.zip'));
    const file = join(mkdtempSync(join(tmpdir(), 'm7-')), 'camera.jpg');
    writeFileSync(file, await zip.file('photos/st-0001.jpg').async('nodebuffer'));
    await send('DOM.setFileInputFiles', { files: [file], backendNodeId: choosers[0].backendNodeId });
    await js(`for (let i = 0; i < 50 && document.querySelector('.pacts[aria-busy=true]'); i++) await settle(100); await settle(700);`);
    check('the chooser was the camera input; its picture replaced the vendor photo', await jsP(`const r = await stored('st-0063'); return [r.taken, r.full[2], Math.max(r.full[0], r.full[1]) <= 1024, norm($('.dphoto > .small').textContent), gates()]`), [true, 'image/jpeg', true, 'Team photo.', 0]);
  }
  await send('Page.setInterceptFileChooserDialog', { enabled: false });

  // ── Editor: photo changes wait for Save (mockup 3a) ──
  await jsP(`await closeToast(); await go('#/item/st-0063/edit'); await settle(600);`);
  check('editor photo row: current photo, Take photo, Gallery, Remove; no PIN mark', await js(`return [document.querySelector('.photo-row img')?.alt, [...document.querySelectorAll('.photo-row .pacts > *')].map((e) => norm(e.textContent)), document.querySelectorAll('.photo-row .pinmark, .photo-row .chip.lock').length]`), ['Current photo', ['Take photo', 'Gallery', 'Remove'], 0]);
  await shot('05-edit-photo');
  await js(`byText('.photo-row button', 'Remove').click(); await settle();`);
  check('Remove in the editor only marks it; nothing stored yet', await jsP(`return [!!document.querySelector('.photo-row img'), norm(document.querySelector('.photo-side > .small').textContent), !!(await idb('photos', 'st-0063'))]`), [false, 'The photo is removed when you save.', true]);
  await js(`await click('.top button', 'Cancel');`);
  check('Cancel after a photo change asks to discard', await js(`return !!dlg('Discard changes')`), true);
  await js(`await click('.dlg button', 'Discard changes'); await settle(500);`);
  check('discarding keeps the stored photo', await js(`return [!!(await idb('photos', 'st-0063')), (await idb('items', 'st-0063')).hasPhoto]`), [true, true]);
  await js(`await go('#/item/st-0063/edit'); await settle(600); byText('.photo-row button', 'Remove').click(); await settle(); await click('.top button', 'Save'); await settle(700);`);
  check('Save with Remove: photo gone, hasPhoto false, no PIN', await js(`return [await idb('photos', 'st-0063') ?? null, (await idb('items', 'st-0063')).hasPhoto, gates()]`), [null, false, 0]);
  await jsP(`await closeToast(); await go('#/item/st-0063/edit'); await settle(600); await give('gallery', await picture(2048, 1024));`);
  check('a picked photo shows as "New photo" before saving; not stored yet', await jsP(`return [document.querySelector('.photo-row img')?.alt, norm(document.querySelector('.photo-side > .small').textContent), await idb('photos', 'st-0063') ?? null]`), ['New photo', 'New photo: saved with the item.', null]);
  await js(`await type('#nt', 'photo test note'); await click('.top button', 'Save'); await settle(700);`);
  check('Save stores the photo and the note together (1024×512); no PIN', await jsP(`return [await stored('st-0063'), (await idb('items', 'st-0063')).hasPhoto, (await idb('items', 'st-0063')).notes, gates()]`), [{ full: [1024, 512, 'image/jpeg'], thumb: [160, 80], taken: true }, true, 'photo test note', 0]);

  // ── Add item with a photo (F6) ──
  await jsP(`await closeToast(); await go('#/add'); await settle(500); await type('#nm', 'Photo test bracket'); await pick('#v1-sup', 'REV'); await give('camera', await picture(800, 600));`);
  check('Add form: photo taken before the item exists; Remove drops it again', await js(`const a = document.querySelector('.photo-row img')?.alt; byText('.photo-row button', 'Remove').click(); await settle(); return [a, !!document.querySelector('.photo-row img'), [...document.querySelectorAll('.photo-row .pacts > *')].map((e) => norm(e.textContent))]`), ['New photo', false, ['Take photo', 'Gallery']]);
  await jsP(`await give('camera', await picture(800, 600)); await click('.top button', 'Add item'); await settle(800);`);
  const newId = await js(`return decodeURIComponent(location.hash.split('/')[2] ?? '')`);
  check('Add item saves the photo with the new item (800×600 kept); no PIN', await jsP(`return [/^tm-/.test(${JSON.stringify(newId)}), await stored(${JSON.stringify(newId)}), (await idb('items', ${JSON.stringify(newId)})).hasPhoto, !!$('.photo img'), gates()]`), [true, { full: [800, 600, 'image/jpeg'], thumb: [160, 120], taken: true }, true, true, 0]);

  // ── Every item with a photo row and only those (hasPhoto consistency, whole tablet) ──
  check('photo rows and hasPhoto agree for every item', await js(`const items = await idb('items'); const photos = await idb('photos'); const a = items.filter((i) => i.hasPhoto).map((i) => i.id).sort(); const b = photos.map((p) => p.itemId).sort(); return [JSON.stringify(a) === JSON.stringify(b), a.length]`), [true, 129]); // 128 starter photos + the new item's

  // ── Portrait, touch targets, text size ──
  await jsP(`await closeToast();`);
  await size(800, 1280);
  await js(`await go('#/item/st-0099'); await settle(400);`);
  await shot('06-detail-nophoto-portrait');
  await js(`await go('#/item/st-0063/edit'); await settle(400);`);
  await shot('07-edit-portrait');
  check('no horizontal overflow in portrait (detail, edit)', await js(`const out = []; for (const h of ['#/item/st-0099', '#/item/st-0063', '#/item/st-0063/edit']) { await go(h); await settle(300); if (document.documentElement.scrollWidth > innerWidth) out.push(h); } return out`), []);
  await size(1280, 800);
  const small = [];
  for (const h of ['#/item/st-0099', '#/item/st-0063', '#/item/st-0063/edit', '#/add']) {
    small.push(...(await js(`await go('${h}'); await settle(300); return [...document.querySelectorAll('button, a, input, select, textarea, label.btn')].filter((e) => { if (e.classList.contains('vh')) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (r.height < 47.5 || r.width < 47.5) && !e.closest('.nav'); }).map((e) => '${h} ' + (e.getAttribute('aria-label') || e.textContent.trim() || e.tagName) + ' ' + Math.round(e.getBoundingClientRect().width) + 'x' + Math.round(e.getBoundingClientRect().height))`)));
  }
  check('touch targets ≥ 48 px, photo buttons included', small, []);
  check('hidden file inputs are keyboard-reachable inside their buttons', await js(`await go('#/item/st-0099'); await settle(300); const i = document.querySelector('input[data-photo=camera]'); i.focus(); return [document.activeElement === i, getComputedStyle(i.closest('label')).outlineStyle]`), [true, 'solid']);
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
