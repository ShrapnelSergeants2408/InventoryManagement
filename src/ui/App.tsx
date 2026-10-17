// Boot: open the database → storage error | app (SPEC §2).
import { useEffect, useState } from 'preact/hooks';
import seedUrl from '../../seed/frc2408-starter-catalog-2026-10-17.zip?url';
import { InventoryDb } from '../data/db';
import { itemCount, replaceAll } from '../data/inventory';
import { readSeed } from '../io/seed';
import { TopBar } from './components/common';
import { DbContext } from './data-hooks';
import { InventoryScreen } from './screens/inventory/Inventory';
import { Placeholder } from './screens/Placeholder';
import { StorageError } from './screens/StorageError';
import { Shell } from './shell/Shell';
import { useRoute, type Route } from './shell/router';

type Boot = { state: 'opening' } | { state: 'ready'; db: InventoryDb } | { state: 'error'; error: unknown };

async function openDb(): Promise<InventoryDb> {
  const db = new InventoryDb();
  await db.open();
  // TEMPORARY until first-launch setup (M10, F22): an empty tablet gets the starter catalog.
  if ((await itemCount(db)) === 0) {
    const res = await fetch(seedUrl);
    if (!res.ok) throw new Error(`starter catalog download failed (${res.status})`);
    const seed = await readSeed(await res.arrayBuffer());
    if (!seed.ok) throw new Error(seed.problems.map((p) => p.message).join('; '));
    await replaceAll(db, seed.data);
  }
  return db;
}

function Screen({ route }: { route: Route }) {
  if (route.screen === 'item') {
    return <Placeholder title="Item detail" milestone="M3" what="The detail card shows full notes, the photo, every vendor option with links, and +/− buttons." back />;
  }
  if (route.screen === 'add') {
    return <Placeholder title="Add item" milestone="M3" what="Anyone can add an item to any category, with its first vendor option." back />;
  }
  switch (route.tab) {
    case 'inventory':
      return <InventoryScreen />;
    case 'order':
      return <Placeholder title="Order" milestone="M4" what="The order list groups what needs ordering by supplier, with subtotals, a grand total and CSV export." />;
    case 'scan':
      return <Placeholder title="Scan" milestone="M8" what="Scan a QR label or barcode to open that item." />;
    case 'count':
      return <Placeholder title="Count" milestone="M9" what="Count-in walks you through counting stock by category or location." />;
    case 'labels':
      return <Placeholder title="Labels" milestone="M8" what="Print QR labels on Avery sheets or plain paper." />;
    case 'more':
      return <Placeholder title="More" milestone="M3, M5 and M6" what="Suppliers, categories, locations, backup and restore, and mentor settings live here." />;
  }
}

export function App() {
  const [boot, setBoot] = useState<Boot>({ state: 'opening' });
  const route = useRoute();
  const start = () => {
    setBoot({ state: 'opening' });
    openDb().then(
      (db) => setBoot({ state: 'ready', db }),
      (error: unknown) => setBoot({ state: 'error', error }),
    );
  };
  useEffect(start, []);

  if (boot.state === 'error') {
    return (
      <Shell tab={route.tab}>
        <TopBar title="Inventory" subtitle="Storage unavailable" />
        <StorageError error={boot.error} onRetry={start} />
      </Shell>
    );
  }
  if (boot.state === 'opening') {
    return (
      <Shell tab={route.tab}>
        <TopBar title="Inventory" subtitle="Loading…" />
        <div class="list" aria-busy="true">
          <div class="cathdr static">
            <span class="hc">Opening the inventory on this tablet…</span>
          </div>
        </div>
      </Shell>
    );
  }
  return (
    <DbContext.Provider value={boot.db}>
      <Shell tab={route.tab}>
        <Screen route={route} />
      </Shell>
    </DbContext.Provider>
  );
}
