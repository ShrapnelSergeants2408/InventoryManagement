// Backup reminder (F16; spec-questions Q10, D7). The clock runs from the last exported backup
// of either kind, or from first-launch setup when nothing has been exported yet.

export const DAY_MS = 24 * 60 * 60 * 1000;
/** "Later" hides the banner until the app is reloaded or for this long, whichever is first (Q10). */
export const SNOOZE_MS = 12 * 60 * 60 * 1000;

export interface ReminderClock {
  lastBackupAt: number | null;
  setupDoneAt: number | null;
  reminderDays: number;
}

/** True once a whole reminder period has passed with no backup. Before setup: never. */
export function backupDue(c: ReminderClock, now: number): boolean {
  const since = c.lastBackupAt ?? c.setupDoneAt;
  if (since === null) return false;
  return now - since >= c.reminderDays * DAY_MS;
}

/** Whole days since the last backup, or null when there has never been one. */
export function daysSinceBackup(lastBackupAt: number | null, now: number): number | null {
  return lastBackupAt === null ? null : Math.max(0, Math.floor((now - lastBackupAt) / DAY_MS));
}

/**
 * The banner shows when a backup is due and "Later" wasn't tapped within the snooze time.
 * `now` can be a little older than `snoozedAt` (a screen's clock ticks once a minute); that
 * still counts as snoozed.
 */
export function showBackupBanner(c: ReminderClock, now: number, snoozedAt: number | null): boolean {
  if (!backupDue(c, now)) return false;
  return snoozedAt === null || now - snoozedAt >= SNOOZE_MS;
}
