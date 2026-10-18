// Hash routes, so a reload under the GitHub Pages sub-path never 404s (M1 review, finding 4).
import { useEffect, useState } from 'preact/hooks';

export type Tab = 'inventory' | 'order' | 'scan' | 'count' | 'labels' | 'more';

export type ManagedList = 'suppliers' | 'categories' | 'locations';

export type Route =
  | { tab: Tab; screen: 'tab' }
  | { tab: 'inventory'; screen: 'item'; id: string }
  | { tab: 'inventory'; screen: 'edit'; id: string }
  | { tab: 'inventory'; screen: 'add'; name: string }
  | { tab: 'more'; screen: ManagedList };

const TABS: readonly Tab[] = ['inventory', 'order', 'scan', 'count', 'labels', 'more'];
const LISTS: readonly ManagedList[] = ['suppliers', 'categories', 'locations'];

export function parseHash(hash: string): Route {
  const [path = '', query = ''] = hash.replace(/^#\/?/, '').split('?');
  const parts = path.split('/').map((p) => {
    try {
      return decodeURIComponent(p);
    } catch {
      return p;
    }
  });
  if (parts[0] === 'item' && parts[1]) {
    return parts[2] === 'edit' ? { tab: 'inventory', screen: 'edit', id: parts[1] } : { tab: 'inventory', screen: 'item', id: parts[1] };
  }
  if (parts[0] === 'add') return { tab: 'inventory', screen: 'add', name: new URLSearchParams(query).get('name') ?? '' };
  if (parts[0] === 'more') {
    const list = LISTS.find((l) => l === parts[1]);
    if (list) return { tab: 'more', screen: list };
  }
  const tab = TABS.find((t) => t === parts[0]);
  return { tab: tab ?? 'inventory', screen: 'tab' };
}

export const href = {
  tab: (t: Tab) => `#/${t}`,
  item: (id: string) => `#/item/${encodeURIComponent(id)}`,
  edit: (id: string) => `#/item/${encodeURIComponent(id)}/edit`,
  add: (name = '') => (name ? `#/add?${new URLSearchParams({ name })}` : '#/add'),
  list: (l: ManagedList) => `#/more/${l}`,
};

// History entries are numbered, so Back can tell whether the previous screen is in the app
// (then it goes back, keeping the list's place) or not (then it opens the parent screen).
let replacing = false;
let index = 0;

function stamp(): void {
  const s = history.state as { appIndex?: unknown } | null;
  if (typeof s?.appIndex === 'number') index = s.appIndex;
  else {
    if (!replacing) index += 1;
    history.replaceState({ appIndex: index }, '');
  }
  replacing = false;
}

/** Opens `to` in place of the current screen (after a save, so Back skips the editor). */
export function replaceRoute(to: string): void {
  replacing = true;
  location.replace(to);
}

/** Back button: the previous in-app screen, or `fallback` when the app was opened here. */
export function goBack(fallback: string): void {
  const s = history.state as { appIndex?: unknown } | null;
  if (typeof s?.appIndex === 'number' && s.appIndex > 0) history.back();
  else replaceRoute(fallback);
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(location.hash));
  useEffect(() => {
    const s = history.state as { appIndex?: unknown } | null;
    if (typeof s?.appIndex === 'number') index = s.appIndex;
    else history.replaceState({ appIndex: 0 }, '');
    const on = () => {
      stamp();
      setRoute(parseHash(location.hash));
    };
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return route;
}
