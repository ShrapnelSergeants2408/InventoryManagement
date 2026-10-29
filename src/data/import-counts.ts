// Import counts on the shop tablet (SPEC §18.5): Apply saves everything in one transaction,
// recording first what Undo this import needs; Undo puts it all back. No PIN (§6): the preview
// and Undo are the safety nets. Only the last import can be undone, and a restore or a fresh
// setup forgets it.
import { planImport, type CountFields, type CountsFile, type ImportChoices, type ImportPlan, type PlanInput } from '../domain/import-counts';
import { nameKey } from '../domain/types';
import { fromHelperRow, fromItemRow, fromOrderRow, toLocationRow, type InventoryDb } from './db';
import { onOrderMap } from '../domain/placed-orders';
import { addPendingRows, decidedPending } from './pending';

const UNDO_ID = 'last';

/** What Undo this import puts back (§18.5). */
export interface ImportUndo {
  id: typeof UNDO_ID;
  /** ms since epoch the import was applied. */
  at: number;
  fileNames: string[];
  helperNames: string[];
  /** Item id → its fields before the import. */
  items: Array<[string, CountFields]>;
  /** Locations the import added. */
  locations: string[];
  /** Pending items the import added. */
  pending: string[];
  /** Helper id → last_import_at before. */
  helpers: Array<[string, number | null]>;
  /** Items received into since the import (F31): Undo leaves them as they are. Absent before v0.14. */
  received?: string[];
}

export interface ImportSummary {
  applied: number;
  conflictsSettled: number;
  skipped: number;
  outside: number;
  newItems: number;
  locationsAdded: number;
  totalBefore: number;
  totalAfter: number;
  helperNames: string[];
  at: number;
}

async function planInput(db: InventoryDb, files: readonly CountsFile[]): Promise<PlanInput> {
  const known = await decidedPending(db);
  for (const id of await db.pendingItems.toCollection().primaryKeys()) known.add(id);
  return {
    files,
    items: (await db.items.toArray()).map(fromItemRow),
    locations: (await db.locations.orderBy('order').toArray()).map(({ key: _k, ...l }) => l),
    helpers: (await db.helpers.toArray()).map(fromHelperRow),
    knownPending: known,
    onOrder: onOrderMap((await db.orders.toArray()).map(fromOrderRow)),
  };
}

const READ = (db: InventoryDb) => [db.items, db.locations, db.helpers, db.pendingItems, db.settings, db.orders];

/** The preview (§18.5 step 2) from the tablet as it is now. Nothing is saved. */
export async function previewImport(db: InventoryDb, files: readonly CountsFile[], choices?: ImportChoices): Promise<ImportPlan> {
  return db.transaction('r', READ(db), async () => planImport(await planInput(db, files), choices));
}

/**
 * Apply (§18.5 step 3): the preview is worked out again inside the transaction, from the
 * tablet as it is at that moment, and saved only if every conflict has a choice. All of it is
 * saved together; if anything fails, nothing is.
 */
export async function applyImport(db: InventoryDb, files: readonly CountsFile[], choices: ImportChoices, now = Date.now()): Promise<ImportSummary> {
  return db.transaction('rw', [...READ(db), db.pendingPhotos, db.importUndo], async () => {
    const plan = planImport(await planInput(db, files), choices);
    if (!plan.ready) throw new Error(`${plan.counts.conflictsLeft} conflict(s) still need a choice`);

    for (const [id, f] of plan.changes) {
      const row = await db.items.get(id);
      if (!row) throw new Error(`item ${id} was deleted during the import`);
      await db.items.put({ ...row, ...f, updatedAt: now });
    }
    const list = await db.locations.orderBy('order').toArray();
    const have = new Set(list.map((l) => l.key));
    let order = list.length ? Math.max(...list.map((l) => l.order)) + 1 : 0;
    const added: string[] = [];
    for (const name of plan.createdLocations) {
      if (have.has(nameKey(name))) continue;
      await db.locations.add(toLocationRow({ name, notes: '', order: order++ }));
      have.add(nameKey(name));
      added.push(name);
    }
    const photos = new Map<string, Blob>();
    for (const f of files) for (const [id, b] of f.photos) if (plan.pending.some((p) => p.id === id)) photos.set(id, b);
    await addPendingRows(db, plan.pending, photos);

    const helperIds = [...new Set(files.map((f) => f.meta.helperId))];
    const helpersBefore: Array<[string, number | null]> = [];
    for (const id of helperIds) {
      const h = await db.helpers.get(id);
      if (!h) continue;
      helpersBefore.push([id, h.lastImportAt]);
      await db.helpers.put({ ...h, lastImportAt: now });
    }
    const helperNames = [...new Set(files.map((f) => f.meta.helperName))];
    const undo: ImportUndo = {
      id: UNDO_ID,
      at: now,
      fileNames: files.map((f) => f.fileName),
      helperNames,
      items: [...plan.previous],
      locations: added,
      pending: plan.pending.map((p) => p.id),
      helpers: helpersBefore,
    };
    await db.importUndo.clear();
    await db.importUndo.put(undo as unknown as { id: string });
    await db.settings.put({ key: 'lastChangeAt', value: now });
    return {
      applied: plan.counts.apply + plan.rows.filter((r) => r.kind === 'conflict' && r.conflict?.choice !== 'keep').length,
      conflictsSettled: plan.counts.conflicts,
      skipped: plan.counts.applied + plan.counts.unknown,
      outside: plan.counts.outside,
      newItems: plan.pending.length,
      locationsAdded: added.length,
      totalBefore: plan.totalBefore,
      totalAfter: plan.totalAfter,
      helperNames,
      at: now,
    };
  });
}

/** The import Undo would reverse, or null (none since the last restore or setup). */
export async function getImportUndo(db: InventoryDb): Promise<ImportUndo | null> {
  const row = await db.importUndo.get(UNDO_ID);
  return row ? (row as unknown as ImportUndo) : null;
}

/** Notes an item received into (F31), so Undo this import leaves it alone. Call inside the receive transaction. */
export async function noteReceivedSinceImport(db: InventoryDb, itemIds: readonly string[]): Promise<void> {
  const undo = await getImportUndo(db);
  if (!undo) return;
  const changed = new Set(undo.items.map(([id]) => id));
  const received = new Set(undo.received ?? []);
  const add = itemIds.filter((id) => changed.has(id) && !received.has(id));
  if (add.length === 0) return;
  await db.importUndo.put({ ...undo, received: [...received, ...add] } as unknown as { id: string });
}

/** The items Undo this import would put back: changed by the import and not received into since. */
export const undoableItems = (undo: ImportUndo) => {
  const received = new Set(undo.received ?? []);
  return undo.items.filter(([id]) => !received.has(id));
};

/**
 * Undo this import (§18.5): every changed item gets back its on_hand, location, barcode,
 * last_counted and counted_by exactly, except items received into since (v0.14), which keep
 * what they have; the pending items the import added are removed (ones already accepted stay);
 * the locations it added are removed if no item uses them.
 */
export async function undoImport(db: InventoryDb, now = Date.now()): Promise<{ items: number; kept: number; pending: number; locations: number }> {
  return db.transaction('rw', [db.items, db.locations, db.pendingItems, db.pendingPhotos, db.helpers, db.importUndo, db.settings], async () => {
    const undo = await getImportUndo(db);
    if (!undo) throw new Error('there is no import to undo');
    let items = 0;
    const back = undoableItems(undo);
    for (const [id, f] of back) {
      const row = await db.items.get(id);
      if (!row) continue;
      await db.items.put({ ...row, ...f, updatedAt: now });
      items++;
    }
    const stillPending = (await db.pendingItems.bulkGet(undo.pending)).filter((r): r is NonNullable<typeof r> => r !== undefined).map((r) => r.id);
    await db.pendingItems.bulkDelete(stillPending);
    await db.pendingPhotos.bulkDelete(stillPending);
    const inUse = new Set((await db.items.toArray()).filter((i) => i.location !== '').map((i) => nameKey(i.location)));
    let locations = 0;
    for (const name of undo.locations) {
      if (inUse.has(nameKey(name))) continue;
      await db.locations.delete(nameKey(name));
      locations++;
    }
    // Walk order without gaps.
    const left = await db.locations.orderBy('order').toArray();
    await db.locations.bulkPut(left.map((l, i) => ({ ...l, order: i })));
    for (const [id, at] of undo.helpers) {
      const h = await db.helpers.get(id);
      if (h) await db.helpers.put({ ...h, lastImportAt: at });
    }
    await db.importUndo.clear();
    await db.settings.put({ key: 'lastChangeAt', value: now });
    return { items, kept: undo.items.length - back.length, pending: stillPending.length, locations };
  });
}

