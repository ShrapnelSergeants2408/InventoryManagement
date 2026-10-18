// Applies a checked price-update plan (F18) in one transaction. Each item is re-read inside the
// transaction and only its vendor slots are changed, so counts recorded since the file was
// made are never overwritten (SPEC §10).
import { nameKey, type Item } from '../domain/types';
import { validateItem } from '../domain/validate';
import { applySlot, type PricePlan } from '../io/price-import';
import { fromItemRow, toItemRow, toSupplierRow, type InventoryDb } from './db';

export async function applyPriceImport(db: InventoryDb, plan: PricePlan, now = Date.now()): Promise<void> {
  await db.transaction('rw', [db.items, db.suppliers, db.settings], async () => {
    const existing = new Set((await db.suppliers.toCollection().primaryKeys()).map(String));
    const added = plan.newSuppliers.filter((n) => !existing.has(nameKey(n)));
    await db.suppliers.bulkAdd(added.map((name) => toSupplierRow({ name, website: '', notes: '' })));
    const supplierNames = (await db.suppliers.toArray()).map((s) => s.name);

    const rows = await db.items.bulkGet(plan.items.map((u) => u.id));
    const out: Item[] = [];
    plan.items.forEach((u, i) => {
      const row = rows[i];
      if (!row) throw new Error(`item ${u.id} was removed after the file was checked; nothing was changed — import the file again`);
      const item = fromItemRow(row);
      const vendors = [...item.vendors] as Item['vendors'];
      for (const { slot, set } of u.updates) {
        const next = applySlot(vendors[slot - 1] ?? null, set);
        if (!next) throw new Error(`item ${u.id}: vendor option ${slot} changed after the file was checked; nothing was changed — import the file again`);
        vendors[slot - 1] = next;
      }
      const updated: Item = { ...item, vendors };
      const errors = validateItem(updated, supplierNames);
      if (errors.length > 0) throw new Error(`item ${u.id}: ${errors.map((e) => e.message).join('; ')}`);
      out.push(updated);
    });
    await db.items.bulkPut(out.map((i) => toItemRow(i, now)));
    if (out.length > 0 || added.length > 0) await db.settings.put({ key: 'lastChangeAt', value: now });
  });
}
