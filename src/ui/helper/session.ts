// Helper mode (SPEC §18.3): screens shared with the shop tablet (count-in, the location
// scanner, the top bar) read this to tell a helper device apart. null on the shop tablet.
import { liveQuery } from 'dexie';
import { createContext } from 'preact';
import { useContext, useEffect, useState } from 'preact/hooks';
import { loadHelperState, type HelperDb, type HelperState } from '../../data/helper-db';
import { loadCountOptions, saveCountOptions, saveCountPause } from '../../data/prefs';
import type { HelperKit } from '../../domain/helper-mode';
import type { Live } from '../data-hooks';

export interface HelperSession {
  kit: HelperKit;
  /** "n changes not sent yet" (§18.4). */
  unsent: number;
}

export const HelperContext = createContext<HelperSession | null>(null);

/** The helper's kit and unsent count, or null on the shop tablet. */
export function useHelper(): HelperSession | null {
  return useContext(HelperContext);
}

/** A new kit: count-in starts by the kit's kind of group, with nothing paused from an earlier kit. */
export function countPrefsForKit(kit: HelperKit): void {
  saveCountOptions({ ...loadCountOptions(), mode: kit.kind });
  saveCountPause(null);
}

/** The helper's kit, changes and pending items, live. */
export function useHelperState(db: HelperDb): Live<HelperState | null> {
  const [live, setLive] = useState<Live<HelperState | null>>({ state: 'loading' });
  useEffect(() => {
    const sub = liveQuery(() => loadHelperState(db)).subscribe({
      next: (value) => setLive({ state: 'ready', value }),
      error: (error: unknown) => setLive({ state: 'error', error }),
    });
    return () => sub.unsubscribe();
  }, [db]);
  return live;
}
