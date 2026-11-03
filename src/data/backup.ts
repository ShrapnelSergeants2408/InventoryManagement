// Reads for a backup, the record that one was exported (F18), and applying a restore.
import { buildDataCsv, buildFullBackup, type BackupKind } from '../io/backup';
import type { RestorePlan } from '../io/restore';
import type { InventoryDb } from './db';
import { loadSnapshot, replaceAll, type ReplaceAllInput } from './inventory';
import { photoInfo } from './photos';
import { setSettings } from './settings';

/** The backup file's contents, read in one transaction so records and photos agree. */
export async function buildBackup(db: InventoryDb, kind: BackupKind, now: Date): Promise<Blob> {
  if (kind === 'data') {
    const snap = await loadSnapshot(db);
    return new Blob([buildDataCsv(snap)], { type: 'text/csv' });
  }
  const { snap, rows } = await db.transaction('r', [db.items, db.areas, db.spots, db.bins, db.seasons, db.tagList, db.categoryList, db.pictures], async () => ({
    snap: await loadSnapshot(db),
    rows: await db.pictures.toArray(),
  }));
  return buildFullBackup({ ...snap, photos: rows.map(photoInfo) }, new Map(rows.map((p) => [p.id, p.full] as const)), now);
}

/** Exporting (shared or saved) resets the reminder clock (F18). */
export async function recordBackup(db: InventoryDb, at: number): Promise<void> {
  await setSettings(db, { lastBackupAt: at });
}

export async function photoCount(db: InventoryDb): Promise<number> {
  return db.pictures.count();
}

/** What a restore plan writes (restore, or first setup from a backup). */
export const planInput = (plan: RestorePlan): ReplaceAllInput => ({ ...plan.data, images: plan.images, missingImages: plan.missingImages });

/** Applies a restore plan (F18) in one transaction. Returns how many photos are stored. */
export async function applyRestore(db: InventoryDb, plan: RestorePlan, now = Date.now()): Promise<number> {
  return replaceAll(db, planInput(plan), now);
}
