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

/**
 * How far ahead of the clock a time may be before it's taken as wrong (M23): a backup or
 * snooze time from a tablet whose clock was ahead and has since been corrected.
 */
export const FUTURE_SLACK_MS = 60 * 60 * 1000;

/** The last backup is dated later than this tablet's clock allows (M23). */
export const backupInFuture = (lastBackupAt: number | null, now: number) => lastBackupAt !== null && lastBackupAt - now > FUTURE_SLACK_MS;

/**
 * True once a whole reminder period has passed with no backup. Before setup: never. A backup
 * dated in the future can't say how long ago it was, so the reminder shows (M23).
 */
export function backupDue(c: ReminderClock, now: number): boolean {
  if (backupInFuture(c.lastBackupAt, now)) return true;
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
 * still counts as snoozed. A snooze more than an hour ahead of the clock (the clock was moved
 * back) no longer counts (M23).
 */
export function showBackupBanner(c: ReminderClock, now: number, snoozedAt: number | null): boolean {
  if (!backupDue(c, now)) return false;
  if (snoozedAt !== null && snoozedAt - now > FUTURE_SLACK_MS) return true;
  return snoozedAt === null || now - snoozedAt >= SNOOZE_MS;
}
