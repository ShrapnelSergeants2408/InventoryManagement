// M1 placeholder: proves storage works in a real browser. Replaced by the app shell in M2.
import { useEffect, useState } from 'preact/hooks';
import seedUrl from '../../seed/frc2408-starter-catalog-2026-10-17.zip?url';
import { InventoryDb } from '../data/db';
import { itemCount, loadSnapshot, replaceAll } from '../data/inventory';
import { buildOrderList } from '../domain/order';
import { formatCents } from '../domain/money';
import { readSeed } from '../io/seed';

interface Status {
  items: number;
  photos: number;
  suppliers: number;
  categories: number;
  orderLines: number;
  total: string;
}

export function DevStatus() {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const db = new InventoryDb();
      if ((await itemCount(db)) === 0) {
        const res = await fetch(seedUrl);
        const seed = await readSeed(await res.arrayBuffer());
        if (!seed.ok) throw new Error(seed.problems.map((p) => p.message).join('; '));
        await replaceAll(db, seed.data);
      }
      const snap = await loadSnapshot(db);
      const order = buildOrderList(snap.items);
      setStatus({
        items: snap.items.length,
        photos: await db.photos.count(),
        suppliers: snap.suppliers.length,
        categories: snap.categories.length,
        orderLines: order.lineCount,
        total: formatCents(order.grandTotalCents),
      });
    })().catch((e: unknown) => setError(String(e)));
  }, []);

  return (
    <main style={{ padding: 24 }}>
      <h1>FRC 2408 Inventory — M1 storage check</h1>
      {error && <p role="alert">Error: {error}</p>}
      {!status && !error && <p>Loading…</p>}
      {status && (
        <ul data-testid="status">
          <li>Items: {status.items}</li>
          <li>Photos: {status.photos}</li>
          <li>Suppliers: {status.suppliers}</li>
          <li>Categories: {status.categories}</li>
          <li>Order lines: {status.orderLines}</li>
          <li>Order total: {status.total}</li>
        </ul>
      )}
    </main>
  );
}
