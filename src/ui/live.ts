// Live reads for screens (review R7, M33): Dexie liveQuery re-runs the query whenever a table it read
// changes. One place for the subscribe/unsubscribe pattern that eight hooks used to repeat.
import { liveQuery } from 'dexie';
import { useEffect, useState } from 'preact/hooks';

export type Live<T> = { state: 'loading' } | { state: 'ready'; value: T } | { state: 'error'; error: unknown };

/**
 * The query's result, live: loading, then ready (again after each change), or error. `deps` restart
 * the subscription (usually [db]); the last result stays on screen until the new one arrives.
 */
export function useLive<T>(query: () => Promise<T>, deps: readonly unknown[]): Live<T> {
  const [live, setLive] = useState<Live<T>>({ state: 'loading' });
  useEffect(() => {
    const sub = liveQuery(query).subscribe({
      next: (value) => setLive({ state: 'ready', value }),
      error: (error: unknown) => setLive({ state: 'error', error }),
    });
    return () => sub.unsubscribe();
    // The caller's deps decide when the query changes, as with useEffect.
  }, deps);
  return live;
}

/**
 * The query's value, live, starting from `initial` while it loads. When a read fails, 'keep' leaves
 * the last value (settings: a hiccup shouldn't reset limits on screen) and 'reset' goes back to
 * `initial` (an undo record: better none than a stale one).
 */
export function useLiveValue<T>(query: () => Promise<T>, initial: T, deps: readonly unknown[], onError: 'keep' | 'reset'): T {
  const [value, setValue] = useState<T>(initial);
  useEffect(() => {
    const sub = liveQuery(query).subscribe({
      next: setValue,
      error: () => onError === 'reset' && setValue(initial),
    });
    return () => sub.unsubscribe();
  }, deps);
  return value;
}
