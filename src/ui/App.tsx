// Boot: which databases this device has → the shop tablet (open the inventory → storage
// error | first-launch setup: PIN, recovery code, then what the inventory starts with, §6, F22,
// Q2 | app, SPEC §2), a helper (its own database, §18.7), or, on a fresh device, the
// first-launch question (F22). A helper never opens the inventory database.
import { useEffect, useState } from 'preact/hooks';
import { InventoryDb, checkSchema } from '../data/db';
import { HelperDb, existingDatabases, getKit, leaveHelperMode } from '../data/helper-db';
import { hasPin } from '../data/pin';
import { SETUP_DONE, STARTER_LOADED, isSetUp, watchPersistentStorage } from '../data/setup';
import { TopBar } from './components/common';
import { DbContext } from './data-hooks';
import { CountScreen } from './screens/count/Count';
import { HelpersScreen } from './screens/count/Helpers';
import { ImportScreen } from './screens/count/Import';
import { PendingScreen } from './screens/count/Pending';
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
import { FirstLaunch } from './screens/FirstLaunch';
import { SetupScreen } from './screens/Setup';
import { HelperApp } from './helper/HelperApp';
import { AppOutdated, OpenBlocked, StorageError, UpdatedElsewhere } from './screens/StorageError';
import { GateHost } from './shell/GateHost';
import { Shell } from './shell/Shell';
import { useRoute, type Route } from './shell/router';

/** Setup still to do: everything (no PIN yet), or only the inventory's starting point. */
type SetupNeeded = 'all' | 'start' | null;

type Boot =
  | { state: 'opening' }
  /** A fresh device: shop tablet or helper? (F22) */
  | { state: 'role' }
  /** A helper device with a kit (§18.2). */
  | { state: 'helper'; db: HelperDb }
  | { state: 'ready'; db: InventoryDb; setup: SetupNeeded }
  | { state: 'error'; error: unknown }
  /** Another tab of the app holds the database while this one upgrades it (§3 upgrade plan). */
  | { state: 'blocked' }
  /** The database is newer than this copy of the app (Stage 5 finding 6). */
  | { state: 'outdated' }
  /** A newer copy upgraded the database in another tab; this one closed its connection. */
  | { state: 'replaced' };

async function openDb(on: { blocked: () => void; replaced: () => void }): Promise<InventoryDb | 'outdated'> {
  const db = new InventoryDb();
  db.on('blocked', on.blocked);
  db.on('versionchange', () => {
    db.close();
    on.replaced();
    return false;
  });
  await db.open();
  // Checked before anything is written, so an out-of-date copy changes nothing.
  if ((await checkSchema(db)) === 'outdated') {
    db.close();
    return 'outdated';
  }
  // Tablets that loaded the starter catalog before M5 get their setup time from the
  // starter-load marker (the backup reminder runs from setup, D7).
  if (!(await db.settings.get(SETUP_DONE))) {
    const marker = await db.settings.get(STARTER_LOADED);
    if (marker) await db.settings.put({ key: SETUP_DONE, value: marker.value });
  }
  return db;
}

/**
 * What this device is (F22, §18.7): an inventory database means the shop tablet, whatever
 * else is there; a helper database with a kit means a helper; otherwise the question. If the
 * browser can't say, it's treated as the shop tablet, as every device was before M16b.
 */
async function deviceRole(): Promise<{ role: 'main' } | { role: 'helper'; db: HelperDb } | { role: 'new' }> {
  let has: { inventory: boolean; helper: boolean };
  try {
    has = await existingDatabases();
  } catch {
    return { role: 'main' };
  }
  if (has.inventory) return { role: 'main' };
  if (!has.helper) return { role: 'new' };
  const db = new HelperDb();
  try {
    await db.open();
    if (await getKit(db)) return { role: 'helper', db };
  } catch {
    // An unreadable helper copy holds nothing the shop tablet needs; it's cleared below.
  }
  // A helper database without a kit (closed while joining): start again.
  await leaveHelperMode(db);
  return { role: 'new' };
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
      return <EditorScreen key={`add-${route.name}-${route.barcode}-${route.pending}`} mode="add" name={route.name} barcode={route.barcode} pending={route.pending} />;
    case 'labels':
      return <LabelsScreen key={route.ids.join(',')} ids={route.ids} />;
    case 'orderList':
      return <OrderScreen key={route.id} listId={route.id} />;
    case 'helpers':
      return <HelpersScreen />;
    case 'import':
      return <ImportScreen />;
    case 'pending':
      return <PendingScreen />;
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
      return <OrderScreen key="auto" listId={null} />;
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
  // Failed opens in a row, so "Set up again" waits until Try again has failed too (finding 1).
  const [failures, setFailures] = useState(0);
  const route = useRoute();
  const openMain = () => {
    setBoot({ state: 'opening' });
    openDb({ blocked: () => setBoot({ state: 'blocked' }), replaced: () => setBoot({ state: 'replaced' }) }).then(
      async (db) => {
        setFailures(0);
        setBoot(db === 'outdated' ? { state: 'outdated' } : { state: 'ready', db, setup: await setupNeeded(db) });
      },
      (error: unknown) => {
        setFailures((n) => n + 1);
        setBoot({ state: 'error', error });
      },
    );
  };
  const start = () => {
    setBoot({ state: 'opening' });
    void deviceRole().then((r) => (r.role === 'main' ? openMain() : setBoot(r.role === 'helper' ? { state: 'helper', db: r.db } : { state: 'role' })));
  };
  useEffect(start, []);
  // Ask for persistent storage on every launch until granted, and again once installed (§2, T-01).
  useEffect(() => watchPersistentStorage(), []);

  if (boot.state === 'role') return <FirstLaunch onShop={openMain} onJoined={(db) => setBoot({ state: 'helper', db })} />;
  if (boot.state === 'helper') return <HelperApp db={boot.db} onLeft={() => setBoot({ state: 'role' })} />;
  if (boot.state === 'error') {
    return (
      <Shell tab={route.tab}>
        <TopBar title="Inventory" subtitle="Storage unavailable" />
        <StorageError error={boot.error} onRetry={start} failures={failures} />
      </Shell>
    );
  }
  if (boot.state === 'blocked' || boot.state === 'outdated' || boot.state === 'replaced') {
    return (
      <Shell tab={route.tab}>
        <TopBar title="Inventory" subtitle={boot.state === 'blocked' ? 'Waiting for other tabs' : 'Update needed'} />
        {boot.state === 'blocked' ? <OpenBlocked /> : boot.state === 'outdated' ? <AppOutdated /> : <UpdatedElsewhere />}
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
