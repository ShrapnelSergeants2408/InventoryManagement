// Reads for a backup, the record that one was exported (F18), and applying a restore.
import { buildDataCsv, buildFullBackup, type BackupKind } from '../io/backup';
import type { InventoryDb } from './db';
import type { RestorePlan } from '../io/restore';
import { loadSnapshot, replaceAll } from './inventory';
import { setSettings } from './settings';

/** The backup file's contents, read in one transaction so items and photos agree. */
export async function buildBackup(db: InventoryDb, kind: BackupKind, now: Date): Promise<Blob> {
  if (kind === 'data') {
    const snap = await loadSnapshot(db);
    return new Blob([buildDataCsv(snap)], { type: 'text/csv' });
  }
  const { snap, photos } = await db.transaction('r', [db.items, db.locations, db.categories, db.photos], async () => ({
    snap: await loadSnapshot(db),
    photos: new Map((await db.photos.toArray()).map((p) => [p.itemId, p.full] as const)),
  }));
  return buildFullBackup(snap, photos, now);
}

/** Exporting (shared or saved) resets the reminder clock (F18). */
export async function recordBackup(db: InventoryDb, at: number): Promise<void> {
  await setSettings(db, { lastBackupAt: at });
}

export async function photoCount(db: InventoryDb): Promise<number> {
  return db.photos.count();
}

/**
 * Applies a restore plan (F18) in one transaction: a CSV keeps the phone's photos for matching
 * ids; a ZIP replaces them. Returns how many items have a photo.
 */
export async function applyRestore(db: InventoryDb, plan: RestorePlan, now = Date.now()): Promise<number> {
  return replaceAll(db, plan, now, { keepPhotos: plan.kind === 'csv' });
}
