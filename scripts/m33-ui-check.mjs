// M33 real-browser check (SPEC v0.28, review R8): the on-demand screens. Start-up loads only the main
// files; the others are fetched in the background soon after; an on-demand screen opens; and a screen
// whose file can't be loaded says so and offers Reload the app. The failure is made with the DevTools
// protocol (Network.setBlockedURLs, with the service worker bypassed so the request really goes out).
// Headless Chrome.
// Usage: npm run build && node scripts/m33-ui-check.mjs <chrome.exe> <screenshot dir>
import { PIN_H } from './pin-helpers.mjs';
import { startCheck } from './check-lib.mjs';

const H = `
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const settle = (ms = 350) => new Promise((r) => setTimeout(r, ms));
  const norm = (s) => s.replace(/\\s+/g, ' ').trim();
  const byText = (sel, t) => $$(sel).find((b) => norm(b.textContent).includes(t));
${PIN_H}
  const go = async (h) => { location.hash = h; await settle(700); };
  // The app's JavaScript files this page has fetched, by name without the content hash.
  const scripts = () => performance.getEntriesByType('resource').map((e) => e.name.split('/').pop()).filter((n) => n.endsWith('.js')).map((n) => n.replace(/-[\\w-]{8}\\.js$/, ''));
`;

const ON_DEMAND = ['Labels', 'Backup', 'History', 'Placed', 'Helpers', 'Import', 'Pending', 'Settings', 'Suppliers', 'Categories', 'Locations'];

const { js, waitFor, check, shot, size, send, fail, finish } = await startCheck({ previewPort: 4375, cdpPort: 9402, prelude: () => H });

try {
  await send('Runtime.enable');
  await send('Page.enable');
  await size(1280, 800);
  await send('Page.navigate', { url: 'http://localhost:4375/' });
  await waitFor(`document.querySelector('.setup')`, 60000);
  await js(`await doSetup();`);
  await waitFor(`document.querySelectorAll('.cathdr').length >= 11`, 60000);

  // ── A fresh start: the main files first, the rest in the background ──
  await send('Page.reload');
  await waitFor(`document.querySelectorAll('.cathdr').length >= 11`, 60000);
  const early = await js(`return scripts()`);
  check('at start-up: the main file, and none of the on-demand screens yet', [early.includes('index'), ON_DEMAND.filter((n) => early.includes(n))], [true, []]);
  await js(`await settle(3500);`);
  const later = await js(`return scripts()`);
  check('about 1.5 s later: every on-demand screen was fetched in the background', ON_DEMAND.filter((n) => !later.includes(n)), []);
  await js(`await go('#/more/backup');`);
  check('an on-demand screen opens', await js(`return !!byText('.bkcard', 'Full backup')`), true);

  // ── A screen whose file can't be loaded ──
  await send('Network.enable');
  await send('Network.setBypassServiceWorker', { bypass: true });
  await send('Network.setBlockedURLs', { urls: ['*/assets/History-*.js'] });
  // A real load (a query string, not just a new #), so the screen's file is fetched again.
  await send('Page.navigate', { url: 'http://localhost:4375/?m33=1#/placed' });
  await waitFor(`!!byText('.state', 'Couldn’t open this screen')`, 30000);
  check(
    'it says so, without changing anything, and offers Reload the app',
    await js(`const s = byText('.state', 'Couldn’t open this screen'); return [s.getAttribute('role'), norm(s.querySelector('.state-text').textContent), $$('.state .btn').map((b) => norm(b.textContent))]`),
    ['alert', 'This copy of the app may be out of date. Reloading gets the newest one; nothing on this tablet changes.', ['Reload the app']],
  );
  await shot('01-screen-not-loaded');
  check('the rest of the app still works: back to Inventory', await js(`await go('#/inventory'); return document.querySelectorAll('.cathdr').length >= 11`), true);

  // Unblocked: Reload the app brings the screen back.
  await send('Network.setBlockedURLs', { urls: [] });
  await send('Network.setBypassServiceWorker', { bypass: false });
  await js(`await go('#/placed');`);
  await waitFor(`!!byText('.state .btn', 'Reload the app') || !!byText('.top h1', 'Order history')`, 15000);
  // A failed load isn't kept (lazy.tsx), and Chrome fetches the file again: no reload needed.
  check('unblocked, going back to it opens it (the load is tried again)', await js(`return norm($('.top h1')?.textContent ?? '')`), 'Order history');

  // Reload the app, with another screen blocked: the button reloads the page, and once the file can
  // be fetched the screen opens.
  await send('Network.setBypassServiceWorker', { bypass: true });
  await send('Network.setBlockedURLs', { urls: ['*/assets/Settings-*.js'] });
  await send('Page.navigate', { url: 'http://localhost:4375/?m33=2#/more/settings' });
  await waitFor(`!!byText('.state .btn', 'Reload the app')`, 30000);
  await send('Network.setBlockedURLs', { urls: [] });
  await send('Network.setBypassServiceWorker', { bypass: false });
  await js(`window.__before = true; byText('.state .btn', 'Reload the app').click();`);
  await waitFor(`!window.__before && !!document.querySelector('.top h1')`, 30000);
  check('Reload the app reloads the page and the screen opens', await js(`return [location.hash, !byText('.state', 'Couldn’t open this screen')]`), ['#/more/settings', true]);
} catch (e) {
  await fail(e);
} finally {
  await finish();
}
