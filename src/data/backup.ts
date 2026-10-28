// Reads for a backup, the record that one was exported (F15, F16), and applying a restore (F17).
import { buildDataCsv, buildFullBackup, type BackupKind } from '../io/backup';
import type { InventoryDb } from './db';
import type { RestorePlan } from '../io/restore';
import { loadSnapshot, replaceAll } from './inventory';
import { loadOrderLists } from './order-lists';
import { loadPending, replacePending } from './pending';
import { loadOrders, replaceOrders } from './placed-orders';
import { setSettings } from './settings';

/** The backup file's contents, read in one transaction so items and photos agree. */
export async function buildBackup(db: InventoryDb, kind: BackupKind, now: Date): Promise<Blob> {
  if (kind === 'data') {
    const snap = await loadSnapshot(db);
    return new Blob([buildDataCsv(snap)], { type: 'text/csv' });
  }
  const tables = [db.items, db.suppliers, db.locations, db.categories, db.photos, db.orderLists, db.pendingItems, db.pendingPhotos, db.orders, db.receipts];
  const { snap, photos, lists, pending, pendingPhotos, orders, receipts } = await db.transaction('r', tables, async () => ({
    snap: await loadSnapshot(db),
    photos: new Map((await db.photos.toArray()).map((p) => [p.itemId, p.full] as const)),
    lists: await loadOrderLists(db),
    pending: await loadPending(db),
    pendingPhotos: new Map((await db.pendingPhotos.toArray()).map((p) => [p.pendingId, p.full] as const)),
    orders: await loadOrders(db),
    receipts: new Map((await db.receipts.toArray()).map((r) => [r.id, r.blob] as const)),
  }));
  return buildFullBackup(snap, photos, now, lists, pending, pendingPhotos, orders, receipts);
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
 * replaces all three (§15 Q7d). Placed orders and receipts are replaced by a full backup that
 * has orders.csv, and kept otherwise (§21.6). Either clears Undo this import (§18.5). Returns how many items have a photo.
 */
export async function applyRestore(db: InventoryDb, plan: RestorePlan, now = Date.now()): Promise<number> {
  const tables = [db.items, db.photos, db.suppliers, db.locations, db.categories, db.orderLists, db.settings, db.pendingItems, db.pendingPhotos, db.importUndo, db.orders, db.receipts];
  return db.transaction('rw', tables, async () => {
    const n = await replaceAll(db, plan, now, { keepPhotos: plan.kind === 'csv', orderLists: plan.orderLists ?? undefined });
    if (plan.pending !== null) await replacePending(db, plan.pending, plan.pendingPhotos);
    if (plan.orders !== null) await replaceOrders(db, plan.orders, plan.receipts);
    await db.importUndo.clear();
    return n;
  });
}
