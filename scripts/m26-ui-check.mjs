// M26 real-browser check (SPEC v0.21): the team's shared Drive folder links. Set in More › Reminders &
// limits (PIN), shown on Helper devices (a QR code and buttons), on Import counts, and carried in every
// kit (the helper's side is checked in m16b). Real IndexedDB, headless Chrome.
// Usage: npm run build && node scripts/m26-ui-check.mjs <chrome.exe> <screenshot dir>
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

const { js, waitFor, check, shot, size, send, fail, finish } = await startCheck({ previewPort: 4365, cdpPort: 9395, prelude: () => H });

const KITS = 'https://drive.google.com/drive/folders/KITS1';
const COUNTS = 'https://drive.google.com/drive/folders/COUNTS1';
const KITS_BOX = '#set-kitsFolder';
const COUNTS_BOX = '#set-countsFolder';

const save = `await click('.top .btn', 'Save'); await settle(500);`;
const setBoth = (k, c) => `await type('${KITS_BOX}', '${k}'); await type('${COUNTS_BOX}', '${c}');`;
const err = `return $$('.set-err').map((e) => norm(e.textContent))`;

try {
  await send('Runtime.enable');
  await send('Page.enable');
  await size(1280, 800);
  await send('Page.navigate', { url: 'http://localhost:4365/' });
  await waitFor(`document.querySelector('.setup')`, 60000);
  await js(`await doSetup();`);
  await waitFor(`document.querySelectorAll('.cathdr').length >= 11`, 60000);

  // ── Nothing set yet ──
  await js(`await go('#/count/helpers'); await settle(500);`);
  check('Helper devices, no links yet: a tip points to Reminders & limits; no folder card', await js(`return [!$('[aria-label="Shared Drive folders"]'), norm(byText('.lockline', 'Tip:')?.textContent ?? '').includes('Reminders & limits')]`), [true, true]);
  await js(`await go('#/count/import'); await settle(500);`);
  check('Import counts, no links yet: no folder button', await js(`return !byText('.imp-start a', 'Counts folder')`), true);

  // ── Settings ──
  await js(`await go('#/more/settings'); await click('.lockbar button', 'Unlock'); await answerGate(true, true);`);
  check('Settings: Kits and Counts folder link fields, empty and optional', await js(`return [$('${KITS_BOX}').value, $('${COUNTS_BOX}').value, !!$('label[for=set-kitsFolder]'), !!$('label[for=set-countsFolder]')]`), ['', '', true, true]);
  await js(`${setBoth('http://drive.google.com/x', 'the Counts folder')} ${save}`);
  check('http:// and plain words are refused, nothing saved', [await js(err), await js(`return (await idb('settings', 'kitsFolderUrl'))?.value ?? null`)], [['The Kits folder link must start with https://', 'The Counts folder link must be a web address like https://drive.google.com/drive/folders/…'], null]);
  await js(`${setBoth('javascript:alert(1)', 'https://drive.google.com/drive/folders/COUNTS1')} ${save}`);
  check('javascript: is refused too', await js(err), ['The Kits folder link must start with https://']);
  await js(`${setBoth(KITS, COUNTS)} ${save}`);
  check('valid links are saved, with a toast', await js(`return [(await idb('settings', 'kitsFolderUrl')).value, (await idb('settings', 'countsFolderUrl')).value, norm($('.toast span')?.textContent ?? '')]`), [KITS, COUNTS, 'Settings saved.']);
  await shot('01-settings-folders');

  // ── Where they show ──
  await js(`await go('#/count/helpers'); await settle(600);`);
  check('Helper devices: the folder card has a QR code and two buttons that open in a new tab', await js(`const c = $('[aria-label="Shared Drive folders"]'); return [!!c.querySelector('svg'), [...c.querySelectorAll('a')].map((a) => [norm(a.textContent), a.getAttribute('href'), a.target, a.rel])]`), [true, [['Open the Kits folder', KITS, '_blank', 'noopener noreferrer'], ['Open the Counts folder', COUNTS, '_blank', 'noopener noreferrer']]]);
  await shot('02-helper-devices-folders');
  await js(`await go('#/count/import'); await settle(500);`);
  check('Import counts: Open the Counts folder, beside Choose counts files', await js(`const a = byText('.imp-start a', 'Counts folder'); return [a.getAttribute('href'), a.target, norm($('.imp-start .btn.pri').textContent)]`), [COUNTS, '_blank', 'Choose counts files…']);
  await size(800, 1280);
  await js(`await go('#/count/helpers'); await settle(600);`);
  await shot('03-helper-devices-portrait');
  check('portrait: nothing wider than the screen; the buttons are at least 48 px tall', await js(`return [document.documentElement.scrollWidth <= innerWidth, $$('[aria-label="Shared Drive folders"] a').map((a) => a.getBoundingClientRect().height >= 47.5)]`), [true, [true, true]]);
  await size(1280, 800);

  // ── Cleared again ──
  await js(`await go('#/more/settings'); await settle(500); ${setBoth('', '')} ${save}`);
  await js(`await go('#/count/helpers'); await settle(500);`);
  check('cleared: back to the tip, no card', await js(`return [!$('[aria-label="Shared Drive folders"]'), !!byText('.lockline', 'Tip:')]`), [true, true]);
} catch (e) {
  await fail(e);
}
await finish();
