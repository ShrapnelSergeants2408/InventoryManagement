// Boot: open the inventory → storage error | first-launch setup (what the inventory starts with,
// SPEC v2.0 §12.5) | app.
import { useEffect, useState } from 'preact/hooks';
import { InventoryDb, checkSchema } from '../data/db';
import { isSetUp, watchPersistentStorage } from '../data/setup';
import { TopBar } from './components/common';
import { DbContext } from './data-hooks';
import { InventoryScreen } from './screens/inventory/Inventory';
import { DetailScreen } from './screens/item/Detail';
import { EditorScreen } from './screens/item/Editor';
import { BackupScreen } from './screens/more/Backup';
import { CategoriesScreen } from './screens/more/Categories';
import { LocationsScreen } from './screens/more/Locations';
import { MoreScreen } from './screens/more/More';
import { SettingsScreen } from './screens/more/Settings';
import { LabelsScreen } from './screens/labels/Labels';
import { ScanScreen } from './screens/scan/Scan';
import { SetupScreen } from './screens/Setup';
import { AppOutdated, OpenBlocked, StorageError, UpdatedElsewhere } from './screens/StorageError';
import { Shell } from './shell/Shell';
import { useRoute, type Route } from './shell/router';

type Boot =
  | { state: 'opening' }
  | { state: 'ready'; db: InventoryDb; setup: boolean }
  | { state: 'error'; error: unknown }
  /** Another tab of the app holds the database while this one upgrades it. */
  | { state: 'blocked' }
  /** The database is newer than this copy of the app. */
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
    case 'scan':
      return <ScanScreen />;
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
        setBoot(db === 'outdated' ? { state: 'outdated' } : { state: 'ready', db, setup: !(await isSetUp(db)) });
      },
      (error: unknown) => {
        setFailures((n) => n + 1);
        setBoot({ state: 'error', error });
      },
    );
  };
  const start = openMain;
  useEffect(start, []);
  // Ask for persistent storage on every launch until granted, and again once installed (§2).
  useEffect(() => watchPersistentStorage(), []);

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
            <span class="hc">Opening the inventory…</span>
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
      </Shell>
    </DbContext.Provider>
  );
}
