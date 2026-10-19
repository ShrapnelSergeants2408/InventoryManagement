// App frame (§17): side rail in landscape, bottom tabs in portrait.
import type { ComponentChildren } from 'preact';
import logoUrl from '../../../assets/team-logo-512.png?url';
import { Icon, type IconName } from '../icons';
import { href, type Tab } from './router';
import { ToastHost } from './toast';
import { UpdateBanner } from './UpdateBanner';

const NAV: ReadonlyArray<[Tab, string, IconName]> = [
  ['inventory', 'Inventory', 'inventory'],
  ['order', 'Order', 'order'],
  ['scan', 'Scan', 'scan'],
  ['count', 'Count', 'count'],
  ['labels', 'Labels', 'labels'],
  ['more', 'More', 'more'],
];

export function Shell({ tab, children }: { tab: Tab; children: ComponentChildren }) {
  return (
    <div class="app">
      <nav class="nav" aria-label="Main">
        <div class="nav-logo">
          <img src={logoUrl} alt="Shrapnel Sergeants, FRC Team 2408" />
        </div>
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
