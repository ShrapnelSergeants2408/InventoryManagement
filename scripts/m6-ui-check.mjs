// M6 real-browser check: first-launch PIN setup, PIN pad, lock button and countdown, wrong
// tries and the wait, recovery code, change PIN, settings, relock at the unlock length, and the
// §6 gate matrix (every "required" action asks, every "not required" one doesn't).
// Usage: npm run build && node scripts/m6-ui-check.mjs <chrome.exe> <screenshot dir>
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PIN_H } from './pin-helpers.mjs';

const [chrome, outDir] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const preview = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', '4321', '--strictPort'], { stdio: 'ignore' });
const port = 9338;
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


// Direct IndexedDB edits (as time passing or another session would), file picking, toasts.
const EDIT = `
  const idbTx = (store, fn) => new Promise((res, rej) => {
    const r = indexedDB.open('frc2408-inventory');
    r.onsuccess = () => {
      const db = r.result;
      const t = db.transaction(store, 'readwrite');
      let out;
      Promise.resolve(fn(t.objectStore(store))).then((v) => (out = v));
      t.oncomplete = () => { db.close(); res(out); };
      t.onerror = () => rej(t.error);
    };
  });
  const idbEdit = (store, fn) => idbTx(store, (s) => { const q = s.openCursor(); q.onsuccess = () => { const c = q.result; if (!c) return; const v = fn(c.value); if (v) c.update(v); c.continue(); }; });
  const idbPut = (store, value) => idbTx(store, (s) => void s.put(value));
  const idbDelete = (store, key) => idbTx(store, (s) => void s.delete(key));
  const idbCount = (store) => new Promise((res) => idbTx(store, (s) => { const q = s.count(); q.onsuccess = () => res(q.result); }));
  // Hands a file to one of the screen's hidden file inputs (0 = restore, 1 = price CSV), as the picker would.
  const choose = async (index, name, data, type) => {
    const input = document.querySelectorAll('input[type=file]')[index];
    const dt = new DataTransfer();
    dt.items.add(new File([data], name, { type }));
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await settle(300);
  };
  const waitDlg = async (label, ms = 30000) => { const end = Date.now() + ms; while (Date.now() < end) { const d = dlg(label); if (d) return d; await settle(100); } throw new Error('no dialog ' + label); };
  const waitGone = async (sel, ms = 30000) => { const end = Date.now() + ms; while (Date.now() < end && document.querySelector(sel)) await settle(100); };
  const toast = () => norm(document.querySelector('.toast span')?.textContent ?? '');
  const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const cmpRows = () => [...document.querySelectorAll('.cmp tbody tr')].map((r) => [...r.cells].map((c) => norm(c.textContent)));
`;

const M6 = `
  const press = async (s) => { for (const d of s) { $$('.pkey').find((b) => norm(b.textContent) === d).click(); await settle(30); } };
  const dotsOn = () => $$('.pin-dots span.on').length;
  const pill = () => norm($('.top .lockpill').textContent);
  const key = async (k) => { dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })); await settle(40); };
  const unlock = async (pin = '2408') => { $('.top .lockpill').click(); await settle(300); await enterPin(pin); await settle(300); };
  const lock = async () => { $('.top .lockpill.on')?.click(); await settle(200); };
  // Runs an action while locked; true when the PIN pad appeared (then cancelled).
  const asks = async (fn) => {
    await fn();
    for (let i = 0; i < 8 && !pinDlg(); i++) await settle(100);
    const shown = !!pinDlg();
    if (shown) { byText('[aria-label="Mentor PIN"] button', 'Cancel').click(); await settle(300); }
    return shown;
  };
  const escape = async () => { dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await settle(300); };
`;
const CAPTURE = `
  window.__files = window.__files ?? [];
  HTMLAnchorElement.prototype.click = function () { if (this.download) fetch(this.href).then((r) => r.arrayBuffer()).then((b) => window.__files.push({ name: this.download, bytes: new Uint8Array(b) })); };
`;
const J = (expr) => js(M6 + expr);
const CODE_RE = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{5}-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{5}$/;

try {
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await size(1280, 800);
  await send('Page.navigate', { url: 'http://localhost:4321/' });
  await waitFor(`document.querySelector('.setup')`, 60000);
  await sleep(500);

  // ── First-launch setup (9f, 9g) ──
  check('a new tablet opens setup at step 1, without the app navigation or lock button', await J(`return [norm($('.setup-steps li.now').textContent), !$('.nav'), norm($('.pinpad .pin-sub').textContent), !$('.lockpill')]`), ['1Set mentor PIN', true, 'Choose 4–6 digits', true]);
  await shot('01-setup-pin');
  check('3 digits: Next disabled; a 7th digit is ignored', await J(`await press('123'); const d3 = $('.pin-go').disabled; await press('4567'); const n = dotsOn(); byText('.pkey', 'Clear').click(); await settle(100); return [d3, n, dotsOn()]`), [true, 6, 0]);
  check('⌫ deletes the last digit', await J(`await press('240'); $('.pkey[aria-label="Delete last digit"]').click(); await settle(80); const n = dotsOn(); byText('.pkey', 'Clear').click(); await settle(80); return n`), 2);
  check('PINs that don’t match: say so and start over', await J(`await enterPin('2408'); const again = norm($('.pin-sub').textContent); await enterPin('2409'); return [again, norm($('.pin-err').textContent), norm($('.pin-sub').textContent), dotsOn()]`), ['Type the same PIN again', 'The two PINs didn’t match. Choose the PIN again.', 'Choose 4–6 digits', 0]);
  check('keyboard digits and Enter work on the pad', await J(`for (const k of '2408') await key(k); await key('Enter'); await settle(200); return norm($('.pin-sub').textContent)`), 'Type the same PIN again');
  await J(`await enterPin('2408');`);
  check('step 2: a 10-character recovery code; Finish needs the tick', await J(`return [norm($('.setup-steps li.now').textContent), norm($('.rcode').textContent), byText('.recovery button', 'Finish setup').disabled]`).then(([s, c, d]) => [s, CODE_RE.test(c), d]), ['2Save recovery code', true, true]);
  await shot('02-setup-recovery');
  await send('Page.reload');
  await waitFor(`document.querySelector('.setup')`, 60000);
  await sleep(400);
  check('closed before “I wrote it down”: nothing saved, setup starts again', await J(`return [(await idb('settings', 'pinHash')) ?? null, (await idb('settings', 'recoveryHash')) ?? null, norm($('.setup-steps li.now').textContent)]`), [null, null, '1Set mentor PIN']);
  await J(`await enterPin('2408'); await enterPin('2408');`);
  const code1 = await J(`return norm($('.rcode').textContent)`);
  await J(`$('.recovery input[type=checkbox]').click(); await settle(150); byText('.recovery button', 'Finish setup').click(); await settle(800);`);
  await waitFor(`document.querySelectorAll('.cathdr').length >= 12`, 60000);
  check('after setup: inventory opens, locked; PIN and code stored hashed only', await J(`const p = await idb('settings', 'pinHash'); const r = await idb('settings', 'recoveryHash'); const all = JSON.stringify(await idb('settings')); return [pill(), p.value.alg, p.value.iter >= 100000, r.value.alg, all.includes('2408'), all.includes(${JSON.stringify(code1.replace('-', ''))})]`), ['Locked', 'PBKDF2-SHA256', true, 'PBKDF2-SHA256', false, false]);

  // ── PIN pad from the lock button (0b, 9b, 9c) ──
  check('lock button opens the PIN pad: why, and for how long', await J(`$('.top .lockpill').click(); await settle(300); return [norm(pinDlg().querySelector('.pin-sub').textContent), norm($('.pin-go').textContent), !!byText('.pin-foot button', 'Forgot PIN?')]`), ['Unlock mentor tools for 5 minutes', 'Unlock for 5 minutes', true]);
  check('wrong PIN: message with the count, digits cleared, pad stays', await J(`await enterPin('1111'); return [norm($('.pin-err').textContent), dotsOn(), !!pinDlg()]`), ['Wrong PIN. Try again — 1 wrong try so far.', 0, true]);
  await shot('03-pin-wrong');
  check('right PIN: unlocked, countdown on the lock button', await J(`await enterPin('2408'); await settle(200); return [!pinDlg(), /^Unlocked (5:00|4:59)$/.test(pill())]`), [true, true]);
  const t1 = await J(`return pill()`);
  await sleep(2200);
  check('the countdown ticks', await J(`return pill()`).then((t2) => [t1 !== t2, /^Unlocked 4:5\d$/.test(t2)]), [true, true]);
  await J(`await go('#/more');`);
  check('More while unlocked (9d): countdown card and Lock now', await J(`return [norm($('.lockcard.on h2').textContent), /^4:5\\d$/.test(norm($('.lock-big').textContent)), !!byText('.lockcard button', 'Lock now')]`), ['Mentor tools unlocked', true, true]);
  await shot('04-more-unlocked');
  check('Lock now locks at once', await J(`await click('.lockcard button', 'Lock now'); return [pill(), norm($('.lockcard.off h2').textContent)]`), ['Locked', 'Mentor tools locked']);
  check('tapping the unlocked lock button locks at once', await J(`await unlock(); const u = pill().startsWith('Unlocked'); $('.top .lockpill').click(); await settle(200); return [u, pill()]`), [true, 'Locked']);
  await J(`await unlock();`);
  await send('Page.reload');
  await waitFor(`document.querySelector('.lockcard')`, 60000);
  await sleep(500);
  check('reloading the app locks it (D6)', await J(`return pill()`), 'Locked');
  await shot('05-more-locked');

  // ── 5 wrong tries → 30-second wait (D6) ──
  await J(`$('.top .lockpill').click(); await settle(300); for (let i = 0; i < 5; i++) await enterPin('1111');`);
  check('5th wrong PIN: a 30-second wait, keys disabled', await J(`return [/^Too many wrong tries\\. Wait 0:(30|29|28), then try again\\.$/.test(norm($('.pin-err').textContent)), $$('.pkey').every((b) => b.disabled), $('.pin-go').disabled]`), [true, true, true]);
  await shot('06-pin-wait');
  await sleep(30500);
  check('after the wait the pad works again and the right PIN unlocks', await J(`const enabled = !$$('.pkey').find((b) => norm(b.textContent) === '5').disabled; const msg = norm($('.pin-err').textContent); await enterPin('2408'); await settle(200); return [enabled, msg, pill().startsWith('Unlocked')]`), [true, 'Wrong PIN. Try again — 5 wrong tries so far.', true]);
  await J(`await lock();`);

  // ── §6 gate matrix: locked, each action asks (required) or doesn't (not required) ──
  await J(`await go('#/more/locations'); await click('.top button', 'Add location'); await type('.dlg input', 'Bin M6a'); await click('.dlg button[type=submit]', 'Add location'); await click('.top button', 'Add location'); await type('.dlg input', 'Bin M6b'); await click('.dlg button[type=submit]', 'Add location');`);
  const required = await J(`
    const r = {};
    await go('#/item/st-0063'); r.deleteItem = await asks(() => click('.dacts button', 'Delete item'));
    await go('#/item/st-0063/edit'); r.editVendors = await asks(() => click('.lockbar button', 'Unlock'));
    await go('#/inventory'); await go('#/add'); r.secondVendorWhileAdding = await asks(() => click('.ecol button', 'Add vendor option'));
    await go('#/more/suppliers'); r.addSupplier = await asks(() => click('.top button', 'Add supplier'));
    r.renameSupplier = await asks(() => click('.srow button', 'Rename'));
    r.removeSupplier = await asks(() => click('.srow button', 'Remove'));
    await go('#/more/categories'); r.renameCategory = await asks(() => click('button.btn.sm', 'Rename'));
    r.removeCategory = await asks(() => click('button.btn.sm', 'Remove'));
    await go('#/more/locations'); r.renameLocation = await asks(() => click('.lrow button', 'Rename'));
    r.removeLocation = await asks(() => click('.lrow button', 'Remove'));
    await go('#/more/backup'); r.priceImport = await asks(() => choose(1, 'prices.csv', new TextEncoder().encode('id,v1_pack_price\\nst-0063,99.99\\n'), 'text/csv'));
    await go('#/more/settings'); r.changeSettings = await asks(() => click('.lockbar button', 'Unlock'));
    await go('#/more'); r.changePin = await asks(() => click('button.mrow', 'Change PIN'));
    return r;`);
  check('required (§6): every action asks for the PIN', required, { deleteItem: true, editVendors: true, secondVendorWhileAdding: true, addSupplier: true, renameSupplier: true, removeSupplier: true, renameCategory: true, removeCategory: true, renameLocation: true, removeLocation: true, priceImport: true, changeSettings: true, changePin: true });
  check('cancelled PIN steps changed nothing', await J(`const s = await idb('suppliers'); const v = (await idb('items', 'st-0063')).vendors[0]; return [s.length, v.packPriceCents, (await idb('locations')).map((l) => l.name).sort()]`), [9, 5500, ['Bin M6a', 'Bin M6b']]);
  const before = await J(`const i = await idb('items', 'st-0063'); return [i.onHand, i.desired, i.notes]`);
  const notRequired = await J(`
    const r = {};
    await go('#/item/st-0063'); r.onHandPlus = await asks(() => click('.dright button[aria-label="Plus one"]', ''));
    r.desiredPlus = await asks(() => click('.dright button[aria-label="Desired plus one"]', ''));
    await go('#/item/st-0063/edit'); r.editNotesAndSave = await asks(async () => { await type('textarea', 'Checked by M6'); await click('.top button', 'Save'); await settle(500); });
    await go('#/more/categories'); r.addCategory = await asks(() => click('.top button', 'Add category')); await escape();
    r.reorderCategory = await asks(async () => { await click('.top button', 'Reorder'); $$('button[aria-label^="Move "][aria-label$=" down"]').find((b) => !b.disabled).click(); await settle(300); await click('.top button', 'Done'); });
    await go('#/more/locations'); r.addLocation = await asks(async () => { await click('.top button', 'Add location'); await type('.dlg input', 'Bin M6c'); await click('.dlg button[type=submit]', 'Add location'); });
    r.reorderLocation = await asks(async () => { await click('.top button', 'Reorder'); await click('button[aria-label="Move Bin M6b up"]', ''); await click('.top button', 'Done'); });
    await go('#/more'); r.forgotPin = await asks(() => click('button.mrow', 'Forgot the PIN?')); await escape();
    r.openSettings = await asks(() => go('#/more/settings'));
    return r;`);
  check('not required (§6): no PIN asked', notRequired, { onHandPlus: false, desiredPlus: false, editNotesAndSave: false, addCategory: false, reorderCategory: false, addLocation: false, reorderLocation: false, forgotPin: false, openSettings: false });
  check('…and those changes were saved', await J(`const i = await idb('items', 'st-0063'); return [i.onHand, i.desired, i.notes, (await idb('locations')).sort((a, b) => a.order - b.order).map((l) => l.name)]`), [before[0] + 1, before[1] + 1, 'Checked by M6', ['Bin M6b', 'Bin M6a', 'Bin M6c']]);
  check('while unlocked nothing asks again, and vendor fields open straight away', await J(`await unlock(); await go('#/item/st-0063/edit'); const open = !$('.lockbar') && $$('.vopt input:disabled, .vopt select:disabled').length === 0; await go('#/more/suppliers'); const a = await asks(() => click('.top button', 'Add supplier')); const dlgOpen = !!dlg('Add a supplier'); await escape(); await lock(); return [open, a, dlgOpen]`), [true, false, true]);

  check('relocked while editing: saving a vendor change asks the PIN again', await J(`await unlock(); await go('#/item/st-0063/edit'); await lock(); await type('#v1-price', '61.00'); await click('.top button', 'Save'); await settle(300); const asked = !!pinDlg(); byText('[aria-label="Mentor PIN"] button', 'Cancel').click(); await settle(300); return [asked, (await idb('items', 'st-0063')).vendors[0].packPriceCents, location.hash]`), [true, 5500, '#/item/st-0063/edit']);
  check('…and with the PIN it saves', await J(`await click('.top button', 'Save'); await enterPin('2408'); await settle(700); const p = (await idb('items', 'st-0063')).vendors[0].packPriceCents; await lock(); return [p, location.hash]`), [6100, '#/item/st-0063']);

  // ── Escape closes only the PIN pad over the restore dialog (M5 finding 7) ──
  await J(CAPTURE + `await go('#/more/backup'); window.__files = []; $$('.bkopt')[1].click(); for (let i = 0; i < 100 && !window.__files.length; i++) await settle(100); const f = window.__files[0]; await choose(0, f.name, f.bytes, 'text/csv'); await waitDlg('Replace all inventory with this backup?'); $('.tick input').click(); await settle(150); await click('.dlg button', 'Replace everything');`);
  check('Escape on the PIN pad over Restore closes only the pad', await J(`const pad = !!pinDlg(); await escape(); return [pad, !pinDlg(), !!dlg('Replace all inventory with this backup?')]`), [true, true, true]);
  await J(`await escape();`);

  // ── Forgot PIN: recovery code → new PIN → new code (D6) ──
  await J(`await go('#/more'); await click('button.mrow', 'Forgot the PIN?');`);
  check('a wrong recovery code is refused with the count', await J(`await type('.rinput', 'ABCDE-FGHJK'); await click('.dlg button[type=submit]', 'Check the code'); return norm($('.pin-err').textContent)`), 'Wrong recovery code. Try again — 1 wrong try so far.');
  await shot('07-recovery');
  check('the right code (any capitals, no dash) leads to a new PIN', await J(`await type('.rinput', ${JSON.stringify(code1.replace('-', ' ').toLowerCase())}); await click('.dlg button[type=submit]', 'Check the code'); return norm($('.pinpad h2').textContent)`), 'Set a new mentor PIN');
  await J(`await enterPin('1357'); await enterPin('1357');`);
  const code2 = await J(`return norm($('.rcode').textContent)`);
  check('a new recovery code is shown; saving needs the tick', await J(`return byText('.recovery button', 'Save the new PIN').disabled`).then((d) => [CODE_RE.test(code2), code2 !== code1, d]), [true, true, true]);
  check('saved: unlocked, toast', await J(`$('.recovery input[type=checkbox]').click(); await settle(150); await click('.recovery button', 'Save the new PIN'); await settle(400); return [!dlg('Forgot the PIN?'), pill().startsWith('Unlocked'), norm($('.toast span')?.textContent ?? '')]`), [true, true, 'New PIN saved. Mentor tools are unlocked.']);
  check('old PIN refused, new PIN works', await J(`await lock(); await unlock('2408'); const old = !!pinDlg() && norm($('.pin-err').textContent).startsWith('Wrong PIN'); await enterPin('1357'); await settle(200); return [old, pill().startsWith('Unlocked')]`), [true, true]);
  await J(`await lock();`);
  check('the old recovery code no longer works (used once, replaced)', await J(`await click('button.mrow', 'Forgot the PIN?'); await type('.rinput', ${JSON.stringify(code1)}); await click('.dlg button[type=submit]', 'Check the code'); const r = norm($('.pin-err').textContent); await escape(); return r.startsWith('Wrong recovery code')`), true);
  check('“Forgot PIN?” on the PIN pad opens the recovery code', await J(`$('.top .lockpill').click(); await settle(300); await click('.pin-foot button', 'Forgot PIN?'); const ok = !!$('.rinput'); await escape(); return [ok, !pinDlg()]`), [true, true]);

  // ── Change PIN (needs the PIN; recovery code kept) ──
  check('Change PIN asks the PIN first', await J(`await click('button.mrow', 'Change PIN'); const p = !!pinDlg(); await enterPin('1357'); await settle(300); return [p, norm($('.pinpad h2').textContent)]`), [true, 'Change PIN']);
  check('new PIN typed twice is saved', await J(`await enterPin('2408'); await enterPin('2408'); await settle(300); return [!dlg('Change PIN'), norm($('.toast span')?.textContent ?? '')]`), [true, 'PIN changed. The recovery code stays the same.']);
  check('after Change PIN: new PIN works, old doesn’t, recovery code unchanged', await J(`await lock(); await unlock('1357'); const old = !!pinDlg(); await enterPin('2408'); await settle(200); const ok = pill().startsWith('Unlocked'); await lock(); await click('button.mrow', 'Forgot the PIN?'); await type('.rinput', ${JSON.stringify(code2)}); await click('.dlg button[type=submit]', 'Check the code'); const rec = norm($('.pinpad h2')?.textContent ?? ''); await escape(); return [old, ok, rec]`), [true, true, 'Set a new mentor PIN']);

  // ── Settings (S9) ──
  await J(`await go('#/more/settings');`);
  check('settings locked: values shown, fields dashed and disabled', await J(`return [$$('.setnum').map((i) => [i.value, i.disabled]), getComputedStyle($('.setnum')).borderStyle, !!$('.setform .lockbar')]`), [[['7', true], ['90', true], ['5', true]], 'dashed', true]);
  await shot('08-settings-locked');
  check('Unlock opens the fields', await J(`await click('.lockbar button', 'Unlock'); await enterPin('2408'); await settle(300); return [$$('.setnum').every((i) => !i.disabled), !$('.setform .lockbar')]`), [true, true]);
  check('out-of-range values are refused, by field', await J(`const [r, s, u] = $$('.setnum'); await type(r, '3'); await type(s, '6'); await type(u, '1'); await click('.top button', 'Save'); return [$$('.set-err').map((e) => norm(e.textContent)), (await idb('settings', 'staleDays'))?.value ?? null]`), [['Stale-price age must be a whole number of days from 7 to 365'], null]);
  check('saved: reminder 3, stale 30, unlock 1', await J(`await type($$('.setnum')[1], '30'); await click('.top button', 'Save'); return [norm($('.toast span').textContent), (await idb('settings', 'reminderDays')).value, (await idb('settings', 'staleDays')).value, (await idb('settings', 'unlockMinutes')).value]`), ['Settings saved.', 3, 30, 1]);
  await shot('09-settings-unlocked');
  check('More shows the new values', await J(`await go('#/more'); return norm(byText('button.mrow, a.mrow', 'Reminders').textContent)`), 'Reminders & limitsBackup reminder 3 days · stale price 30 days · unlock 1 minutePIN');
  check('the order list uses the new stale-price age', await J(`await go('#/order'); return norm($('.main').textContent).includes('>30 days')`), true);
  check('the new unlock length applies to the next unlock', await J(`await lock(); $('.top .lockpill').click(); await settle(300); const label = norm($('.pin-go').textContent); await enterPin('2408'); await settle(200); return [label, /^Unlocked (1:00|0:59)$/.test(pill())]`), ['Unlock for 1 minute', true]);
  await sleep(60500);
  check('relocks by itself at the unlock length', await J(`return pill()`), 'Locked');

  // ── Portrait, targets, text ──
  await J(`$('.top .lockpill').click(); await settle(300);`);
  await size(800, 1280);
  await sleep(400);
  await shot('10-pin-portrait');
  check('portrait: the PIN pad fits', await J(`const r = pinDlg().getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight`), true);
  check('PIN keys at least 68 px tall', await J(`return Math.min(...$$('.pkey').map((b) => b.getBoundingClientRect().height)) >= 68`), true);
  await J(`await escape();`);
  await size(1280, 800);
  await sleep(300);
  await J(`await go('#/more');`);
  check('touch targets ≥ 48 px (More)', await js(`return [...document.querySelectorAll('.main button, .main a, .top button')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.height < 47.5 || r.width < 47.5); }).map((e) => (e.getAttribute('aria-label') || e.textContent.trim()) + ' ' + Math.round(e.getBoundingClientRect().height))`), []);
  check('text ≥ 15 px (More, PIN pad)', await J(`$('.top .lockpill').click(); await settle(300); const bad = new Set(); for (const e of document.querySelectorAll('.main *, .dlg *')) { if (![...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue; const fs = parseFloat(getComputedStyle(e).fontSize); if (fs < 15 && e.getBoundingClientRect().width > 0) bad.add(e.className + ' ' + fs); } await escape(); return [...bad]`), []);
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
