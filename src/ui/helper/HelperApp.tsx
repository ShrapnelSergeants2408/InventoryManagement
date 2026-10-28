// Helper mode (SPEC §17, §18.3): the navy "HELPER · name" bar on every screen, so a helper is
// never mistaken for the shop tablet, and three tabs: Count (the F24 screens for the assigned
// groups), Scan (scan as you go, any item) and Send (§18.4). No PIN, no order list, no backups.
import { useEffect, useState } from 'preact/hooks';
import type { HelperDb } from '../../data/helper-db';
import { helperBarText } from '../../domain/helper-mode';
import { DbContext } from '../data-hooks';
import { Icon, type IconName } from '../icons';
import { CountScreen } from '../screens/count/Count';
import { StorageError } from '../screens/StorageError';
import { ToastHost } from '../shell/toast';
import { UpdateBanner } from '../shell/UpdateBanner';
import { HelperAddScreen } from './HelperAdd';
import { HelperSendScreen } from './HelperSend';
import { HelperContext, useHelperState } from './session';

export type HelperTab = 'count' | 'scan' | 'send';
export type HelperRoute = { screen: HelperTab } | { screen: 'add'; barcode: string };

export function parseHelperHash(hash: string): HelperRoute {
  const [path = '', query = ''] = hash.replace(/^#\/?/, '').split('?');
  if (path === 'add') return { screen: 'add', barcode: new URLSearchParams(query).get('barcode') ?? '' };
  if (path === 'scan' || path === 'send') return { screen: path };
  return { screen: 'count' };
}

export const helperHref = {
  tab: (t: HelperTab) => `#/${t}`,
  add: (barcode = '') => (barcode ? `#/add?${new URLSearchParams({ barcode })}` : '#/add'),
};

function useHelperRoute(): HelperRoute {
  const [route, setRoute] = useState(() => parseHelperHash(location.hash));
  useEffect(() => {
    const on = () => setRoute(parseHelperHash(location.hash));
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return route;
}

const TABS: ReadonlyArray<[HelperTab, string, IconName]> = [
  ['count', 'Count', 'count'],
  ['scan', 'Scan', 'scan'],
  ['send', 'Send', 'upload'],
];

export function HelperApp({ db, onLeft }: { db: HelperDb; onLeft: () => void }) {
  const live = useHelperState(db);
  const route = useHelperRoute();
  const tab: HelperTab = route.screen === 'add' ? 'count' : route.screen;

  if (live.state === 'error') {
    return (
      <div class="app happ">
        <main class="main">
          <StorageError error={live.error} />
        </main>
      </div>
    );
  }
  const state = live.state === 'ready' ? live.value : null;
  return (
    <DbContext.Provider value={db}>
      <HelperContext.Provider value={state ? { kit: state.kit, unsent: state.unsent } : null}>
        <div class="app happ">
          <div class="hbar" role="banner">
            <Icon name="phone" />
            <strong>HELPER</strong>
            <span class="hbar-t">{state ? `· ${helperBarText(state.kit)}` : ''}</span>
          </div>
          <main class="main">
            <UpdateBanner />
            {state === null ? (
              <div class="state" aria-busy="true">
                <p class="state-text muted">Loading…</p>
              </div>
            ) : route.screen === 'add' ? (
              <HelperAddScreen key={route.barcode} barcode={route.barcode} />
            ) : route.screen === 'send' ? (
              <HelperSendScreen db={db} state={state} onLeft={onLeft} />
            ) : (
              <CountScreen key={route.screen} scanOnly={route.screen === 'scan'} />
            )}
          </main>
          <nav class="hnav" aria-label="Helper">
            {TABS.map(([t, label, icon]) => (
              <a key={t} href={helperHref.tab(t)} class={t === tab ? 'on' : undefined} aria-current={t === tab ? 'page' : undefined}>
                <Icon name={icon} class="ic lg" />
                <span>
                  {label}
                  {t === 'send' && state && state.unsent > 0 && <span class="hbadge">{state.unsent}</span>}
                </span>
              </a>
            ))}
          </nav>
          <ToastHost />
        </div>
      </HelperContext.Provider>
    </DbContext.Provider>
  );
}
