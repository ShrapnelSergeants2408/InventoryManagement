// M27 real-browser check (SPEC v0.22): a helper that counts only some subcategories of a category.
// Add helper shows the category's subcategories ticked; unticking leaves them for another helper; the
// card, the coverage list and the "also" hints say which parts. Real IndexedDB, headless Chrome.
// Usage: npm run build && node scripts/m27-ui-check.mjs <chrome.exe> <screenshot dir>
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

const { js, waitFor, check, shot, size, send, fail, finish } = await startCheck({ previewPort: 4366, cdpPort: 9396, prelude: () => H });

const add = (name) => `await go('#/count/helpers'); await settle(400); await click('.top .btn', 'Add helper'); await type('#hname', '${name}'); await settle(200);`;
const row = (cat) => `$$('.hgroup').find((x) => norm(x.querySelector('strong').textContent) === '${cat}')`;
const subsOf = (cat) => `$$('.hsubs[aria-label="Subcategories of ${cat}"] .hsub').map((b) => [norm(b.textContent), b.getAttribute('aria-checked')])`;
// One box at a time, like a person: each tap draws the dialog again.
const tick = (cat, names, on) => `for (const n of ${JSON.stringify([])}.concat($$('.hsubs[aria-label="Subcategories of ${cat}"] .hsub').map((b) => norm(b.textContent)).filter((n) => ${JSON.stringify(names)}.includes(n) === ${on}))) { $$('.hsubs[aria-label="Subcategories of ${cat}"] .hsub').find((b) => norm(b.textContent) === n).click(); await settle(120); } await settle(200);`;

try {
  await send('Runtime.enable');
  await send('Page.enable');
  await size(1280, 800);
  await send('Page.navigate', { url: 'http://localhost:4366/' });
  await waitFor(`document.querySelector('.setup')`, 60000);
  await js(`await doSetup();`);
  await waitFor(`document.querySelectorAll('.cathdr').length >= 11`, 60000);

  // A category with several subcategories in the starter catalog.
  const cat = await js(`const c = (await idb('categories')).find((x) => x.subcategories.length >= 3); return c ? [c.name, c.subcategories.slice(0, 3)] : null`);
  check('the starter catalog has a category with at least three subcategories', !!cat, true);
  const [C, subs] = cat;
  const [s1, s2] = subs;

  // ── Choosing a category shows its subcategories, all ticked ──
  await js(add('Wheels crew'));
  check('before a category is chosen there are no subcategory boxes', await js(`return $$('.hsubs').length`), 0);
  await js(`${row(C)}.click(); await settle(300);`);
  const shown = await js(`return ${subsOf(C)}`);
  check('choosing the category shows its subcategories, every one ticked, and says it is all of it', [shown.slice(0, 3), shown.every(([, on]) => on === 'true'), await js(`return norm($('.hsubs .small').textContent).startsWith('All of')`)], [subs.map((s) => [s, 'true']), true, true]);
  await shot('01-subcategories-ticked');

  // ── Untick all but two: only those parts ──
  await js(tick(C, [s1, s2], false));
  check('unticking the others leaves just those two, and the hint changes', [await js(`return ${subsOf(C)}.filter(([, on]) => on === 'true').map(([n]) => n)`), await js(`return norm($('.hsubs .small').textContent).startsWith('Only these parts')`)], [[s1, s2], true]);
  await shot('02-two-subcategories');
  // None ticked is refused.
  await js(tick(C, [s1, s2], true));
  await js(`await click('.dlg-actions .btn', 'Add helper'); await settle(400);`);
  check('with none ticked, Add helper explains what to do', await js(`return norm($('.dlg .err')?.textContent ?? '')`), 'Choose at least one subcategory of ' + C + ', or count all of it.');
  await js(tick(C, [s1, s2], true));
  await js(`await click('.dlg-actions .btn', 'Add helper'); await settle(800);`);
  check('saved: the helper card names the parts', await js(`return norm($('.hcard[aria-label="Helper Wheels crew"] .hcard-b strong').textContent)`), C + ' (' + s1 + ', ' + s2 + ')');
  check('stored with its limit', await js(`const h = (await idb('helpers'))[0]; return [h.groups, h.subcategories]`), [[C], { [C]: [s1, s2] }]);

  // ── A second helper takes the rest of the category: no clash ──
  await js(add('Rest crew'));
  await js(`${row(C)}.click(); await settle(300);`);
  check('the category row says who else has it', await js(`return norm(${row(C)}.textContent).includes('also Wheels crew')`), true);
  await js(tick(C, [s1, s2], true));
  const rest = await js(`return ${subsOf(C)}.filter(([, on]) => on === 'true').map(([n]) => n)`);
  check('unticking Wheels crew’s parts leaves everything else', [rest.includes(s1), rest.includes(s2), rest.length > 0], [false, false, true]);
  check('and the row no longer lists Wheels crew as sharing it', await js(`return !norm(${row(C)}.textContent).includes('also Wheels crew')`), true);
  await js(`await click('.dlg-actions .btn', 'Add helper'); await settle(800);`);
  check('saved without the “already assigned” question (no overlap)', await js(`return [!$('.dlg'), !!$('.hcard[aria-label="Helper Rest crew"]')]`), [true, true]);
  const cov = await js(`const r = $$('.cov-row').find((x) => norm(x.querySelector('strong').textContent) === '${C}'); return norm(r.textContent)`);
  check('the coverage list names both helpers with their parts and does not say both count it', [cov.includes('Wheels crew (' + s1 + ', ' + s2 + ')'), cov.includes('Rest crew ('), cov.includes('both count it')], [true, true, false]);
  await shot('03-coverage');

  // ── A third helper for the whole category overlaps: asked, as before ──
  await js(add('Everything'));
  await js(`${row(C)}.click(); await settle(300); await click('.dlg-actions .btn', 'Add helper'); await settle(500);`);
  check('a helper for the whole category is asked about the overlap', await js(`return [!!$('.dlg .hwarn'), norm($('.dlg-actions .btn.pri').textContent)]`), [true, 'Save anyway']);
  await js(`await click('.dlg-actions .btn', 'Cancel'); await settle(300);`);

  // ── Editing: the limit comes back ticked; making it whole drops it ──
  await js(`await click('[aria-label="Helper Wheels crew"] .btn', 'Edit'); await settle(500);`);
  check('Edit shows the two parts ticked and the rest unticked', await js(`return ${subsOf(C)}.filter(([, on]) => on === 'true').map(([n]) => n)`), [s1, s2]);
  await js(`for (const n of $$('.hsubs .hsub').filter((b) => b.getAttribute('aria-checked') === 'false').map((b) => norm(b.textContent))) { $$('.hsubs .hsub').find((b) => norm(b.textContent) === n).click(); await settle(120); } await settle(300); await click('.dlg-actions .btn', 'Save'); await settle(600); if ($('.dlg-actions .btn.pri')?.textContent.includes('anyway')) { await click('.dlg-actions .btn', 'Save anyway'); await settle(800); }`);
  check('ticking every subcategory means the whole category: the limit is gone', await js(`const h = (await idb('helpers')).find((x) => x.name === 'Wheels crew'); return [h.subcategories ?? null, norm($('.hcard[aria-label="Helper Wheels crew"] .hcard-b strong').textContent)]`), [null, C]);

  // ── Phone-size layout of the dialog ──
  await size(800, 1280);
  await js(add('Phone check'));
  await js(`${row(C)}.click(); await settle(300);`);
  await shot('04-dialog-portrait');
  check('portrait: the dialog fits; subcategory boxes are at least 48 px tall', await js(`return [document.documentElement.scrollWidth <= innerWidth, $$('.hsub').every((b) => b.getBoundingClientRect().height >= 47.5)]`), [true, true]);
  await size(1280, 800);
} catch (e) {
  await fail(e);
}
await finish();
