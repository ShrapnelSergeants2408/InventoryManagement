// Boot: open the database → storage error | first-launch setup (no PIN yet, §6) | app (SPEC §2).
import { useEffect, useState } from 'preact/hooks';
import seedUrl from '../../seed/frc2408-starter-catalog-2026-10-17.zip?url';
import { InventoryDb } from '../data/db';
import { itemCount, replaceAll } from '../data/inventory';
import { hasPin } from '../data/pin';
import { readSeed } from '../io/seed';
import { TopBar } from './components/common';
import { DbContext } from './data-hooks';
import { CountScreen } from './screens/count/Count';
import { InventoryScreen } from './screens/inventory/Inventory';
import { DetailScreen } from './screens/item/Detail';
import { EditorScreen } from './screens/item/Editor';
import { BackupScreen } from './screens/more/Backup';
import { CategoriesScreen } from './screens/more/Categories';
import { LocationsScreen } from './screens/more/Locations';
import { MoreScreen } from './screens/more/More';
import { SettingsScreen } from './screens/more/Settings';
import { SuppliersScreen } from './screens/more/Suppliers';
import { OrderScreen } from './screens/order/Order';
import { LabelsScreen } from './screens/labels/Labels';
import { ScanScreen } from './screens/scan/Scan';
import { SetupScreen } from './screens/Setup';
import { StorageError } from './screens/StorageError';
import { GateHost } from './shell/GateHost';
import { Shell } from './shell/Shell';
import { useRoute, type Route } from './shell/router';

const STARTER_MARKER = 'starterLoadedAt';

type Boot = { state: 'opening' } | { state: 'ready'; db: InventoryDb; setup: boolean } | { state: 'error'; error: unknown };

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
    const now = Date.now();
    await db.settings.bulkPut([{ key: STARTER_MARKER, value: now }, { key: 'setupDoneAt', value: now }]);
  }
  // The backup reminder runs from setup (D7); tablets that loaded the starter catalog before
  // M5 get their setup time from the starter-load marker.
  if (!(await db.settings.get('setupDoneAt'))) {
    const marker = await db.settings.get(STARTER_MARKER);
    if (marker) await db.settings.put({ key: 'setupDoneAt', value: marker.value });
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
      return <EditorScreen key={`add-${route.name}-${route.barcode}`} mode="add" name={route.name} barcode={route.barcode} />;
    case 'labels':
      return <LabelsScreen key={route.ids.join(',')} ids={route.ids} />;
    case 'suppliers':
      return <SuppliersScreen />;
    case 'categories':
      return <CategoriesScreen />;
    case 'locations':
      return <LocationsScreen />;
    case 'backup':
      return <BackupScreen />;
    case 'settings':
      return <SettingsScreen />;
    case 'tab':
      break;
  }
  switch (route.tab) {
    case 'inventory':
      return <InventoryScreen />;
    case 'order':
      return <OrderScreen />;
    case 'scan':
      return <ScanScreen />;
    case 'count':
      return <CountScreen />;
    case 'labels':
      return <LabelsScreen ids={null} />;
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
      async (db) => setBoot({ state: 'ready', db, setup: !(await hasPin(db)) }),
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
  if (boot.setup) {
    return (
      <DbContext.Provider value={boot.db}>
        <SetupScreen onDone={() => setBoot({ ...boot, setup: false })} />
      </DbContext.Provider>
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
