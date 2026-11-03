// The part the app is showing (SPEC v3.0 F21): Household or Holiday. The phone remembers the
// last part used and opens in it. Tab screens set it from their address; a detail screen sets
// it to its record's part, so the tab bar and colors always match what's on screen.
import { useEffect, useState } from 'preact/hooks';
import { loadPart, savePart } from '../data/prefs';
import type { Part } from '../domain/types';

let current: Part = loadPart();
const listeners = new Set<(p: Part) => void>();

export const getPart = (): Part => current;

/** Changes the part; the tab bar and colors follow. Remembered for the next launch. */
export function setPart(p: Part): void {
  if (p === current) return;
  current = p;
  savePart(p);
  document.documentElement.dataset.part = p;
  for (const l of listeners) l(p);
}

/** The current part, live. */
export function usePart(): Part {
  const [p, setP] = useState(current);
  useEffect(() => {
    listeners.add(setP);
    setP(current);
    return () => void listeners.delete(setP);
  }, []);
  return p;
}

/** A detail screen follows its record's part (null while loading or when the record is gone). */
export function useRecordPart(p: Part | null | undefined): void {
  useEffect(() => {
    if (p) setPart(p);
  }, [p]);
}

if (typeof document !== 'undefined') document.documentElement.dataset.part = current;
