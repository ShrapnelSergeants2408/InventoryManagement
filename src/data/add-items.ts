// Applies a checked "add items from a file" plan (F33, SPEC §23) in one transaction, and takes it
// back (Undo this import). Existing items, counts, Drive links and settings are never changed.
import { newTeamId } from '../domain/ids';
import { nameKey, type Item } from '../domain/types';
import { validateItem } from '../domain/validate';
import { addToPresence, presenceOf, presentReason, type AddPlan } from '../io/add-items';
import { toItemRow, toSupplierRow, type InventoryDb } from './db';

/** Where the one level of undo is kept. Forgotten by a restore or a fresh setup (§23.4). */
import { ADD_UNDO_KEY } from './add-undo-key';

export { ADD_UNDO_KEY };

/** What an add created, so Undo can take it back. */
export interface AddUndo {
  at: number;
  fileName: string;
  /** Item id → its updatedAt as the add saved it; a different value later means it was edited or counted. */
  items: [string, number][];
  categories: string[];
  subcategories: { category: string; name: string }[];
  suppliers: string[];
}

export interface AddResult {
  added: number;
  /** Items that became present between the preview and the add (not added). */
  skippedLate: number;
  categories: number;
  subcategories: number;
  suppliers: number;
  photos: number;
}

export async function getAddUndo(db: InventoryDb): Promise<AddUndo | null> {
  const v = (await db.settings.get(ADD_UNDO_KEY))?.value;
  return v && typeof v === 'object' ? (v as AddUndo) : null;
}

export async function applyAddItems(db: InventoryDb, plan: AddPlan, now = Date.now(), random: () => number = Math.random): Promise<AddResult> {
  return db.transaction('rw', [db.items, db.photos, db.suppliers, db.categories, db.settings], async () => {
    const current = (await db.items.toArray()).map(({ supplierKeys: _k, updatedAt: _u, ...i }) => i as Item);
    const have = presenceOf(current);
    const taken = new Set(current.map((i) => i.id.toLowerCase()));

    // Re-check against the tablet as it is now, so nothing already present is added twice.
    const toAdd: { item: Item; photoFile: string }[] = [];
    let skippedLate = 0;
    for (const n of plan.newItems) {
      if (presentReason(have, n.item) !== null) {
        skippedLate++;
        continue;
      }
      const id = newTeamId((s) => taken.has(s.toLowerCase()), random);
      taken.add(id.toLowerCase());
      const item = { ...n.item, id };
      addToPresence(have, item);
      toAdd.push({ item, photoFile: n.photoFile });
    }
    const undo: AddUndo = { at: now, fileName: plan.fileName, items: [], categories: [], subcategories: [], suppliers: [] };
    if (toAdd.length === 0) return { added: 0, skippedLate, categories: 0, subcategories: 0, suppliers: 0, photos: 0 };

    // Lists: only what the added items use, and only what is still missing.
    const used = (f: (i: Item) => string) => new Set(toAdd.map((a) => nameKey(f(a.item))));
    const usedSuppliers = new Set(toAdd.flatMap((a) => a.item.vendors.flatMap((v) => (v ? [nameKey(v.supplier)] : []))));
    const haveSuppliers = new Set((await db.suppliers.toArray()).map((s) => s.key));
    for (const s of plan.newSuppliers) {
      if (!usedSuppliers.has(nameKey(s.name)) || haveSuppliers.has(nameKey(s.name))) continue;
      await db.suppliers.add(toSupplierRow(s));
      undo.suppliers.push(s.name);
    }
    const usedCategories = used((i) => i.category);
    const categories = await db.categories.toArray();
    let nextOrder = categories.reduce((m, c) => Math.max(m, c.order), -1) + 1;
    for (const c of plan.newCategories) {
      if (!usedCategories.has(nameKey(c.name)) || categories.some((x) => nameKey(x.name) === nameKey(c.name))) continue;
      const subs = c.subcategories.filter((s) => toAdd.some((a) => nameKey(a.item.category) === nameKey(c.name) && nameKey(a.item.subcategory) === nameKey(s)));
      await db.categories.add({ name: c.name, order: nextOrder++, subcategories: subs });
      undo.categories.push(c.name);
    }
    for (const s of plan.newSubcategories) {
      if (!toAdd.some((a) => nameKey(a.item.category) === nameKey(s.category) && nameKey(a.item.subcategory) === nameKey(s.name))) continue;
      const cat = (await db.categories.toArray()).find((c) => nameKey(c.name) === nameKey(s.category));
      if (!cat || cat.subcategories.some((x) => nameKey(x) === nameKey(s.name))) continue;
      await db.categories.put({ ...cat, subcategories: [...cat.subcategories, s.name] });
      undo.subcategories.push({ category: cat.name, name: s.name });
    }

    const supplierNames = (await db.suppliers.toArray()).map((s) => s.name);
    let photos = 0;
    const rows = toAdd.map(({ item, photoFile }) => {
      const full = photoFile === '' ? undefined : plan.photos.get(photoFile);
      const stored: Item = { ...item, hasPhoto: full !== undefined };
      const errors = validateItem(stored, supplierNames);
      if (errors.length > 0) throw new Error(`“${item.name}”: ${errors.map((e) => e.message).join('; ')}; nothing was added`);
      return { stored, full };
    });
    await db.items.bulkAdd(rows.map((r) => toItemRow(r.stored, now)));
    const withPhoto = rows.flatMap((r) => (r.full ? [{ itemId: r.stored.id, full: r.full, thumb: null, updatedAt: now }] : []));
    await db.photos.bulkAdd(withPhoto);
    photos = withPhoto.length;
    undo.items = rows.map((r) => [r.stored.id, now]);
    await db.settings.put({ key: ADD_UNDO_KEY, value: undo });
    await db.settings.put({ key: 'lastChangeAt', value: now });
    return { added: rows.length, skippedLate, categories: undo.categories.length, subcategories: undo.subcategories.length, suppliers: undo.suppliers.length, photos };
  });
}

export interface UndoAddResult {
  removed: number;
  /** Names of added items kept because they were counted, edited, ordered or received since (§23.4). */
  kept: string[];
}

export async function undoAddItems(db: InventoryDb, now = Date.now()): Promise<UndoAddResult> {
  return db.transaction('rw', [db.items, db.photos, db.suppliers, db.categories, db.orderLists, db.orders, db.settings], async () => {
    const undo = await getAddUndo(db);
    if (!undo) throw new Error('there is no import to undo');
    const remove: string[] = [];
    const kept: string[] = [];
    for (const [id, at] of undo.items) {
      const row = await db.items.get(id);
      if (!row) continue;
      const used = row.updatedAt !== at || (await db.orderLists.where('itemIds').equals(id).count()) > 0 || (await db.orders.where('itemIds').equals(id).count()) > 0;
      if (used) kept.push(row.name);
      else remove.push(id);
    }
    await db.items.bulkDelete(remove);
    await db.photos.bulkDelete(remove);

    // Lists the add created go too, unless something still uses them.
    for (const name of undo.suppliers) {
      const key = nameKey(name);
      if ((await db.items.where('supplierKeys').equals(key).count()) === 0 && (await db.orders.where('supplierKey').equals(key).count()) === 0) await db.suppliers.delete(key);
    }
    const left = await db.items.toArray();
    for (const s of undo.subcategories) {
      const cat = await db.categories.get(s.category);
      if (!cat || left.some((i) => nameKey(i.category) === nameKey(s.category) && nameKey(i.subcategory) === nameKey(s.name))) continue;
      await db.categories.put({ ...cat, subcategories: cat.subcategories.filter((x) => nameKey(x) !== nameKey(s.name)) });
    }
    for (const name of undo.categories) {
      if (!left.some((i) => nameKey(i.category) === nameKey(name))) await db.categories.delete(name);
    }
    await db.settings.delete(ADD_UNDO_KEY);
    await db.settings.put({ key: 'lastChangeAt', value: now });
    return { removed: remove.length, kept };
  });
}
