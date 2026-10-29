// M19 real-browser check: placed orders (F30), receiving (F31), on order (§4), the price copy
// (§21.3), receipts (§21.2), edit / cancel / delete (§21.4), a named list emptied by Mark
// ordered, and orders through a full backup and restore (§21.6), with real IndexedDB.
// Usage: npm run build && node scripts/m19-ui-check.mjs <chrome.exe> <screenshot dir>
import { tempDir, track } from './tmp-cleanup.mjs';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PIN_H } from './pin-helpers.mjs';

const [chrome, outDir] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const preview = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', '4352', '--strictPort'], { stdio: 'ignore' });
const port = 9382;
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

try {
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await size(1280, 800);
  await send('Page.navigate', { url: 'http://localhost:4352/' });
  await waitFor(`document.querySelector('.setup')`, 60000);
  await js(`await doSetup();`);
  await waitFor(`document.querySelectorAll('.cathdr').length >= 11`, 60000);

  // ── The automatic list: Mark ordered on each group; a Placed orders tab ──
  await js(`await go('#/order');`);
  await waitFor(`document.querySelector('.shdr')`);
  check('every supplier group has Mark ordered…, and there is a Placed orders tab', await js(`return [$$('.shdr').length > 3, $$('.shdr').every((s) => [...s.querySelectorAll('button')].some((b) => norm(b.textContent).startsWith('Mark ordered'))), !!byText('.ltab', 'Placed orders')]`), [true, true, true]);
  const before = await js(`const g = group('REV'); return { total: norm($('.gt-v').textContent), lines: [...g.parentElement.querySelectorAll('.line')].length, subtotal: norm(g.querySelector('.subtotal').textContent) }`);
  const rev = await js(`
    // The first two REV lines on the list, as the database holds the items.
    const items = await idb('items');
    const names = [...group('REV').parentElement.querySelectorAll('.line .lt')].slice(0, 2).map((e) => norm(e.textContent));
    return names.map((n) => { const it = items.find((i) => i.name === n); const v = it.vendors[it.preferredVendor - 1]; return { id: it.id, name: n, packSize: v.packSize, price: v.packPriceCents, need: it.desired + it.spares - it.onHand }; });`);

  // ── Locked: the PIN is asked before the form opens ──
  await js(`markBtn('REV').click(); await answerGate(true, true); await waitDlg('Mark ordered: REV');`);
  check('form lists every REV line, ticked, with the list’s packs and the stored price', await js(`const rows = formRows(); return [rows.length, rows.every((r) => r.querySelector('input[type=checkbox]').checked), rowInput(rows[0], 'Pack price of').value === (${rev[0].price} / 100).toFixed(2)]`), [before.lines, true, true]);
  await shot('01-mark-ordered-form');

  // Untick everything but the first two lines; the first was charged $12.34 for 2 packs.
  await js(`const rows = formRows(); for (const r of rows.slice(2)) { r.querySelector('input[type=checkbox]').click(); await settle(30); }
            await type(rowInput(formRows()[0], 'Packs of'), '2'); await type(rowInput(formRows()[0], 'Pack price of'), '12.34');`);
  await js(`await click('.of-add button', 'Add a typed line'); const r = formRows().at(-1); await type(r.querySelector('input[aria-label=Description]'), 'Team shirts'); await type(rowInput(r, 'Packs of'), '3'); await type(rowInput(r, 'Pack size of'), '2'); await type(rowInput(r, 'Unit of'), 'shirt'); await type(rowInput(r, 'Pack price of'), '15');`);
  check('a typed line takes its own pack size and unit (M19 detail (c))', await js(`return norm(formRows().at(-1).querySelector('.of-total').textContent)`), '$45.00 6 shirt');
  await js(`await type(field('Order / invoice'), 'INV-77'); await type(field('Payment'), 'PO 2408-17'); await type(field('Tax'), '4.10'); await type(field('Shipping'), '9.95'); await type(field('Other fees'), '1');
            await click('.segb', '%'); await type('input[aria-label="Discount in percent"]', '10');`);
  const line2Packs = await js(`return Number(rowInput(formRows()[1], 'Packs of').value)`);
  const parts = 2 * 1234 + line2Packs * rev[1].price + 3 * 1500;
  const discount = Math.floor((parts * 1000 + 5000) / 10000);
  const total = parts - discount + 410 + 995 + 100;
  check('the total updates as you type: parts − 10% + tax + shipping + fees', await js(`return norm($('.of-grand').textContent)`), `Total $${(total / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  check('unticked lines say “not ordered”; the button counts ticked lines', await js(`return [norm(formRows()[2].querySelector('.of-total').textContent), norm(byText('.dlg button', 'Record order').textContent)]`), ['not ordered', 'Record order (3 lines)']);
  await shot('02-form-filled');

  // A bad value blocks saving and is named.
  await js(`await type(field('Shipping'), '-2'); await click('.dlg button', 'Record order');`);
  check('a bad amount is named and nothing is saved', await js(`return [norm(field('Shipping').parentElement.querySelector('.err')?.textContent ?? ''), (await idb('orders')).length]`), ['Enter an amount of $0.00 or more.', 0]);
  await js(`await type(field('Shipping'), '9.95'); await click('.dlg button', 'Record order'); await waitDlg('Update catalog prices?');`);
  check('price copy offers the changed price, ticked, and “mark unchanged as checked”', await js(`const d = dlg('Update catalog prices?'); return [norm(d.querySelector('.pc-list')?.textContent ?? ''), [...d.querySelectorAll('input[type=checkbox]')].every((c) => c.checked), /Also mark the 1 unchanged price as checked/.test(norm(d.textContent))]`), [`${rev[0].name}: ${'$' + (rev[0].price / 100).toFixed(2)} → $12.34`, true, true]);
  await shot('03-price-copy');
  await js(`await click('.dlg button', 'Update prices'); await waitGone('Update catalog prices?'); await settle(500);`);
  const today = await js(`const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')`);
  const o1 = await js(`return (await idb('orders'))[0]`);
  check('stored: supplier, date, order #, payment, amounts, discount, 3 lines, nothing received', [o1.supplier, o1.placedOn, o1.orderNo, o1.payment, o1.taxCents, o1.shippingCents, o1.feesCents, o1.discount, o1.lines.length, o1.lines.map((l) => l.received), o1.fromList, o1.cancelled], ['REV', today, 'INV-77', 'PO 2408-17', 410, 995, 100, { kind: '%', value: 1000 }, 3, [0, 0, 0], 'Automatic', false]);
  check('stored lines: item lines copied from the items, the typed line with no item', [o1.lines[0].itemId, o1.lines[0].packs, o1.lines[0].packPriceCents, o1.lines[2].itemId, o1.lines[2].description, o1.lines[2].packs, o1.lines[2].packSize, o1.lines[2].unit, o1.lines[2].packPriceCents], [rev[0].id, 2, 1234, '', 'Team shirts', 3, 2, 'shirt', 1500]);
  check('catalog: the changed price and both price_checked dates updated', await js(`const a = await idb('items', ${JSON.stringify(rev[0].id)}); const b = await idb('items', ${JSON.stringify(rev[1].id)}); const va = a.vendors[a.preferredVendor - 1]; const vb = b.vendors[b.preferredVendor - 1]; return [va.packPriceCents, va.priceChecked, vb.packPriceCents, vb.priceChecked]`), [1234, today, rev[1].price, today]);
  check('toast names the order and its total', await js(`return toast()`), `Recorded the REV order: ${'$' + (total / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}. It’s in Order › Placed orders.`);

  // ── On order: subtracted from the automatic list, shown on lines, rows and the detail card ──
  const units0 = 2 * rev[0].packSize;
  const left0 = Math.max(0, rev[0].need - units0);
  check('the ordered item’s need drops by what is on order (or it leaves the list)', await js(`const l = [...group('REV').parentElement.querySelectorAll('.line')].find((x) => norm(x.querySelector('.lt').textContent) === ${JSON.stringify(rev[0].name)}); return l ? norm(l.querySelector('.chip.onord')?.textContent ?? '') : 'gone'`), left0 > 0 ? `On order ${units0}` : 'gone');
  await shot('04-automatic-after');
  await js(`await go('#/inventory'); await type('.searchwrap input', ${JSON.stringify(rev[0].name)}); await settle(500);`);
  check('inventory row: On order n', await js(`return norm(byText('.row', ${JSON.stringify(rev[0].name)})?.querySelector('.onord-t')?.textContent ?? '')`), `On order ${units0}`);
  await js(`await go('#/item/' + ${JSON.stringify(rev[0].id)});`);
  check('detail card: On order n, linking to Placed orders', await js(`const c = $('.chip.onord'); return [norm(c?.textContent ?? ''), c?.getAttribute('href')]`), [`On order ${units0} each`, '#/placed']);

  // ── Placed orders and one order ──
  await js(`await go('#/placed');`);
  check('Placed orders lists it: date, supplier, status Placed, total', await js(`const r = $('.po-row'); return [$$('.po-row').length, norm(r.querySelector('.po-main .lt').textContent), norm(r.querySelector('.chip').textContent), norm(r.querySelector('.po-total').textContent)]`), [1, 'REV', 'Placed', money0(total)]);
  await shot('05-placed-list');
  await js(`$('.po-row').click(); await settle(800);`);
  check('order page: lines, the five amounts and the total', await js(`return [$$('.po-l:not(.po-lh)').length, [...document.querySelectorAll('.po-sum > div')].map((d) => norm(d.textContent))]`), [3, [`Parts${money0(parts)}`, `Discount (10%)−${money0(discount)}`, 'Tax$4.10', 'Shipping$9.95', 'Other fees$1.00', `Total${money0(total)}`]]);
  check('order page: the typed line in packs × pack size and its unit', await js(`return norm($$('.po-l:not(.po-lh)')[2].querySelectorAll('[role=cell]')[1].textContent)`), '3 × 2 = 6 shirt');

  // ── Receipts: a PDF and a big photo, shrunk to 1600 px ──
  await js(`await choose(document.querySelector('input[data-receipt=pdf]'), 'invoice.pdf', new TextEncoder().encode('%PDF-1.4 test'), 'application/pdf'); await settle(800);
            const c = document.createElement('canvas'); c.width = 3000; c.height = 2000; const g = c.getContext('2d'); g.fillStyle = '#c33'; g.fillRect(0, 0, 3000, 2000);
            const png = await new Promise((r) => c.toBlob(r, 'image/png'));
            await choose(document.querySelector('input[data-receipt=gallery]'), 'receipt.png', new Uint8Array(await png.arrayBuffer()), 'image/png'); for (let i = 0; i < 50 && (await idb('receipts')).length < 2; i++) await settle(200);`);
  check('two receipts stored: the PDF as it is, the photo as a JPEG ≤ 1600 px', await js(`const rs = await idb('receipts'); const photo = rs.find((r) => r.blob.type === 'image/jpeg'); const bm = await createImageBitmap(photo.blob); return [rs.length, rs.map((r) => r.blob.type).sort(), Math.max(bm.width, bm.height), (await idb('orders'))[0].receipts.length, $$('.po-rc li').length]`), [2, ['application/jpeg'.replace('application/jpeg', 'application/pdf'), 'image/jpeg'], 1600, 2, 2]);
  await shot('06-order-page');

  // ── Receive: part, then the rest ──
  const onHand0 = await js(`return (await idb('items', ${JSON.stringify(rev[0].id)})).onHand`);
  await js(`await click('.top button', 'Receive…'); await waitDlg('Receive');`);
  check('Receive starts each line at what is due', await js(`return $$('.rc-n').map((i) => Number(i.value))`), [units0, line2Packs * rev[1].packSize, 6]);
  await js(`const minus = $$('.rc-line')[0].querySelector('button[aria-label^="One fewer"]'); minus.click(); await settle(100); $$('.rc-n')[1].focus(); await type($$('.rc-n')[1], '0'); await type($$('.rc-n')[2], '0'); await click('.dlg button', 'Next'); await waitDlg('Add to on hand?');`);
  check('confirmation says exactly what is added', await js(`return norm(dlg('Add to on hand?').querySelector('h2').textContent)`), `Add ${units0 - 1} to on hand for 1 item?`);
  await shot('07-receive-confirm');
  await js(`await click('.dlg button', 'Add ${units0 - 1} to on hand'); await waitGone('Add to on hand?'); await settle(600);`);
  check('partly received: on hand up by exactly that, last_counted unchanged, status chip', await js(`const it = await idb('items', ${JSON.stringify(rev[0].id)}); return [it.onHand - ${onHand0}, it.lastCounted, norm($('.po-head .chip').textContent)]`), [units0 - 1, '', 'Partly received']);
  await js(`await click('.top button', 'Receive…'); await waitDlg('Receive'); await click('.dlg button', 'Receive all'); await click('.dlg button', 'Next'); await waitDlg('Add to on hand?'); await click('.dlg button', 'Add'); await waitGone('Add to on hand?'); await settle(600);`);
  check('received: everything in, the typed line changed no item, no Receive button', await js(`const o = (await idb('orders'))[0]; return [o.lines.map((l) => l.received), norm($('.po-head .chip').textContent), !byText('.top button', 'Receive')]`), [[units0, line2Packs * rev[1].packSize, 6], 'Received', true]);
  check('no Cancel once received', await js(`return !byText('.po-head button', 'Cancel order')`), true);

  // ── Edit: received can be corrected without touching on hand ──
  const onHandNow = await js(`return (await idb('items', ${JSON.stringify(rev[0].id)})).onHand`);
  await js(`await click('.po-head button', 'Edit'); await waitDlg('Edit REV order');`);
  check('edit form has Received, and no receipt picker', await js(`return [!!rowInput(formRows()[0], 'Received of'), !$('.of-rcpt')]`), [true, true]);
  await js(`await type(rowInput(formRows()[0], 'Received of'), '1'); await type(field('Tax'), '5.00'); await click('.dlg button', 'Save changes'); await waitGone('Edit REV order'); await settle(500);`);
  check('edit saved: tax and received changed, on hand not', await js(`const o = (await idb('orders'))[0]; return [o.taxCents, o.lines[0].received, (await idb('items', ${JSON.stringify(rev[0].id)})).onHand, norm($('.po-head .chip').textContent)]`), [500, 1, onHandNow, 'Partly received']);
  await js(`await relockNow();`);

  // ── A named list emptied by Mark ordered offers to delete itself ──
  const andy = await js(`const items = await idb('items'); const it = items.find((i) => i.vendors[i.preferredVendor - 1]?.supplier === 'AndyMark'); return { id: it.id, name: it.name }`);
  await js(`await idbPut('orderLists', { id: 'ol-TEST22', key: 'nov order', name: 'Nov order', notes: '', created: 1, updated: 1, lines: [{ itemId: ${JSON.stringify(andy.id)}, quantity: 2 }], itemIds: [${JSON.stringify(andy.id)}] }); await go('#/order/ol-TEST22'); await settle(500);`);
  await js(`markBtn('AndyMark').click(); await answerGate(true, true); await waitDlg('Mark ordered: AndyMark'); await click('.dlg button', 'Record order'); await waitDlg('Update catalog prices?'); await click('.dlg button', 'Skip'); await waitDlg('The list is empty now');`);
  check('the list is empty now: offered for deletion', await js(`return [norm(dlg('The list is empty now').querySelector('h2').textContent), (await idb('orderLists'))[0].lines.length, (await idb('orders')).find((o) => o.supplier === 'AndyMark').fromList]`), ['“Nov order” is empty now', 0, 'Nov order']);
  await js(`await click('.dlg button', 'Delete this list'); await settle(700);`);
  check('deleted: no lists left, back on the automatic list', await js(`return [(await idb('orderLists')).length, location.hash]`), [0, '#/order']);

  // ── Cancel and delete ──
  const andyOrder = await js(`return (await idb('orders')).find((o) => o.supplier === 'AndyMark').id`);
  await js(`await go('#/placed/' + ${JSON.stringify(andyOrder)}); await click('.po-head button', 'Cancel order'); await waitDlg('Cancel this order?'); await click('.dlg button', 'Cancel order'); await waitGone('Cancel this order?'); await settle(500);`);
  check('cancelled: chip, kept in the list, no longer on order', await js(`return [norm($('.po-head .chip').textContent), (await idb('orders', ${JSON.stringify(andyOrder)})).cancelled, !!byText('.po-head button', 'Un-cancel')]`), ['Cancelled', true, true]);
  await js(`await go('#/order'); await settle(500);`);
  check('the cancelled item is back on the automatic list with no On order', await js(`const l = [...group('AndyMark').parentElement.querySelectorAll('.line')].find((x) => norm(x.querySelector('.lt').textContent) === ${JSON.stringify(andy.name)}); return [!!l, !l?.querySelector('.chip.onord')]`), [true, true]);
  await js(`await go('#/placed/' + ${JSON.stringify(andyOrder)}); await click('.po-head button', 'Delete'); await waitDlg('Delete this order?');`);
  await shot('08-delete-order');
  await js(`await click('.dlg button', 'Delete order'); await settle(700);`);
  check('deleted: gone from the database, back on Placed orders', await js(`return [(await idb('orders')).length, location.hash]`), [1, '#/placed']);
  await js(`await relockNow();`);

  // ── Full backup and restore: orders and receipts come back ──
  await js(`await go('#/more/backup'); await settle(500);` + CAPTURE + `document.querySelectorAll('.bkopt')[0].click(); for (let i = 0; i < 150 && !window.__files.length; i++) await settle(100); await settle(400);`);
  const full = await js(`return b64(window.__files[0].bytes)`);
  const beforeRestore = await js(`return JSON.stringify(await idb('orders'))`);
  await js(`await idbTx('orders', (s) => void s.clear()); await idbTx('receipts', (s) => void s.clear()); location.reload();`);
  await waitFor(`document.querySelectorAll('.cathdr').length >= 11 || document.querySelector('.bkcard')`, 60000);
  await js(`await go('#/more/backup'); await settle(600); await choose(document.querySelectorAll('input[type=file]')[0], 'inventory-backup-2026-10-28-1900.zip', unb64(${JSON.stringify(full)}), 'application/zip'); await waitDlg('Replace all inventory with this backup?');`);
  check('restore dialog: Placed orders row (0 now, 1 in the backup)', await js(`return [...document.querySelectorAll('.cmp tbody tr')].map((r) => [...r.cells].map((c) => norm(c.textContent))).find((r) => r[0] === 'Placed orders')`), ['Placed orders', '0', '1']);
  await js(`document.querySelector('.tick input').click(); await settle(150); await click('.dlg button', 'Replace everything'); await answerGate(true); await waitGone('Replace all inventory with this backup?'); await settle(800);`);
  check('restored: the order exactly as before (keys in any order), and both receipts', await js(`const sortKeys = (v) => Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v; const now = JSON.stringify(sortKeys(await idb('orders'))); const was = JSON.stringify(sortKeys(JSON.parse(${JSON.stringify(beforeRestore)}))); return [now === was ? true : [now, was], (await idb('receipts')).length]`), [true, 2]);

  // ── Independent review fixes (2026-10-29): a receipt that can't be saved, a $0 price, a
  //    deleted item at Receive, dialogs that close on relock ──
  const nOrders = await js(`return (await idb('orders')).length`);
  await js(`await go('#/order'); await settle(500); markBtn('REV').click(); await answerGate(true, true); await waitDlg('Mark ordered: REV');
            const rows = formRows(); for (const r of rows.slice(2)) { r.querySelector('input[type=checkbox]').click(); await settle(30); }
            await type(rowInput(formRows()[0], 'Pack price of'), '0');
            await choose(dlg('Mark ordered: REV').querySelector('input[data-receipt=pdf]'), 'invoice.pdf', new TextEncoder().encode('%PDF-1.4 test'), 'application/pdf');
            window.__put = IDBObjectStore.prototype.put;
            IDBObjectStore.prototype.put = function (...a) { if (this.name === 'receipts') throw new DOMException('The disk is full', 'QuotaExceededError'); return window.__put.apply(this, a); };
            await click('.dlg button', 'Record order'); await waitDlg('Update catalog prices?');
            IDBObjectStore.prototype.put = window.__put;`);
  const o3 = await js(`return (await idb('orders')).sort((a, b) => b.created - a.created)[0]`);
  check('a receipt that can’t be saved: the order is saved once, with no receipt, and the form moves on', await js(`return [(await idb('orders')).length - ${nOrders}, ${JSON.stringify(o3.receipts.length)}, !dlg('Mark ordered: REV')]`), [1, 0, true]);
  check('price copy: a line charged $0 starts unticked', await js(`const d = dlg('Update catalog prices?'); const li = [...d.querySelectorAll('.pc-list label, .pc-list li')].find((x) => /→ \\$0\\.00/.test(norm(x.textContent))); return [!!li, li?.querySelector('input[type=checkbox]')?.checked]`), [true, false]);
  await js(`await click('.dlg button', 'Skip'); await settle(300);`);
  check('the Recorded toast says the receipt wasn’t saved', await js(`return /A receipt couldn’t be saved \\(.*\\): add it on the order page\\./.test(toast())`), true);
  await js(`await relockNow();`);

  // The second line's item is deleted (outside the app), then the order is received.
  const gone = o3.lines[1];
  await js(`await idbTx('items', (s) => void s.delete(${JSON.stringify(gone.itemId)})); location.hash = '#/inventory'; location.reload();`);
  await sleep(1000);
  await waitFor(`document.querySelectorAll('.cathdr').length >= 11`, 60000);
  await js(`await go('#/placed/' + ${JSON.stringify(o3.id)}); await click('.top button', 'Receive…'); await waitDlg('Receive'); await click('.dlg button', 'Receive all'); await click('.dlg button', 'Next'); await waitDlg('Add to on hand?');`);
  const firstUnits = o3.lines[0].packs * o3.lines[0].packSize;
  check('Receive with a deleted item: only the existing item is added; the deleted one is marked received', await js(`const d = dlg('Add to on hand?'); return [norm(d.querySelector('h2').textContent), $$('.notes-list li').map((l) => norm(l.textContent))[1]]`), [`Add ${firstUnits} to on hand for 1 item?`, `${gone.description}: ${gone.packs * gone.packSize} received (item deleted, no inventory change)`]);
  await shot('11-receive-deleted-item');
  await js(`await click('.dlg button', 'Back'); await settle(200); $('.scrim.center').click(); await settle(300);`);
  check('nothing was received: Back and closing leave the order as it was', await js(`return [!dlg('Receive'), (await idb('orders', ${JSON.stringify(o3.id)})).lines.map((l) => l.received)]`), [true, o3.lines.map(() => 0)]);

  // Cancel and Remove receipt close when mentor tools relock, and change nothing.
  await js(`await click('.po-head button', 'Cancel order'); await answerGate(true, true); await waitDlg('Cancel this order?'); await relockNow(); await settle(1500);`);
  check('Cancel order: the confirmation closes on relock; the order isn’t cancelled', await js(`return [!dlg('Cancel this order?'), (await idb('orders', ${JSON.stringify(o3.id)})).cancelled]`), [true, false]);
  await js(`await choose(document.querySelector('input[data-receipt=pdf]'), 'invoice.pdf', new TextEncoder().encode('%PDF-1.4 test'), 'application/pdf'); await answerGate(true); for (let i = 0; i < 50 && !(await idb('orders', ${JSON.stringify(o3.id)})).receipts.length; i++) await settle(100);
            await click('.po-rc button', 'Remove'); await answerGate(true, true); await waitDlg('Remove this receipt?'); await relockNow(); await settle(1500);`);
  check('Remove receipt: the confirmation closes on relock; the receipt stays', await js(`return [!dlg('Remove this receipt?'), (await idb('orders', ${JSON.stringify(o3.id)})).receipts.length]`), [true, 1]);

  // ── Layout: targets, text, portrait ──
  await js(`await go('#/order'); await settle(500); markBtn('REV').click(); await answerGate(true, true); await waitDlg('Mark ordered: REV');`);
  check('order form: touch targets ≥ 48 px', await js(`return targets(dlg('Mark ordered: REV'))`), []);
  check('order form: text ≥ 15 px', await js(`return smallText(dlg('Mark ordered: REV'))`), []);
  await size(800, 1280);
  await sleep(500);
  await shot('09-form-portrait');
  check('portrait: the form fits the screen width', await js(`const d = dlg('Mark ordered: REV'); return d.scrollWidth <= d.clientWidth + 1`), true);
  await js(`await click('.dlg button', 'Cancel'); await go('#/placed/' + (await idb('orders'))[0].id);`);
  await shot('10-order-portrait');
  check('portrait order page: nothing wider than the screen', await js(`return document.documentElement.scrollWidth <= innerWidth`), true);
  check('portrait order page: each number has its label', await js(`return [...$$('.po-l:not(.po-lh)')[0].querySelectorAll('[data-l]')].map((c) => getComputedStyle(c, '::before').content)`), ['"Ordered"', '"Pack price"', '"Line total"', '"Received"']);
  await size(1280, 800);
  await sleep(300);
  check('order page: touch targets ≥ 48 px, text ≥ 15 px', await js(`return [targets($('.main')), smallText($('.main'))]`), [[], []]);
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

function money0(c) {
  return '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
