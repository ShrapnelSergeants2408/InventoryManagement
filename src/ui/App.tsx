// Boot: open the database → storage error | first-launch setup (PIN, recovery code, then
// what the inventory starts with: §6, F22, Q2) | app (SPEC §2).
import { useEffect, useState } from 'preact/hooks';
import { InventoryDb } from '../data/db';
import { hasPin } from '../data/pin';
import { SETUP_DONE, STARTER_LOADED, isSetUp } from '../data/setup';
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

/** Setup still to do: everything (no PIN yet), or only the inventory's starting point. */
type SetupNeeded = 'all' | 'start' | null;

type Boot = { state: 'opening' } | { state: 'ready'; db: InventoryDb; setup: SetupNeeded } | { state: 'error'; error: unknown };

async function openDb(): Promise<InventoryDb> {
  const db = new InventoryDb();
  await db.open();
  // Tablets that loaded the starter catalog before M5 get their setup time from the
  // starter-load marker (the backup reminder runs from setup, D7).
  if (!(await db.settings.get(SETUP_DONE))) {
    const marker = await db.settings.get(STARTER_LOADED);
    if (marker) await db.settings.put({ key: SETUP_DONE, value: marker.value });
  }
  return db;
}

async function setupNeeded(db: InventoryDb): Promise<SetupNeeded> {
  if (!(await hasPin(db))) return 'all';
  return (await isSetUp(db)) ? null : 'start';
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
      async (db) => setBoot({ state: 'ready', db, setup: await setupNeeded(db) }),
      (error: unknown) => setBoot({ state: 'error', error }),
    );
  };
  useEffect(start, []);

  if (boot.state === 'error') {
    return (
      <Shell tab={route.tab}>
        <TopBar title="Inventory" subtitle="Storage unavailable" />
        <StorageError error={boot.error} onRetry={start} canReset />
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
        <SetupScreen pinSet={boot.setup === 'start'} onDone={() => setBoot({ ...boot, setup: null })} />
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
