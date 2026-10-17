// Hash routes, so a reload under the GitHub Pages sub-path never 404s (M1 review, finding 4).
import { useEffect, useState } from 'preact/hooks';

export type Tab = 'inventory' | 'order' | 'scan' | 'count' | 'labels' | 'more';

export type Route =
  | { tab: Tab; screen: 'tab' }
  | { tab: 'inventory'; screen: 'item'; id: string }
  | { tab: 'inventory'; screen: 'add'; name: string };

const TABS: readonly Tab[] = ['inventory', 'order', 'scan', 'count', 'labels', 'more'];

export function parseHash(hash: string): Route {
  const [path = '', query = ''] = hash.replace(/^#\/?/, '').split('?');
  const parts = path.split('/').map((p) => {
    try {
      return decodeURIComponent(p);
    } catch {
      return p;
    }
  });
  if (parts[0] === 'item' && parts[1]) return { tab: 'inventory', screen: 'item', id: parts[1] };
  if (parts[0] === 'add') return { tab: 'inventory', screen: 'add', name: new URLSearchParams(query).get('name') ?? '' };
  const tab = TABS.find((t) => t === parts[0]);
  return { tab: tab ?? 'inventory', screen: 'tab' };
}

export const href = {
  tab: (t: Tab) => `#/${t}`,
  item: (id: string) => `#/item/${encodeURIComponent(id)}`,
  add: (name = '') => (name ? `#/add?${new URLSearchParams({ name })}` : '#/add'),
};

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(location.hash));
  useEffect(() => {
    const on = () => setRoute(parseHash(location.hash));
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return route;
}
