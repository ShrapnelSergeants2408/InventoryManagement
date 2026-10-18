// Lock button on every screen (§6, §17): "Locked", or "Unlocked m:ss" counting down. Tapping
// it opens the PIN pad, or locks at once while unlocked.
import { useContext, useEffect, useState } from 'preact/hooks';
import { gate } from '../../security/gate';
import { formatRemaining, lockNow, onLockChange, unlockRemaining } from '../../security/lock';
import { DbContext, useSettings } from '../data-hooks';
import { Icon } from '../icons';

/** ms until mentor tools relock (0 when locked); re-renders every second while unlocked. */
export function useUnlockRemaining(): number {
  const [, tick] = useState(0);
  useEffect(() => onLockChange(() => tick((n) => n + 1)), []);
  const left = unlockRemaining();
  useEffect(() => {
    if (left <= 0) return;
    // Wake on the next whole second of the countdown.
    const t = setTimeout(() => tick((n) => n + 1), left % 1000 || 1000);
    return () => clearTimeout(t);
  });
  return left;
}

export function unlockReason(minutes: number): string {
  return `Unlock mentor tools for ${minutes} minute${minutes === 1 ? '' : 's'}`;
}

export function LockPill() {
  // Before the database opens (loading, storage error) there's nothing to unlock.
  if (!useContext(DbContext)) {
    return (
      <button class="lockpill" type="button" aria-label="Mentor tools locked" disabled>
        <Icon name="lock" />
        Locked
      </button>
    );
  }
  return <LivePill />;
}

function LivePill() {
  const left = useUnlockRemaining();
  const { unlockMinutes } = useSettings();
  if (left > 0) {
    const t = formatRemaining(left);
    return (
      <button class="lockpill on" type="button" aria-label={`Mentor tools unlocked, ${t} left. Lock now`} onClick={lockNow}>
        <Icon name="unlock" />
        Unlocked <span class="tnum">{t}</span>
      </button>
    );
  }
  return (
    <button class="lockpill" type="button" aria-label="Mentor tools locked. Unlock with the PIN" onClick={() => void gate(unlockReason(unlockMinutes))}>
      <Icon name="lock" />
      Locked
    </button>
  );
}
