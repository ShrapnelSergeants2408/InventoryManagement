// Boot: open the database → storage error | app (SPEC §2).
import { useEffect, useState } from 'preact/hooks';
import seedUrl from '../../seed/frc2408-starter-catalog-2026-10-17.zip?url';
import { InventoryDb } from '../data/db';
import { itemCount, replaceAll } from '../data/inventory';
import { readSeed } from '../io/seed';
import { TopBar } from './components/common';
import { DbContext } from './data-hooks';
import { InventoryScreen } from './screens/inventory/Inventory';
import { DetailScreen } from './screens/item/Detail';
import { EditorScreen } from './screens/item/Editor';
import { CategoriesScreen } from './screens/more/Categories';
import { LocationsScreen } from './screens/more/Locations';
import { MoreScreen } from './screens/more/More';
import { SuppliersScreen } from './screens/more/Suppliers';
import { OrderScreen } from './screens/order/Order';
import { Placeholder } from './screens/Placeholder';
import { StorageError } from './screens/StorageError';
import { GateHost } from './shell/GateHost';
import { Shell } from './shell/Shell';
import { useRoute, type Route } from './shell/router';

const STARTER_MARKER = 'starterLoadedAt';

type Boot = { state: 'opening' } | { state: 'ready'; db: InventoryDb } | { state: 'error'; error: unknown };

async function openDb(): Promise<InventoryDb> {
  const db = new InventoryDb();
  await db.open();
  // TEMPORARY until first-launch setup (M10, F22): a new tablet gets the starter catalog once.
  // The marker stops it coming back after the team deletes every item.
  if ((await itemCount(db)) === 0 && !(await db.settings.get(STARTER_MARKER))) {
    const res = await fetch(seedUrl);
    if (!res.ok) throw new Error(`starter catalog download failed (${res.status})`);
    const seed = await readSeed(await res.arrayBuffer());
    if (!seed.ok) throw new Error(seed.problems.map((p) => p.message).join('; '));
    await replaceAll(db, seed.data);
    await db.settings.put({ key: STARTER_MARKER, value: Date.now() });
  }
  return db;
}

function Screen({ route }: { route: Route }) {
  switch (route.screen) {
    case 'item':
      return <DetailScreen key={route.id} id={route.id} />;
    case 'edit':
      return <EditorScreen key={`edit-${route.id}`} mode="edit" id={route.id} />;
    case 'add':
      return <EditorScreen key={`add-${route.name}`} mode="add" name={route.name} />;
    case 'suppliers':
      return <SuppliersScreen />;
    case 'categories':
      return <CategoriesScreen />;
    case 'locations':
      return <LocationsScreen />;
    case 'tab':
      break;
  }
  switch (route.tab) {
    case 'inventory':
      return <InventoryScreen />;
    case 'order':
      return <OrderScreen />;
    case 'scan':
      return <Placeholder title="Scan" milestone="M8" what="Scan a QR label or barcode to open that item." />;
    case 'count':
      return <Placeholder title="Count" milestone="M9" what="Count-in walks you through counting stock by category or location." />;
    case 'labels':
      return <Placeholder title="Labels" milestone="M8" what="Print QR labels on Avery sheets or plain paper." />;
    case 'more':
      return <MoreScreen />;
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
        <GateHost />
      </Shell>
    </DbContext.Provider>
  );
}
