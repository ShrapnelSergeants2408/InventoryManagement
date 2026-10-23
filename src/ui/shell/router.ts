// Hash routes, so a reload under the GitHub Pages sub-path never 404s (M1 review, finding 4).
import { useEffect, useState } from 'preact/hooks';

export type Tab = 'inventory' | 'order' | 'scan' | 'count' | 'labels' | 'more';

export type ManagedList = 'suppliers' | 'categories' | 'locations';

export type Route =
  | { tab: Tab; screen: 'tab' }
  | { tab: 'inventory'; screen: 'item'; id: string }
  | { tab: 'inventory'; screen: 'edit'; id: string }
  | { tab: 'inventory'; screen: 'add'; name: string; barcode: string }
  | { tab: 'labels'; screen: 'labels'; ids: string[] }
  | { tab: 'order'; screen: 'orderList'; id: string }
  | { tab: 'more'; screen: ManagedList }
  | { tab: 'more'; screen: 'backup' }
  | { tab: 'more'; screen: 'settings' };

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
  if (parts[0] === 'order' && parts[1]) return { tab: 'order', screen: 'orderList', id: parts[1] };
  if (parts[0] === 'add') {
    const q = new URLSearchParams(query);
    return { tab: 'inventory', screen: 'add', name: q.get('name') ?? '', barcode: q.get('barcode') ?? '' };
  }
  if (parts[0] === 'labels' && query) {
    const ids = (new URLSearchParams(query).get('ids') ?? '').split(',').filter(Boolean);
    if (ids.length) return { tab: 'labels', screen: 'labels', ids };
  }
  if (parts[0] === 'more') {
    const list = LISTS.find((l) => l === parts[1]);
    if (list) return { tab: 'more', screen: list };
    if (parts[1] === 'backup') return { tab: 'more', screen: 'backup' };
    if (parts[1] === 'settings') return { tab: 'more', screen: 'settings' };
  }
  const tab = TABS.find((t) => t === parts[0]);
  return { tab: tab ?? 'inventory', screen: 'tab' };
}

export const href = {
  tab: (t: Tab) => `#/${t}`,
  item: (id: string) => `#/item/${encodeURIComponent(id)}`,
  edit: (id: string) => `#/item/${encodeURIComponent(id)}/edit`,
  add: (name = '', barcode = '') => {
    const q = new URLSearchParams();
    if (name) q.set('name', name);
    if (barcode) q.set('barcode', barcode);
    return q.size ? `#/add?${q}` : '#/add';
  },
  /** A named order list (F27). */
  orderList: (id: string) => `#/order/${encodeURIComponent(id)}`,
  labels: (ids: string[]) => `#/labels?${new URLSearchParams({ ids: ids.join(',') })}`,
  list: (l: ManagedList) => `#/more/${l}`,
  backup: '#/more/backup',
  settings: '#/more/settings',
};

// History entries are numbered and remember the screen they were opened from, so Back can
// tell whether the previous screen is in the app (then it goes back, keeping the list's
// place) or not (then it opens the parent screen).
interface Stamp {
  appIndex: number;
  from: string | null;
}
const isStamp = (s: unknown): s is Stamp => typeof (s as Stamp | null)?.appIndex === 'number';

let replacing = false;
let index = 0;
let here = '';
let hereFrom: string | null = null;

function stamp(): void {
  const s: unknown = history.state;
  if (isStamp(s)) {
    index = s.appIndex;
    hereFrom = s.from;
  } else {
    // A replaced entry keeps the place it was opened from.
    const from = replacing ? hereFrom : here;
    if (!replacing) index += 1;
    history.replaceState({ appIndex: index, from } satisfies Stamp, '');
    hereFrom = from;
  }
  here = location.hash;
  replacing = false;
}

/** The screen (hash) the current one was opened from, when it was opened inside the app. */
export function openedFrom(): string | null {
  return hereFrom;
}

/** Opens `to` in place of the current screen (after a save, so Back skips the form). */
export function replaceRoute(to: string): void {
  replacing = true;
  location.replace(to);
}

/** Back button: the previous in-app screen, or `fallback` when the app was opened here. */
export function goBack(fallback: string): void {
  const s: unknown = history.state;
  if (isStamp(s) && s.appIndex > 0) history.back();
  else replaceRoute(fallback);
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(location.hash));
  useEffect(() => {
    const s: unknown = history.state;
    here = location.hash;
    if (isStamp(s)) {
      index = s.appIndex;
      hereFrom = s.from;
    } else history.replaceState({ appIndex: 0, from: null } satisfies Stamp, '');
    const on = () => {
      stamp();
      setRoute(parseHash(location.hash));
    };
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return route;
}
