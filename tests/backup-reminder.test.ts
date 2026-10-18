import { describe, expect, it } from 'vitest';
import { DAY_MS, SNOOZE_MS, backupDue, daysSinceBackup, showBackupBanner } from '../src/domain/backup-reminder';

const T0 = Date.UTC(2026, 9, 17, 15, 0);
const clock = (over: Partial<Parameters<typeof backupDue>[0]> = {}) => ({ lastBackupAt: null, setupDoneAt: T0, reminderDays: 7, ...over });

describe('backup reminder (F16, D7)', () => {
  it('runs from setup when nothing was exported: no banner on day 1, due after 7 days', () => {
    expect(backupDue(clock(), T0)).toBe(false);
    expect(backupDue(clock(), T0 + 7 * DAY_MS - 1)).toBe(false);
    expect(backupDue(clock(), T0 + 7 * DAY_MS)).toBe(true);
  });

  it('an export of either kind resets the clock', () => {
    const c = clock({ lastBackupAt: T0 + 10 * DAY_MS });
    expect(backupDue(c, T0 + 11 * DAY_MS)).toBe(false);
    expect(backupDue(c, T0 + 17 * DAY_MS)).toBe(true);
  });

  it('follows the reminder-period setting', () => {
    expect(backupDue(clock({ reminderDays: 3 }), T0 + 3 * DAY_MS)).toBe(true);
    expect(backupDue(clock({ reminderDays: 14 }), T0 + 13 * DAY_MS)).toBe(false);
  });

  it('never before setup', () => {
    expect(backupDue(clock({ setupDoneAt: null }), T0 + 100 * DAY_MS)).toBe(false);
  });

  it('days since the last backup', () => {
    expect(daysSinceBackup(null, T0)).toBeNull();
    expect(daysSinceBackup(T0, T0 + 2 * DAY_MS + 5)).toBe(2);
    expect(daysSinceBackup(T0, T0 - 5)).toBe(0);
  });

  it('"Later" hides it for 12 hours (or until reload, which clears the snooze)', () => {
    const now = T0 + 8 * DAY_MS;
    expect(showBackupBanner(clock(), now, null)).toBe(true);
    expect(showBackupBanner(clock(), now, now)).toBe(false);
    expect(showBackupBanner(clock(), now + SNOOZE_MS - 1, now)).toBe(false);
    expect(showBackupBanner(clock(), now + SNOOZE_MS, now)).toBe(true);
    expect(showBackupBanner(clock({ lastBackupAt: now }), now + 1, null)).toBe(false);
    // A screen whose clock last ticked before "Later" was tapped stays hidden.
    expect(showBackupBanner(clock(), now - 30_000, now)).toBe(false);
  });
});
