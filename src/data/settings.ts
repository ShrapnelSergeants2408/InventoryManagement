// Device settings (SPEC §6 named settings; never part of a backup, §7).
import type { InventoryDb } from './db';

export interface Settings {
  /** Backup reminder period in days (F16). */
  reminderDays: number;
  /** Stale-price age in days (F14). */
  staleDays: number;
  /** PIN unlock length in minutes (§6). */
  unlockMinutes: number;
  /** ms since epoch of the last exported backup of either kind, or null. */
  lastBackupAt: number | null;
  /** ms since epoch when first-launch setup finished, or null before setup. */
  setupDoneAt: number | null;
  /** ms since epoch of the last change to inventory data (restore comparison, F17). */
  lastChangeAt: number | null;
  /** Season starts (§21.5): YYYY-MM-DD, or '' when not set ("This season" is hidden). */
  seasonStart: string;
  /** School year starts (§21.5): MM-DD. */
  schoolYearStart: string;
  /** Delivery overdue after (v0.17), in days. */
  overdueDays: number;
  /** School-year budget in cents (v0.17), or null for none. */
  budgetCents: number | null;
}

export const DEFAULT_SETTINGS: Readonly<Settings> = {
  reminderDays: 7,
  staleDays: 90,
  unlockMinutes: 5,
  lastBackupAt: null,
  setupDoneAt: null,
  lastChangeAt: null,
  seasonStart: '',
  schoolYearStart: '08-01',
  overdueDays: 14,
  budgetCents: null,
};

export async function getSettings(db: InventoryDb): Promise<Settings> {
  const rows = await db.settings.bulkGet(Object.keys(DEFAULT_SETTINGS));
  const out: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const row of rows) if (row) out[row.key] = row.value;
  return out as unknown as Settings;
}

export async function setSettings(db: InventoryDb, patch: Partial<Settings>): Promise<void> {
  await db.settings.bulkPut(Object.entries(patch).map(([key, value]) => ({ key, value })));
}
