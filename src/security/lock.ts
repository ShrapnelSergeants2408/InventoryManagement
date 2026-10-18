// Unlock state (§6, D6): after the PIN, mentor tools stay open for the unlock length and then
// relock by themselves; the lock button relocks early. Kept in memory only, so reloading the
// app locks it.

let until: number | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

const notify = () => {
  for (const fn of [...listeners]) fn();
};

export function unlockFor(ms: number, now = Date.now()): void {
  if (timer) clearTimeout(timer);
  until = now + ms;
  timer = setTimeout(lockNow, ms);
  notify();
}

export function lockNow(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  const was = until !== null;
  until = null;
  if (was) notify();
}

/** ms left before relocking; 0 when locked. Locked from the exact moment the unlock length is up. */
export function unlockRemaining(now = Date.now()): number {
  return until === null ? 0 : Math.max(0, until - now);
}

export const isUnlocked = (now = Date.now()): boolean => unlockRemaining(now) > 0;

/** Called on unlock and on lock (timer or button). Returns the unsubscribe function. */
export function onLockChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** "4:10" */
export function formatRemaining(ms: number): string {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
