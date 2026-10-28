// Reads for a backup, the record that one was exported (F15, F16), and applying a restore (F17).
import { buildDataCsv, buildFullBackup, type BackupKind } from '../io/backup';
import type { InventoryDb } from './db';
import type { RestorePlan } from '../io/restore';
import { loadSnapshot, replaceAll } from './inventory';
import { loadOrderLists } from './order-lists';
import { loadPending, replacePending } from './pending';
import { setSettings } from './settings';

/** The backup file's contents, read in one transaction so items and photos agree. */
export async function buildBackup(db: InventoryDb, kind: BackupKind, now: Date): Promise<Blob> {
  if (kind === 'data') {
    const snap = await loadSnapshot(db);
    return new Blob([buildDataCsv(snap)], { type: 'text/csv' });
  }
  const { snap, photos, lists, pending, pendingPhotos } = await db.transaction('r', [db.items, db.suppliers, db.locations, db.categories, db.photos, db.orderLists, db.pendingItems, db.pendingPhotos], async () => ({
    snap: await loadSnapshot(db),
    photos: new Map((await db.photos.toArray()).map((p) => [p.itemId, p.full] as const)),
    lists: await loadOrderLists(db),
    pending: await loadPending(db),
    pendingPhotos: new Map((await db.pendingPhotos.toArray()).map((p) => [p.pendingId, p.full] as const)),
  }));
  return buildFullBackup(snap, photos, now, lists, pending, pendingPhotos);
}

/** Exporting (shared or saved to Downloads) resets the reminder clock (F16, Q1). */
export async function recordBackup(db: InventoryDb, at: number): Promise<void> {
  await setSettings(db, { lastBackupAt: at });
}

export async function photoCount(db: InventoryDb): Promise<number> {
  return db.photos.count();
}

/**
 * Applies a restore plan (F17) in one transaction: a CSV keeps the tablet's photos for matching
 * ids, its order lists (minus lines for items that are gone) and its pending items; a ZIP
 * replaces all three (§15 Q7d). Either clears Undo this import (§18.5). Returns how many items have a photo.
 */
export async function applyRestore(db: InventoryDb, plan: RestorePlan, now = Date.now()): Promise<number> {
  return db.transaction('rw', [db.items, db.photos, db.suppliers, db.locations, db.categories, db.orderLists, db.settings, db.pendingItems, db.pendingPhotos, db.importUndo], async () => {
    const n = await replaceAll(db, plan, now, { keepPhotos: plan.kind === 'csv', orderLists: plan.orderLists ?? undefined });
    if (plan.pending !== null) await replacePending(db, plan.pending, plan.pendingPhotos);
    await db.importUndo.clear();
    return n;
  });
}
