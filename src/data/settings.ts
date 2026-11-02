// Device settings (never part of a backup, SPEC v2.0 §7).
import type { InventoryDb } from './db';

export interface Settings {
  /** Backup reminder period in days, or 0 for off (F18: monthly by default). */
  reminderDays: number;
  /** ms since epoch of the last exported backup of either kind, or null. */
  lastBackupAt: number | null;
  /** ms since epoch when first-launch setup finished, or null before setup. */
  setupDoneAt: number | null;
  /** ms since epoch of the last change to inventory data (restore comparison, F18). */
  lastChangeAt: number | null;
}

export const DEFAULT_SETTINGS: Readonly<Settings> = {
  reminderDays: 30,
  lastBackupAt: null,
  setupDoneAt: null,
  lastChangeAt: null,
};

/** Allowed backup reminder periods: 0 (off) to 90 days. */
export const REMINDER_DAYS_MAX = 90;

export async function getSettings(db: InventoryDb): Promise<Settings> {
  const rows = await db.settings.bulkGet(Object.keys(DEFAULT_SETTINGS));
  const out: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const row of rows) if (row) out[row.key] = row.value;
  return out as unknown as Settings;
}

export async function setSettings(db: InventoryDb, patch: Partial<Settings>): Promise<void> {
  await db.settings.bulkPut(Object.entries(patch).map(([key, value]) => ({ key, value })));
}
