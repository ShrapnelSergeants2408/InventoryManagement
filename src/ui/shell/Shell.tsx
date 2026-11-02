// App frame: side rail in landscape, bottom tabs in portrait. H3 replaces it with the
// phone-first tab bar (SPEC v2.0 §10).
import type { ComponentChildren } from 'preact';
import { Icon, type IconName } from '../icons';
import { href, type Tab } from './router';
import { ToastHost } from './toast';
import { UpdateBanner } from './UpdateBanner';

const NAV: ReadonlyArray<[Tab, string, IconName]> = [
  ['inventory', 'Inventory', 'inventory'],
  ['scan', 'Scan', 'scan'],
  ['labels', 'Labels', 'labels'],
  ['more', 'More', 'more'],
];

export function Shell({ tab, children }: { tab: Tab; children: ComponentChildren }) {
  return (
    <div class="app">
      <nav class="nav" aria-label="Main">
        {NAV.map(([t, label, icon]) => (
          <a key={t} href={href.tab(t)} class={t === tab ? 'on' : undefined} aria-current={t === tab ? 'page' : undefined}>
            <Icon name={icon} class="ic lg" />
            <span>{label}</span>
          </a>
        ))}
      </nav>
      <main class="main">
        <UpdateBanner />
        {children}
      </main>
      <ToastHost />
    </div>
  );
}
