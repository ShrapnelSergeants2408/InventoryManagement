// M25 real-browser check (SPEC v0.20): "+ New supplier…" in the item editor, on a new item and on
// an existing one after the PIN. Real IndexedDB, headless Chrome.
// Usage: npm run build && node scripts/m25-ui-check.mjs <chrome.exe> <screenshot dir>
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


const { js, waitFor, check, shot, size, send, sleep, fail, finish } = await startCheck({ previewPort: 4364, cdpPort: 9394, prelude: () => H + EDIT });

const NAME = `input[aria-label^="New supplier name"]`;
const pick = `const s = $('#v1-sup'); s.value = '__new'; s.dispatchEvent(new Event('change', { bubbles: true })); await settle(300);`;

try {
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await size(1280, 800);
  await send('Page.navigate', { url: 'http://localhost:4364/' });
  await waitFor(`document.querySelector('.setup')`, 60000);
  await js(`await doSetup();`);
  await waitFor(`document.querySelectorAll('.cathdr').length >= 11`, 60000);
  const supNames = () => js(`return (await idb('suppliers')).map((s) => s.name)`);

  // ── A new item: option 1 is open without the PIN ──
  await js(`await go('#/add');`);
  const opts = await js(`return [...$('#v1-sup').options].map((o) => o.textContent)`);
  check('the supplier picker ends with + New supplier…', opts.at(-1), '+ New supplier…');
  await js(pick);
  check('choosing it shows the name box and no PIN pad', await js(`return [!!$('${NAME}'), !!pinDlg()]`), [true, false]);
  await js(`await type('${NAME}', 'rev');`);
  check('a name already in the list (any capitals) is refused, Add disabled', await js(`return [!!$('.err[role=alert]'), byText('.inline-add .btn', 'Add').disabled]`), [true, true]);
  await js(`await type('${NAME}', 'Digi-Key');`);
  await shot('01-new-supplier');
  await js(`await click('.inline-add .btn', 'Add'); await settle(500);`);
  check('Add saves it, selects it and hides the box', await js(`return [$('#v1-sup').value, !!$('${NAME}'), toast()]`), ['Digi-Key', false, 'Added supplier “Digi-Key”.']);
  check('it is in the Supplier list straight away, before the item is saved', (await supNames()).includes('Digi-Key'), true);
  const listed = await js(`return [...$('#v1-sup').options].map((o) => o.textContent).filter((t) => t !== 'Choose…' && !t.startsWith('+'))`);
  check('the picker keeps other last', listed.at(-1), 'other');

  await js(`await type('#nm', 'M25 test part'); await type('#v1-part', 'DK-1'); await click('button', 'Add item'); await settle(900);`);
  check('the item saves with the new supplier', await js(`const it = (await idb('items')).find((i) => i.name === 'M25 test part'); return [it?.vendors?.[0]?.supplier, it?.preferredVendor]`), ['Digi-Key', 1]);

  // ── An existing item: the PIN unlocks the vendor fields; a new supplier then needs no second PIN ──
  const itemId = await js(`return (await idb('items')).find((i) => i.name === 'M25 test part').id`);
  await js(`await go('#/item/${'${ID}'}/edit');`.replace('${ID}', itemId));
  check('locked: the supplier picker is disabled', await js(`return $('#v1-sup').disabled`), true);
  await js(`await click('.lockbar button', 'Unlock'); await answerGate(true, true);`);
  await js(pick);
  await js(`await type('${NAME}', 'Pololu'); await click('.inline-add .btn', 'Add'); await settle(500);`);
  check('after unlocking, a new supplier needs no second PIN', await js(`return [$('#v1-sup').value, !!pinDlg()]`), ['Pololu', false]);
  await shot('02-edit-new-supplier');
  await size(800, 1280);
  await sleep(400);
  await shot('03-portrait');
  check('portrait: nothing wider than the screen; targets ≥ 48 px in the vendor card', await js(`return [document.documentElement.scrollWidth <= innerWidth, targets($('.vopt'))]`), [true, []]);
  await size(1280, 800);

  // ── B4 Send all kits, B5 progress, and the kit file name ──
  const [C0, C1] = (await js(`return (await idb('categories')).sort((a, b) => a.order - b.order).map((c) => c.name)`)).slice(0, 2);
  const helperRow = (id, name, groups) => ({ id, name, key: name.toLowerCase(), kind: 'category', groups, allowNewItems: true, kits: [], lastImportAt: null, created: 1 });
  await js(`await idbPut('helpers', ${JSON.stringify(helperRow('hp-BINAB', 'Bin A-B', [C0]))}); await idbPut('helpers', ${JSON.stringify(helperRow('hp-MOTOR', 'Motors crew', [C1]))}); await go('#/count/helpers'); await settle(500);`);
  check('two helpers: Send all kits… appears; with one helper it would not', await js(`return [!!byText('.sendall .btn', 'Send all kits'), $$('.hcard').length]`), [true, 2]);
  check('no kit yet: no progress line', await js(`return $$('.hprog').length`), 0);
  await js(CAPTURE);
  await js(`await click('.sendall .btn', 'Send all kits'); await settle(400);`);
  check('the dialog lists both helpers ticked', await js(`return [$$('[aria-label="Helpers to send a kit to"] [role=checkbox]').map((b) => [norm(b.querySelector('strong').textContent), b.getAttribute('aria-checked')]), norm(byText('.dlg-actions .btn', 'Send 2 kits').textContent)]`), [[['Bin A-B', 'true'], ['Motors crew', 'true']], 'Send 2 kits']);
  await shot('04-send-all');
  await js(`byText('[role=checkbox]', 'Motors crew').click(); await settle(150);`);
  check('unticking one changes the button', await js(`return norm(byText('.dlg-actions .btn', 'Send 1 kit').textContent)`), 'Send 1 kit');
  await js(`window.__shared = null; navigator.canShare = () => true; navigator.share = async (d) => { window.__shared = { names: d.files.map((f) => f.name), title: d.title }; };`);
  await js(`byText('[role=checkbox]', 'Motors crew').click(); await settle(150); await click('.dlg-actions .btn', 'Send 2 kits');`);
  await waitFor('window.__shared', 90000);
  await sleep(800);
  check('with a share sheet: ONE share holds both kits, the dialog closes, “Sent 2 kits.”', await js(`return [window.__shared, !$('.dlg'), toast()]`), [{ names: ['Bin_A-B_Helper.zip', 'Motors_crew_Helper.zip'], title: 'Count kits' }, true, 'Sent 2 kits.']);
  await sleep(800);
  check('both kits are recorded; progress starts at 0 with nothing imported', await js(`return [(await idb('helpers')).map((h) => h.kits.length), $$('.hprog').map((e) => /^Nothing imported yet · counted 0 of \\d+/.test(norm(e.textContent)))]`), [[1, 1], [true, true]]);
  await js(`navigator.canShare = undefined; navigator.share = undefined; await click('.sendall .btn', 'Send all kits'); await settle(400); await click('.dlg-actions .btn', 'Send 2 kits');`);
  await waitFor("document.querySelector('.dlg-list')", 90000);
  check('no share sheet: both kits are saved with the helper name first, and the dialog says not sent yet', await js(`return [window.__files.map((f) => f.name).sort(), norm($('.dlg .h2').textContent), $$('.dlg-list li').map((l) => norm(l.textContent)).sort()]`), [['Bin_A-B_Helper.zip', 'Motors_crew_Helper.zip'], 'Saved to Downloads, not sent yet', ['Bin_A-B_Helper.zip', 'Motors_crew_Helper.zip']]);
  await shot('05-send-all-saved');
  await js(`await click('.dlg-actions .btn', 'Done'); await settle(400);`);
  // Counted by Bin A-B after the kit: shows as progress and a last-import time
  await js(`const rows = await idb('items'); const e = rows.filter((r) => r.category === ${JSON.stringify(C0)}).slice(0, 2); for (const r of e) await idbPut('items', { ...r, lastCounted: new Date().toISOString().slice(0, 19) + '+00:00', countedBy: 'Bin A-B' }); const h = (await idb('helpers')).find((x) => x.id === 'hp-BINAB'); await idbPut('helpers', { ...h, lastImportAt: Date.now() }); location.reload();`);
  await sleep(1500);
  await waitFor(`document.querySelector('.hcard')`, 30000);
  const prog = await js(`return $$('.hcard').map((c) => [norm(c.querySelector('h2').textContent), norm(c.querySelector('.hprog').textContent)])`);
  check('Bin A-B: a last-import time and 2 counted; Motors crew: nothing imported, 0', [/^Last import .* · counted 2 of \d+/.test(prog.find((r) => r[0] === 'Bin A-B')[1]), /^Nothing imported yet · counted 0 of \d+/.test(prog.find((r) => r[0] === 'Motors crew')[1])], [true, true]);
  await shot('06-progress');
  await size(800, 1280);
  await sleep(400);
  await shot('07-helpers-portrait');
  check('portrait: nothing wider than the screen; text ≥ 15 px', await js(`return [document.documentElement.scrollWidth <= innerWidth, smallText($('.cbody'))]`), [true, []]);
  await size(1280, 800);

  // ── B6 count report, B7 spot-check list: a seeded undo record, as an import would leave ──
  const fld = (n, by) => ({ onHand: n, lastCounted: '2026-11-12T10:00:00-06:00', countedBy: by, location: '', barcode: '' });
  const undoRec = { id: 'import-1', seq: 1, at: Date.now(), fileNames: ['x.zip'], helperNames: ['Maya'], items: [['st-0001', fld(4, '')], ['st-0002', fld(10, '')], ['st-0003', fld(5, '')]], after: [['st-0001', fld(5, 'Maya')], ['st-0002', fld(0, 'Maya')], ['st-0003', fld(20, 'Maya')]], outside: ['st-0003'], locations: [], pending: [], helpers: [] };
  await js(`await idbPut('importUndo', ${JSON.stringify(undoRec)}); await go('#/count/import'); await settle(600);`);
  check('Last import card: Spot-check list (2 flagged), Count report and Undo', await js(`const c = $('.imp-undo'); return [norm(c.querySelector('.btn:not(.danger)').textContent), $$('.imp-undo .btn').map((b) => norm(b.textContent))]`), ['Spot-check list 2', ['Spot-check list 2', 'Count report (CSV)', 'Undo this import']]);
  await js(`await click('.imp-undo .btn', 'Spot-check list'); await settle(400);`);
  const spot = await js(`return $$('.spot-row').map((r) => [norm(r.querySelector('.spot-name').textContent).slice(0, 12), norm(r.querySelector('.spot-nums').textContent), [...r.querySelectorAll('.chip')].map((c) => norm(c.textContent))])`);
  check('the list holds the zero count and the big outside change, not the plain one', [spot.length, spot.map((r) => r[1]), spot.map((r) => r[2])], [2, ['10 → 0', '5 → 20'], [['Counted zero (there was stock)'], ['Big change', 'Outside the helper’s groups']]]);
  await shot('08-spot-check');
  await size(800, 1280);
  await sleep(400);
  await shot('09-spot-check-portrait');
  check('portrait: the dialog fits; targets ≥ 48 px; text ≥ 15 px', await js(`return [document.documentElement.scrollWidth <= innerWidth, targets($('.dlg')), smallText($('.dlg'))]`), [true, [], []]);
  await size(1280, 800);
  await js(CAPTURE);
  await js(`await click('.dlg .btn', 'Count report'); await settle(800);`);
  const rep = await js(`const f = window.__files[0]; return f ? [f.name, new TextDecoder().decode(f.bytes).replace(/^\\uFEFF/, '').split(/\\r?\\n/).filter(Boolean).slice(1)] : null`);
  check('the CSV: header, then each changed item before → after with the change and flags', [/^count-report-\d{4}-\d\d-\d\d-\d{4}\.csv$/.test(rep?.[0] ?? ''), rep?.[1][0], rep?.[1].slice(1).map((l) => l.replace(/^.*,(\d+,\d+,[+-]\d+),Maya,[^,]*,/, '$1,'))], [true, 'Item id,Item,Category,Location,Before,After,Change,Counted by,Counted at,Spot-check', ['4,5,+1,', '10,0,-10,Counted zero (there was stock)', '5,20,+15,Big change; Outside the helper’s groups']]);
  await js(`await click('.dlg .btn', 'Done'); await settle(300);`);
  await js(`await idbPut('importUndo', { id: 'import-1', seq: 1, at: Date.now(), fileNames: [], helperNames: ['Old'], items: [], locations: [], pending: [], helpers: [] }); location.reload();`);
  await sleep(1500);
  await waitFor(`document.querySelector('.imp-undo')`, 30000);
  check('an import saved before v0.20 (no after-values) shows no report buttons', await js(`return $$('.imp-undo .btn').map((b) => norm(b.textContent))`), ['Undo this import']);
  await size(1280, 800);

  // ── B9 cycle counts: two items last counted long ago ──
  await js(`const rows = await idb('items'); for (const r of rows.filter((x) => ['st-0001', 'st-0002'].includes(x.id))) await idbPut('items', { ...r, lastCounted: '2025-01-01T10:00:00-06:00', countedBy: 'Maya' }); await go('#/inventory'); await settle(800);`);
  check('Inventory status strip: 2 items due for a recount, linking to Count', await js(`const a = byText('.shopst a', 'due for a recount'); return a ? [norm(a.textContent), a.getAttribute('href')] : null`), [['2 items due for a recount (over 90 days)', '#/count']].map((x) => x)[0]);
  await js(`await go('#/count'); await settle(600);`);
  const due = await js(`return [$$('.cg-due').map((c) => Number(norm(c.textContent).split(' ')[0])).reduce((a, b) => a + b, 0), norm($('.cprog-t').textContent)]`);
  check('Count screen: group chips add up to 2, and the progress line says so', [due[0], /· 2 due for a recount \(not counted in 90 days\)/.test(due[1])], [2, true]);
  await shot('10-count-due');
  await size(800, 1280);
  await sleep(400);
  await shot('11-count-due-portrait');
  check('portrait: nothing wider than the screen; text ≥ 15 px', await js(`return [document.documentElement.scrollWidth <= innerWidth, smallText($('.cbody'))]`), [true, []]);
  await size(1280, 800);
  await js(`await go('#/more/settings'); await click('.lockbar button', 'Unlock'); await answerGate(true, true);`);
  check('Settings: Recount after, default 90 days', await js(`return [$('#set-recountDays').value, !!$('label[for=set-recountDays]')]`), ['90', true]);
  await js(`await type('#set-recountDays', '9999'); await click('.top .btn', 'Save'); await settle(400);`);
  check('a value out of range is refused', await js(`return norm($('.set-err')?.textContent ?? '')`), 'Recount after must be a whole number of days from 7 to 365');
  await js(`await type('#set-recountDays', '7'); await click('.top .btn', 'Save'); await settle(500); await go('#/inventory'); await settle(800);`);
  check('with 7 days, more items are due and the strip follows', await js(`const a = byText('.shopst a', 'due for a recount'); return a ? norm(a.textContent).endsWith('(over 7 days)') : null`), true);
  // ── Inventory filter: Due for a recount ──
  const chipN = await js(`const b = byText('.frow .fchip', 'Due for a recount'); return b ? Number(norm(b.textContent).split('· ')[1]) : null`);
  check('Inventory has a Due for a recount quick filter with a count of at least 2', chipN >= 2, true);
  await js(`byText('.frow .fchip', 'Due for a recount').click(); await settle(500);`);
  check('turned on: only the due items show, and the chip is pressed', await js(`return [document.querySelectorAll('.row').length, byText('.frow .fchip', 'Due for a recount').getAttribute('aria-pressed')]`), [chipN, 'true']);
  await js(`byText('.top .btn', 'Filters').click(); await settle(400);`);
  check('the Filters panel offers it too, under Stock', await js(`return !!byText('.fpanel .fchip', 'Due for a recount')`), true);
  await js(`await click('.fpanel-foot .btn', 'Clear all'); await settle(300); document.querySelector('.fpanel [aria-label="Close filters"]')?.click(); await settle(300);`);
  check('Clear all turns it off', await js(`return byText('.frow .fchip', 'Due for a recount')?.getAttribute('aria-pressed') ?? null`), 'false');
  await size(1280, 800);
} catch (e) {
  await fail(e);
} finally {
  await finish();
}
