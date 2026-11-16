// M30 real-browser check (SPEC v0.25, F33): More › Backup, restore & price import › Add items from a
// file. A CSV and a ZIP are handed to the screen's file picker; the preview, the PIN, the summary, the
// untouched existing items, the lists created, a photo, Undo, and a refused file are checked against the
// real IndexedDB. Headless Chrome.
// Usage: npm run build && node scripts/m30-ui-check.mjs <chrome.exe> <screenshot dir>
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
  const dlg = (label) => $('[role=dialog][aria-label="' + label + '"], [role=alertdialog][aria-label="' + label + '"]');
  const waitDlg = async (label, ms = 30000) => { const end = Date.now() + ms; while (Date.now() < end) { const d = dlg(label); if (d) return d; await settle(100); } throw new Error('no dialog ' + label); };
  const waitGone = async (label, ms = 30000) => { const end = Date.now() + ms; while (Date.now() < end && dlg(label)) await settle(100); };
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
  // Hands a file to the Add items card's hidden file input (the third one on the screen), as the picker would.
  const choose = async (name, data, type) => {
    const input = document.querySelectorAll('input[type=file]')[2];
    const dt = new DataTransfer();
    dt.items.add(new File([data], name, { type }));
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await settle(500);
  };
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const HEAD = 'name,category,subcategory,unit,v1_supplier,v1_part_no,v1_pack_size,v1_pack_price,v1_price_checked,photo_file';
  const stripped = (items) => items.map(({ updatedAt, ...r }) => r);
`;

// A ZIP with one new item and its photo (a 1×1 PNG), built here and handed to the page.
const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));
const zip = new JSZip();
zip.file('inventory.csv', 'name,category,subcategory,unit,v1_supplier,v1_part_no,v1_pack_size,v1_pack_price,v1_price_checked,photo_file\r\nPhoto widget,Mechanical,,each,Zeta Supply,ZS-2,1,3.00,2026-11-16,photos/pw.png\r\n');
zip.file('photos/pw.png', png);
const zipB64 = Buffer.from(await zip.generateAsync({ type: 'uint8array' })).toString('base64');

const { js, waitFor, check, shot, size, send, fail, finish } = await startCheck({ previewPort: 4368, cdpPort: 9398, prelude: () => H });

try {
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await size(1280, 800);
  await send('Page.navigate', { url: 'http://localhost:4368/' });
  await waitFor(`document.querySelector('.setup')`, 60000);
  await js(`await doSetup();`);
  await waitFor(`document.querySelectorAll('.cathdr').length >= 11`, 60000);
  await js(`await go('#/more/backup');`);
  await waitFor(`document.querySelector('.bkcard')`);

  check('the Backup screen has the Add items from a file card with the PIN chip and no Undo yet', await js(`const c = $$('.bkcard').find((x) => x.textContent.includes('Add items from a file')); return [!!c, !!c.querySelector('.chip.lock'), !byText('.bkcard button', 'Undo this import')]`), [true, true, true]);
  await shot('01-card');

  const before = await js(`return stripped(await idb('items'))`);
  const first = before[0];
  const second = before[1];
  check('the starter catalog is loaded: 129 items, 128 photos', await js(`return [(await idb('items')).length, (await idb('photos')).length]`), [129, 128]);

  // A file with: a new item in a new category and supplier, a new item in a new subcategory of Mechanical,
  // one present by name (other capitals), one present by supplier + part number, and one unreadable row.
  const supplier2 = second.vendors.find((v) => v)?.supplier;
  const part2 = second.vendors.find((v) => v)?.partNo;
  const csv = [
    'name,category,subcategory,unit,v1_supplier,v1_part_no,v1_pack_size,v1_pack_price,v1_price_checked,photo_file',
    'Brand new widget,Zebra Parts,,each,Zeta Supply,ZS-1,2,12.50,2026-11-16,',
    'Second widget,Mechanical,Widgets,each,Zeta Supply,ZS-3,1,4.00,2026-11-16,',
    `"${first.name.toUpperCase()}",Mechanical,,each,Zeta Supply,ZS-4,1,1.00,,`,
    `Different name,Mechanical,,each,${supplier2.toLowerCase()},${part2},1,1.00,,`,
    'No unit,Mechanical,,,Zeta Supply,ZS-5,1,1.00,,',
  ].join('\r\n');
  await js(`window.__csv = ${JSON.stringify(csv)}; await choose('new-items.csv', window.__csv, 'text/csv'); await waitDlg('Check the items to add');`);
  check('the preview: 2 new, 2 already here, 1 unreadable, 3 names for the lists', await js(`return $$('.ai-sec summary').map((s) => norm(s.textContent))`), [
    '2 new items',
    '2 rows already on this tablet (skipped)',
    '1 row can’t be read (skipped)',
    '3 names added to the lists',
  ]);
  check('the preview says why each present row is present, and the unreadable row’s reason', await js(`const t = norm(dlg('Check the items to add').textContent); return [t.includes('same name as'), t.includes('same part number'), t.includes('unit is missing')]`), [true, true, true]);
  check('nothing is saved before Add: still 129 items', await js(`return (await idb('items')).length`), 129);
  check('the Add button needs the PIN and says how many', await js(`const b = byText('[role=dialog] button', 'Add 2 items'); return [!!b, !!b.querySelector('.pinmark')]`), [true, true]);
  await shot('02-preview');

  // Cancel leaves everything as it was.
  await js(`await click('[role=dialog] button', 'Cancel'); await waitGone('Check the items to add');`);
  check('Cancel adds nothing', await js(`return [(await idb('items')).length, !dlg('Check the items to add')]`), [129, true]);

  // PIN cancelled.
  await js(`await choose('new-items.csv', window.__csv, 'text/csv'); await waitDlg('Check the items to add'); byText('[role=dialog] button', 'Add 2 items').click(); await answerGate(false);`);
  check('PIN cancelled: nothing added, the preview is still open', await js(`return [(await idb('items')).length, !!dlg('Check the items to add')]`), [129, true]);

  // Add, with the PIN.
  await js(`byText('[role=dialog] button', 'Add 2 items').click(); await answerGate(true, true); await waitDlg('Items added');`);
  check('the summary: 2 items added, 1 category, 1 subcategory, 1 supplier, 0 existing changed', await js(`return $$('.sumt tr').map((r) => [...r.cells].map((c) => norm(c.textContent)).join(' '))`), [
    '2 items added, each with on hand 0 and desired 0',
    '1 categories added',
    '1 subcategories added',
    '1 suppliers added',
    '0 existing items, counts or settings changed',
  ]);
  await shot('03-added');
  await js(`await click('[role=dialog] button', 'Done'); await relockNow();`);
  const after = await js(`return stripped(await idb('items'))`);
  const added = after.filter((i) => !before.some((b) => b.id === i.id));
  check('two items were added, with new tm- ids, on hand 0, desired 0, source team, not counted', added.map((i) => [i.name, /^tm-[2-9A-Z]{5}$/.test(i.id), i.onHand, i.desired, i.spares, i.source, i.lastCounted, i.location]).sort(), [
    ['Brand new widget', true, 0, 0, 0, 'team', '', ''],
    ['Second widget', true, 0, 0, 0, 'team', '', ''],
  ]);
  check('every item that was there is exactly as it was', JSON.stringify(after.filter((i) => before.some((b) => b.id === i.id))), JSON.stringify(before));
  check('the spelling of the new rows: price in cents, supplier, pack size', await js(`const i = (await idb('items')).find((x) => x.name === 'Brand new widget'); return [i.vendors[0].packPriceCents, i.vendors[0].supplier, i.vendors[0].packSize, i.vendors[0].priceChecked, i.preferredVendor]`), [1250, 'Zeta Supply', 2, '2026-11-16', 1]);
  check('the lists gained the new category, subcategory and supplier', await js(`const cats = await idb('categories'); const sup = await idb('suppliers'); return [cats.some((c) => c.name === 'Zebra Parts'), cats.find((c) => c.name === 'Mechanical').subcategories.includes('Widgets'), sup.some((s) => s.name === 'Zeta Supply')]`), [true, true, true]);
  check('Inventory lists the new category', await js(`await go('#/inventory'); return norm(document.body.textContent).includes('Zebra Parts')`), true);

  // Undo.
  await js(`await go('#/more/backup');`);
  await waitFor(`document.querySelector('.bkcard')`);
  check('Undo this import is offered, with what was added', await js(`const c = $$('.bkcard').find((x) => x.textContent.includes('Add items from a file')); return [!!byText('.bkcard button', 'Undo this import'), norm(c.textContent).includes('Last add: 2 items from new-items.csv')]`), [true, true]);
  await shot('04-undo-offered');
  await js(`await click('.bkcard button', 'Undo this import'); await waitDlg('Undo this import?'); byText('[role=alertdialog] button', 'Undo this import').click(); await answerGate(true, true); await waitDlg('Import undone');`);
  check('Undo reports 2 items removed and none kept', await js(`return norm(dlg('Import undone').textContent)`), 'Import undone2 items removed.Done');
  await js(`await click('[role=dialog] button', 'Done'); await relockNow();`);
  const back = await js(`return stripped(await idb('items'))`);
  check('after Undo the items are exactly the original 129', JSON.stringify(back), JSON.stringify(before));
  check('after Undo the category, subcategory and supplier it created are gone', await js(`const cats = await idb('categories'); const sup = await idb('suppliers'); return [cats.some((c) => c.name === 'Zebra Parts'), cats.find((c) => c.name === 'Mechanical').subcategories.includes('Widgets'), sup.some((s) => s.name === 'Zeta Supply'), !byText('.bkcard button', 'Undo this import')]`), [false, false, false, true]);

  // A ZIP with a photo.
  await js(`await choose('photo.zip', unb64('${zipB64}'), 'application/zip'); await waitDlg('Check the items to add'); byText('[role=dialog] button', 'Add 1 item').click(); await answerGate(true, true); await waitDlg('Items added');`);
  check('a ZIP’s photo is stored: 129 photos, the item has one', await js(`const i = (await idb('items')).find((x) => x.name === 'Photo widget'); const p = await idb('photos', i.id); return [(await idb('photos')).length, i.hasPhoto, p.full.size > 0]`), [129, true, true]);
  await js(`await click('[role=dialog] button', 'Done'); await relockNow(); await click('.bkcard button', 'Undo this import'); await waitDlg('Undo this import?'); byText('[role=alertdialog] button', 'Undo this import').click(); await answerGate(true, true); await waitDlg('Import undone'); await click('[role=dialog] button', 'Done'); await relockNow();`);
  check('Undo removes the item and its photo: back to 129 items, 128 photos', await js(`return [(await idb('items')).length, (await idb('photos')).length]`), [129, 128]);

  // An item counted since is kept by Undo.
  await js(`await choose('new-items.csv', window.__csv, 'text/csv'); await waitDlg('Check the items to add'); byText('[role=dialog] button', 'Add 2 items').click(); await answerGate(true, true); await waitDlg('Items added'); await click('[role=dialog] button', 'Done'); await relockNow();`);
  await js(`const r = await new Promise((res) => { const q = indexedDB.open('frc2408-inventory'); q.onsuccess = () => { const db = q.result; const tx = db.transaction('items', 'readwrite'); const s = tx.objectStore('items'); const g = s.getAll(); g.onsuccess = () => { const row = g.result.find((x) => x.name === 'Second widget'); s.put({ ...row, onHand: 5, updatedAt: Date.now() + 1000 }); }; tx.oncomplete = () => { db.close(); res(true); }; }; });`);
  await js(`await click('.bkcard button', 'Undo this import'); await waitDlg('Undo this import?'); byText('[role=alertdialog] button', 'Undo this import').click(); await answerGate(true, true); await waitDlg('Import undone');`);
  check('Undo keeps the item counted since and names it', await js(`const t = norm(dlg('Import undone').textContent); return [t.includes('1 item removed'), t.includes('1 item kept'), t.includes('Second widget')]`), [true, true, true]);
  await shot('05-undo-kept');
  await js(`await click('[role=dialog] button', 'Done'); await relockNow();`);
  check('the counted item is still there, with its count', await js(`const i = (await idb('items')).find((x) => x.name === 'Second widget'); return [(await idb('items')).length, i?.onHand]`), [130, 5]);

  // A file that isn't a catalog is refused with nothing changed.
  await js(`await choose('prices.csv', 'id,v1_pack_price\\r\\nst-0001,1.00', 'text/csv'); await waitDlg('Can’t add items from this file — nothing was changed');`);
  check('a file without name, category and unit is refused', await js(`const t = norm(dlg('Can’t add items from this file — nothing was changed').textContent); return [t.includes('missing columns name, category, unit'), (await idb('items')).length]`), [true, 130]);
  await js(`await click('[role=alertdialog] button', 'OK');`);

  // Layout at phone and portrait widths.
  for (const [w, h, name] of [[390, 844, 'phone'], [800, 1280, 'portrait']]) {
    await size(w, h);
    await js(`await choose('new-items.csv', window.__csv, 'text/csv'); await waitDlg('Check the items to add'); $('.ai-sec:nth-child(2)').open = true;`);
    check(`${name} width: nothing wider than the screen; Add and Cancel at least 48 px tall`, await js(`const b = [...dlg('Check the items to add').querySelectorAll('.dlg-actions button')]; return [document.documentElement.scrollWidth <= innerWidth, b.length === 2 && b.every((x) => x.getBoundingClientRect().height >= 48)]`), [true, true]);
    await shot(`06-preview-${name}`);
    await js(`await click('[role=dialog] button', 'Cancel'); await waitGone('Check the items to add');`);
  }
} catch (e) {
  await fail(e);
} finally {
  await finish();
}
