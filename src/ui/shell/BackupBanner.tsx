// Backup reminder banner (F16, S4): on Inventory and Backup only. "Later" hides it until the
// app is reloaded or for 12 hours (Q10); the snooze lives in memory, so a reload clears it.
import { useEffect, useState } from 'preact/hooks';
import { backupInFuture, daysSinceBackup, showBackupBanner } from '../../domain/backup-reminder';
import { useNow, useSettings } from '../data-hooks';
import { Icon } from '../icons';
import { href } from './router';

let snoozedAt: number | null = null;
const listeners = new Set<() => void>();

function snooze(): void {
  snoozedAt = Date.now();
  for (const l of listeners) l();
}

export function BackupBanner({ onBackupScreen = false }: { onBackupScreen?: boolean }) {
  const settings = useSettings();
  const now = useNow();
  const [, redraw] = useState(0);
  useEffect(() => {
    const l = () => redraw((n) => n + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  if (!showBackupBanner(settings, now, snoozedAt)) return null;

  const days = daysSinceBackup(settings.lastBackupAt, now);
  const lead = backupInFuture(settings.lastBackupAt, now)
    ? 'The last backup is dated later than this tablet’s clock, so the clock was changed since.'
    : days === null
      ? 'No backup yet.'
      : `No backup in the last ${settings.reminderDays} days (last one ${days} days ago).`;
  return (
    <div class="banner" role="status">
      <Icon name="clock" />
      <span class="grow">
        {lead} {onBackupScreen ? 'Share a full or data-only backup to clear this reminder.' : 'A backup is the only way back if this tablet is lost, reset or broken.'}
      </span>
      {!onBackupScreen && (
        <a class="btn onb" href={href.backup}>
          Back up now
        </a>
      )}
      <button type="button" class="btn onb" onClick={snooze}>
        Later
      </button>
    </div>
  );
}
