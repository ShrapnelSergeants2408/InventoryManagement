// Reads for a backup and the record that one was exported (F15, F16).
import { buildDataCsv, buildFullBackup, type BackupKind } from '../io/backup';
import type { InventoryDb } from './db';
import { loadSnapshot } from './inventory';
import { setSettings } from './settings';

/** The backup file's contents, read in one transaction so items and photos agree. */
export async function buildBackup(db: InventoryDb, kind: BackupKind, now: Date): Promise<Blob> {
  if (kind === 'data') {
    const snap = await loadSnapshot(db);
    return new Blob([buildDataCsv(snap)], { type: 'text/csv' });
  }
  const { snap, photos } = await db.transaction('r', [db.items, db.suppliers, db.locations, db.categories, db.photos], async () => ({
    snap: await loadSnapshot(db),
    photos: new Map((await db.photos.toArray()).map((p) => [p.itemId, p.full] as const)),
  }));
  return buildFullBackup(snap, photos, now);
}

/** Exporting (shared or saved to Downloads) resets the reminder clock (F16, Q1). */
export async function recordBackup(db: InventoryDb, at: number): Promise<void> {
  await setSettings(db, { lastBackupAt: at });
}

export async function photoCount(db: InventoryDb): Promise<number> {
  return db.photos.count();
}
