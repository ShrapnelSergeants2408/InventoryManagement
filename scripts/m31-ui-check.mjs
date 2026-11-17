// M31 real-browser check (SPEC v0.26): long search and filter results draw 100 rows at a time with
// Show more (R1), Labels for an Inventory selection (R4), and More › About › Check for updates when
// this is the newest version (R2; a new version found by the check or by coming back on screen is in
// m10, which changes dist/sw.js). 300 extra items are written straight into IndexedDB after setup.
// Headless Chrome.
// Usage: npm run build && node scripts/m31-ui-check.mjs <chrome.exe> <screenshot dir>
import { readFileSync } from 'node:fs';
import { PIN_H } from './pin-helpers.mjs';
import { startCheck } from './check-lib.mjs';

const { version } = JSON.parse(readFileSync('package.json', 'utf8'));

const H = `
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const settle = (ms = 350) => new Promise((r) => setTimeout(r, ms));
  const norm = (s) => s.replace(/\\s+/g, ' ').trim();
  const byText = (sel, t) => $$(sel).find((b) => norm(b.textContent).includes(t));
  const click = async (sel, t) => { const b = byText(sel, t); if (!b) throw new Error('nothing like ' + sel + ' with text ' + t); b.click(); await settle(); return b; };
${PIN_H}
  const go = async (h) => { location.hash = h; await settle(700); };
  const rows = () => $$('.list .row').length;
  const more = () => $('.list-more');
  const search = async (text) => {
    const box = $('input[type=search]');
    box.value = text;
    box.dispatchEvent(new Event('input', { bubbles: true }));
    await settle(500);
  };
  // 300 short items named "Bulk part n" in Mechanical › Bulk, counted, desired 5, on hand 0.
  const addBulk = () => new Promise((res, rej) => {
    const r = indexedDB.open('frc2408-inventory');
    r.onsuccess = () => {
      const db = r.result;
      const tx = db.transaction('items', 'readwrite');
      const s = tx.objectStore('items');
      const g = s.getAll();
      g.onsuccess = () => {
        const base = g.result[0];
        for (let i = 0; i < 300; i++) {
          s.put({ ...base, id: 'bulk-' + String(i).padStart(3, '0'), name: 'Bulk part ' + i, category: 'Mechanical', subcategory: 'Bulk', barcode: '', hasPhoto: false, onHand: 0, desired: 5, spares: 0, lastCounted: '2026-11-17T10:00:00.000-06:00' });
        }
      };
      tx.oncomplete = () => { db.close(); res(); };
      tx.onerror = () => rej(tx.error);
    };
  });
`;

const { js, waitFor, check, shot, size, send, fail, finish } = await startCheck({ previewPort: 4369, cdpPort: 9399, prelude: () => H });

try {
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await size(1280, 800);
  await send('Page.navigate', { url: 'http://localhost:4369/' });
  await waitFor(`document.querySelector('.setup')`, 60000);
  await js(`await doSetup();`);
  await waitFor(`document.querySelectorAll('.cathdr').length >= 11`, 60000);
  await js(`await addBulk();`);
  await send('Page.reload');
  await waitFor(`document.querySelectorAll('.cathdr').length >= 11 && document.querySelector('input[type=search]')`, 60000);

  // ── R1: a long search draws 100 rows, then Show more ──
  check('browsing (no search) draws no Show more', await js(`return !more()`), true);
  await js(`await search('bulk part');`);
  check(
    'a search with 300 matches draws 100 rows and offers Show 100 more, with how many are not shown',
    await js(`return [rows(), norm(more().querySelector('button').textContent), norm(more().querySelector('span').textContent)]`),
    [100, 'Show 100 more', '200 more matches not shown yet. Type more of the name or part # to narrow the list.'],
  );
  check(
    'the counts still cover every match: the category header and the footer',
    await js(`return [norm(byText('.cathdr', 'Mechanical').querySelector('.hc').textContent), norm($('.list-foot').textContent)]`),
    ['300 of 326 items match', '300 matching items'],
  );
  await shot('01-search-100-rows');
  await js(`await click('.list-more button', 'Show 100 more');`);
  check('Show more adds 100 rows', await js(`return [rows(), norm(more().querySelector('span').textContent)]`), [200, '100 more matches not shown yet. Type more of the name or part # to narrow the list.']);
  await js(`await click('.list-more button', 'Show 100 more');`);
  check('the last page: every match drawn, no Show more', await js(`return [rows(), !more()]`), [300, true]);
  await js(`await search('bulk');`);
  check('a new search starts again at 100 rows', await js(`return [rows(), norm(more().querySelector('button').textContent)]`), [100, 'Show 100 more']);
  await js(`await search('bulk part 12');`);
  check('a narrow search (12, 112, 120–129, 212) draws every match and no Show more', await js(`return [rows(), !more()]`), [13, true]);
  await js(`await search('');`);

  // A filter (kept across screens) with Show more, then an item's card and back.
  await js(`await click('.frow .fchip', 'Short only');`);
  check('the Short only filter (300+ items) draws 100 rows', await js(`return [rows(), !!more()]`), [100, true]);
  await js(`await click('.list-more button', 'Show 100 more');`);
  await js(`await go('#/item/bulk-150');`);
  await waitFor(`location.hash === '#/item/bulk-150' && document.querySelector('.main')`);
  await js(`history.back(); await settle(900);`);
  await waitFor(`document.querySelector('.list .row')`);
  check('back from an item card: the filter and the Show more rows are kept', await js(`return [rows(), byText('.frow .fchip', 'Short only').classList.contains('on')]`), [200, true]);
  await js(`await click('.frow .fchip', 'Short only');`);
  check('filter off: browsing again, no Show more', await js(`return !more()`), true);

  // ── R4: Labels for a selection ──
  await js(`await search('bulk part 12');`);
  await js(`await click('header.top .btn', 'Select');`);
  check('Labels is in the select bar, off until something is picked', await js(`const b = byText('.selbar .btn', 'Labels'); return [!!b, b.tagName, b.disabled]`), [true, 'BUTTON', true]);
  // One tap at a time, as a person taps them (each tap re-renders before the next).
  await js(`for (const b of $$('.list .selrow .cb').slice(0, 3)) { b.click(); await settle(200); }`);
  const picked = await js(`return $$('.list .selrow').slice(0, 3).map((r) => norm(r.querySelector('strong').textContent))`);
  check('three items picked', picked.length, 3);
  await shot('02-select-labels');
  await js(`byText('.selbar .btn', 'Labels').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); await settle(900);`);
  check('Labels opens the Labels tab with the selection, in list order', await js(`return [location.hash.startsWith('#/labels?ids='), decodeURIComponent(location.hash.split('ids=')[1]).split(',')]`), [true, ['bulk-012', 'bulk-112', 'bulk-120']]);
  check('…at the layout step', await js(`return norm($('.stp.on').textContent)`), '2Layout & print');
  await shot('03-labels-layout');

  // ── R2: Check for updates, when this is the newest version ──
  await js(`await go('#/more');`);
  check('About has Check for updates', await js(`return !!byText('.mrow', 'Check for updates')`), true);
  await js(`byText('.mrow', 'Check for updates').click();`);
  await waitFor(`[...document.querySelectorAll('.toast')].some((t) => t.textContent.includes('newest version'))`, 30000);
  check('it says this is the newest version, with the number', await js(`return norm([...document.querySelectorAll('.toast')].find((t) => t.textContent.includes('newest version')).textContent)`), `This is the newest version (${version}).`);
  await shot('04-check-for-updates');

  // ── Phone and portrait widths ──
  await js(`await go('#/inventory'); await search('bulk part');`);
  for (const [w, h] of [[390, 844], [800, 1280]]) {
    await size(w, h);
    await js(`await settle(400);`);
    check(`${w} px: Show more fits without sideways scrolling`, await js(`const b = more().getBoundingClientRect(); return [rows(), b.right <= innerWidth + 1, document.documentElement.scrollWidth <= innerWidth]`), [100, true, true]);
    await shot(`05-show-more-${w}`);
  }
} catch (e) {
  await fail(e);
} finally {
  await finish();
}
