// Backup & restore (mockups 8a–8f): full or data-only backup (F15), the reminder (F16),
// restore (F17), price-update import (F18) and storage status (§2).
import { liveQuery } from 'dexie';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { InventoryDb } from '../../../data/db';
import { loadSnapshot } from '../../../data/inventory';
import { applyAddItems, getAddUndo, undoAddItems, type AddResult, type AddUndo } from '../../../data/add-items';
import { applyPriceImport } from '../../../data/price-import';
import { formatBytes, formatDateTime } from '../../../domain/dates';
import { daysSinceBackup } from '../../../domain/backup-reminder';
import { buildDataCsv, type BackupKind } from '../../../io/backup';
import { planAddItems, readAddFile, type AddPlan } from '../../../io/add-items';
import { decodeCsvBytes } from '../../../io/csv';
import { planPriceImport, type PricePlan, type PriceProblem } from '../../../io/price-import';
import { readRestoreFile, type RestorePlan } from '../../../io/restore';
import { gate } from '../../../security/gate';
import { BackButton, TopBar, plural } from '../../components/common';
import { useDb, useImportUndo, useNow, usePending, useOrderLists, useOrders, useSettings, useSnapshot, useStorageStatus, type StorageStatus } from '../../data-hooks';
import { Icon } from '../../icons';
import { BackupBanner } from '../../shell/BackupBanner';
import { href } from '../../shell/router';
import { showToast } from '../../shell/toast';
import { StorageError } from '../StorageError';
import { AddItemsDone, AddItemsPreview, AddItemsUndoDialog } from './AddItemsDialogs';
import { exportBackup, exportMessage } from './export-backup';
import { PriceImportDone, PriceImportPreview, ProblemsDialog } from './ImportDialogs';
import { RestoreDialog, type TabletNow } from './RestoreDialog';
import { UndoDialog } from '../count/Import';

const BACKUP_ACCEPT = '.zip,.csv,application/zip,application/x-zip-compressed,text/csv,text/comma-separated-values';
const CSV_ACCEPT = '.csv,text/csv,text/comma-separated-values';

interface PhotoStats {
  count: number;
  bytes: number;
  ids: Set<string>;
}

function usePhotoStats(db: InventoryDb): PhotoStats | null {
  const [stats, setStats] = useState<PhotoStats | null>(null);
  useEffect(() => {
    const sub = liveQuery(async () => {
      const rows = await db.photos.toArray();
      return { count: rows.length, bytes: rows.reduce((n, r) => n + r.full.size, 0), ids: new Set(rows.map((r) => r.itemId)) };
    }).subscribe({ next: setStats, error: () => setStats(null) });
    return () => sub.unsubscribe();
  }, [db]);
  return stats;
}

/** The undo of the last "Add items from a file" (F33), or null when there is none. */
function useAddUndo(db: InventoryDb): AddUndo | null {
  const [undo, setUndo] = useState<AddUndo | null>(null);
  useEffect(() => {
    const sub = liveQuery(() => getAddUndo(db)).subscribe({ next: setUndo, error: () => setUndo(null) });
    return () => sub.unsubscribe();
  }, [db]);
  return undo;
}

/** Opens the system file picker and resolves with the chosen file's name and bytes. */
function usePicker(accept: string, onFile: (f: { name: string; bytes: Uint8Array }) => void) {
  const input = useRef<HTMLInputElement>(null);
  const el = (
    <input
      ref={input}
      type="file"
      accept={accept}
      hidden
      onChange={async (e) => {
        const el = e.currentTarget as HTMLInputElement;
        const file = el.files?.[0];
        el.value = '';
        if (file) onFile({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
      }}
    />
  );
  return { el, open: () => input.current?.click() };
}

type Dlg =
  | { kind: 'restore'; plan: RestorePlan }
  | { kind: 'problems'; title: string; fileName: string; problems: PriceProblem[]; warnings: string[]; footer: string }
  | { kind: 'pricePreview'; plan: PricePlan }
  | { kind: 'priceDone'; plan: PricePlan }
  | { kind: 'addPreview'; plan: AddPlan }
  | { kind: 'addDone'; fileName: string; result: AddResult }
  | { kind: 'addUndo'; undo: AddUndo };

export function BackupScreen() {
  const undo = useImportUndo();
  const pending = usePending();
  const orders = useOrders();
  const [undoing, setUndoing] = useState(false);
  const db = useDb();
  const live = useSnapshot();
  const lists = useOrderLists();
  const settings = useSettings();
  const now = useNow();
  const photos = usePhotoStats(db);
  const storage = useStorageStatus();
  const [busy, setBusy] = useState<string | null>(null);
  const [dlg, setDlg] = useState<Dlg | null>(null);
  const [importing, setImporting] = useState(false);
  const addUndo = useAddUndo(db);
  const snap =live.state === 'ready' ? live.value : null;
  const csvBytes = useMemo(() => (snap ? new TextEncoder().encode(buildDataCsv(snap)).length : null), [snap]);

  const doExport = async (kind: BackupKind) => {
    setBusy(kind === 'full' ? 'Building the full backup…' : 'Building the data-only backup…');
    try {
      const { result, name } = await exportBackup(db, kind);
      const msg = exportMessage(result, name);
      if (msg) showToast(msg);
    } catch (e) {
      showToast(`Couldn’t make the backup: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const restorePicker = usePicker(BACKUP_ACCEPT, async (f) => {
    setBusy(`Checking ${f.name}…`);
    try {
      const read = await readRestoreFile(f, await loadSnapshot(db));
      if (read.ok) setDlg({ kind: 'restore', plan: read.plan });
      else
        setDlg({
          kind: 'problems',
          title: 'Can’t restore this file — nothing was changed',
          fileName: f.name,
          problems: read.problems,
          warnings: read.warnings,
          footer: 'Choose a backup made by this app: a full backup (ZIP) or a data-only backup (CSV). The whole file is checked before anything is replaced.',
        });
    } catch (e) {
      showToast(`Couldn’t read ${f.name}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  });

  const pricePicker = usePicker(CSV_ACCEPT, async (f) => {
    setBusy(`Checking ${f.name}…`);
    try {
      const { text, warnings } = decodeCsvBytes(f.bytes);
      const read = planPriceImport(text, f.name, await loadSnapshot(db));
      if (!read.ok) {
        setDlg({
          kind: 'problems',
          title: 'Couldn’t import — nothing was changed',
          fileName: f.name,
          problems: read.problems,
          warnings,
          footer: 'Fix the file (or ask Claude to fix it) and import again. The whole file is checked before anything is saved.',
        });
        return;
      }
      const plan = read.plan;
      const changes = plan.items.length > 0 || plan.newSuppliers.length > 0;
      // What will change is shown first; the PIN is asked at "Import changes".
      setDlg({ kind: changes ? 'pricePreview' : 'priceDone', plan });
    } catch (e) {
      showToast(`Couldn’t import ${f.name}: ${e instanceof Error ? e.message : String(e)} Nothing was changed.`);
    } finally {
      setBusy(null);
    }
  });

  const importPrices = async (plan: PricePlan) => {
    if (importing || !(await gate('A price-update import changes vendor prices, pack sizes and links.'))) return;
    setImporting(true);
    try {
      await applyPriceImport(db, plan);
      setDlg({ kind: 'priceDone', plan });
    } catch (e) {
      setDlg(null);
      showToast(`Couldn’t import ${plan.fileName}: ${e instanceof Error ? e.message : String(e)} Nothing was changed.`);
    } finally {
      setImporting(false);
    }
  };

  const addPicker = usePicker(BACKUP_ACCEPT, async (f) => {
    setBusy(`Checking ${f.name}…`);
    try {
      const read = await readAddFile(f.bytes, f.name);
      if (!read.ok) {
        setDlg({
          kind: 'problems',
          title: 'Can’t add items from this file — nothing was changed',
          fileName: f.name,
          problems: read.problems,
          warnings: [],
          footer: 'Choose a starter-catalog ZIP, or an inventory.csv with name, category and unit columns and at least one vendor option.',
        });
        return;
      }
      setDlg({ kind: 'addPreview', plan: planAddItems(read.file, await loadSnapshot(db)) });
    } catch (e) {
      showToast(`Couldn’t read ${f.name}: ${e instanceof Error ? e.message : String(e)} Nothing was changed.`);
    } finally {
      setBusy(null);
    }
  });

  const addItems = async (plan: AddPlan) => {
    if (importing || !(await gate('Adding items from a file adds new items, and any new categories and suppliers they need.'))) return;
    setImporting(true);
    try {
      const result = await applyAddItems(db, plan);
      setDlg({ kind: 'addDone', fileName: plan.fileName, result });
    } catch (e) {
      setDlg(null);
      showToast(`Couldn’t add items from ${plan.fileName}: ${e instanceof Error ? e.message : String(e)} Nothing was changed.`);
    } finally {
      setImporting(false);
    }
  };

  const undoAdd = async () => {
    if (!(await gate('Undoing an import removes the items it added.'))) return null;
    try {
      return await undoAddItems(db);
    } catch (e) {
      setDlg(null);
      showToast(`Couldn’t undo: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  };

  const top = <TopBar title="Backup & restore" back={<BackButton label="More" fallback={href.tab('more')} />} />;
  if (live.state === 'error') {
    return (
      <>
        {top}
        <StorageError error={live.error} />
      </>
    );
  }

  const days = daysSinceBackup(settings.lastBackupAt, now);
  const lastBackup = settings.lastBackupAt === null ? 'Never' : days === 0 ? formatDateTime(new Date(settings.lastBackupAt), new Date(now)) : `${plural(days!, 'day')} ago`;
  const fullSize = csvBytes !== null && photos ? formatBytes(csvBytes + photos.bytes) : '…';
  const tablet: TabletNow | null =
    snap && photos && lists.state === 'ready'
      ? { items: snap.items.length, photos: photos.count, photoIds: photos.ids, suppliers: snap.suppliers.length, orderLists: lists.value, pending: pending.state === 'ready' ? pending.value.length : 0, orders: orders.state === 'ready' ? orders.value.length : 0, lastChangeAt: settings.lastChangeAt }
      : null;

  return (
    <>
      {top}
      <BackupBanner onBackupScreen />
      <div class="bk">
        <section class="card bkcard" aria-labelledby="bk-h">
          <h2 class="h2" id="bk-h">
            Back up
          </h2>
          <div class="bk-last">
            Last backup: <strong>{lastBackup}</strong>
            {settings.lastBackupAt !== null && days !== 0 && <span class="small muted"> ({formatDateTime(new Date(settings.lastBackupAt), new Date(now))})</span>}
          </div>
          <button type="button" class="bkopt" disabled={!!busy || !snap} onClick={() => void doExport('full')}>
            <span class="mi">
              <Icon name="photo" />
            </span>
            <span class="grow">
              <span class="mt block">Full backup (ZIP)</span>
              <span class="small muted block">
                inventory.csv + suppliers, locations and categories + {photos ? plural(photos.count, 'photo') : '… photos'} · about {fullSize} · use this every week
              </span>
            </span>
            <Icon name="upload" />
          </button>
          <button type="button" class="bkopt" disabled={!!busy || !snap} onClick={() => void doExport('data')}>
            <span class="mi">
              <Icon name="note" />
            </span>
            <span class="grow">
              <span class="mt block">Data only (CSV)</span>
              <span class="small muted block">
                inventory.csv · about {csvBytes === null ? '…' : formatBytes(csvBytes)} · quick over Bluetooth · use for a price refresh with Claude
              </span>
            </span>
            <Icon name="upload" />
          </button>
          <p class="small muted bk-p">
            Both open Android’s share sheet when Chrome allows it; otherwise the file is saved to Downloads, to send from the Files app. Quick Share or Drive is much
            faster than Bluetooth for the full backup. The PIN and settings are never included.
          </p>
          <StorageNote storage={storage} />
        </section>

        <div class="mcol">
          <section class="card bkcard" aria-labelledby="ic-h">
            <div class="bk-h">
              <h2 class="h2 grow" id="ic-h">
                Counts from helpers
              </h2>
              <span class="chip ok">No PIN</span>
            </div>
            <p class="bk-p">Import the counts files helper devices send. You see a preview and settle any conflicts before anything is saved.</p>
            <div class="setup-acts">
              <a class="btn lg" href={href.importCounts}>
                <Icon name="upload" />
                Import counts…
              </a>
              {undo && (
                <button type="button" class="btn danger lg" onClick={() => setUndoing(true)}>
                  <Icon name="retry" />
                  Undo this import
                </button>
              )}
            </div>
            {undo && (
              <p class="small muted bk-p">
                Last import: {undo.helperNames.join(', ')}, {formatDateTime(new Date(undo.at), new Date(now))}. Imports can be undone, newest first, until a restore.
              </p>
            )}
          </section>

          <section class="card bkcard" aria-labelledby="rs-h">
            <div class="bk-h">
              <h2 class="h2 grow" id="rs-h">
                Restore
              </h2>
              <span class="chip lock">
                <Icon name="lock" />
                PIN
              </span>
            </div>
            <p class="bk-p">
              Replaces <strong>all</strong> inventory on this tablet with a backup file. A CSV-only restore keeps existing photos for matching item ids. Supplier and location
              names that aren’t in their lists are added.
            </p>
            <button type="button" class="btn lg" disabled={!!busy || !tablet} onClick={restorePicker.open}>
              <Icon name="upload" class="ic flip" />
              Choose backup file (ZIP or CSV)…
            </button>
            {restorePicker.el}
          </section>

          <section class="card bkcard" aria-labelledby="pi-h">
            <div class="bk-h">
              <h2 class="h2 grow" id="pi-h">
                Price update import
              </h2>
              <span class="chip lock">
                <Icon name="lock" />
                PIN
              </span>
            </div>
            <p class="bk-p">
              Updates price, pack size, link and price-checked date for matching item ids. <strong>Never changes counts.</strong>
            </p>
            <ol class="steps small">
              <li>
                Share a <strong>Data only</strong> backup to a computer.
              </li>
              <li>In a Claude desktop chat with web search, ask it to check current prices for the items on the order list.</li>
              <li>
                Import the price-update CSV Claude returns: an <span class="mono">id</span> column plus <span class="mono">v1_pack_price</span>,{' '}
                <span class="mono">v1_price_checked</span> and the like (blank cells are left as they are).
              </li>
            </ol>
            <button type="button" class="btn lg" disabled={!!busy || !snap} onClick={pricePicker.open}>
              <Icon name="note" />
              Choose price CSV…
            </button>
            {pricePicker.el}
          </section>

          <section class="card bkcard" aria-labelledby="ai-h">
            <div class="bk-h">
              <h2 class="h2 grow" id="ai-h">
                Add items from a file
              </h2>
              <span class="chip lock">
                <Icon name="lock" />
                PIN
              </span>
            </div>
            <p class="bk-p">
              Adds the items this tablet doesn’t have yet, from a starter-catalog ZIP or an <span class="mono">inventory.csv</span>. It shows what it will add first.{' '}
              <strong>Never changes existing items, counts or settings.</strong> New items start at on hand 0 and desired 0.
            </p>
            <div class="setup-acts">
              <button type="button" class="btn lg" disabled={!!busy || !snap} onClick={addPicker.open}>
                <Icon name="upload" />
                Choose items file (ZIP or CSV)…
              </button>
              {addUndo && (
                <button type="button" class="btn danger lg" onClick={() => setDlg({ kind: 'addUndo', undo: addUndo })}>
                  <Icon name="retry" />
                  Undo this import
                </button>
              )}
            </div>
            {addUndo && (
              <p class="small muted bk-p">
                Last add: {plural(addUndo.items.length, 'item')} from {addUndo.fileName}, {formatDateTime(new Date(addUndo.at), new Date(now))}. It can be undone until the next add or a restore.
              </p>
            )}
            {addPicker.el}
          </section>
        </div>
      </div>

      {busy && (
        <div class="scrim center" aria-busy="true">
          <div class="dlg busy" role="status">
            <strong>{busy}</strong>
          </div>
        </div>
      )}
      {undoing && <UndoDialog onClose={() => setUndoing(false)} />}
      {dlg?.kind === 'restore' && tablet && <RestoreDialog plan={dlg.plan} tablet={tablet} onClose={() => setDlg(null)} />}
      {dlg?.kind === 'problems' && (
        <ProblemsDialog title={dlg.title} fileName={dlg.fileName} problems={dlg.problems} warnings={dlg.warnings} footer={dlg.footer} onClose={() => setDlg(null)} />
      )}
      {dlg?.kind === 'pricePreview' && <PriceImportPreview plan={dlg.plan} busy={importing} onImport={() => void importPrices(dlg.plan)} onClose={() => setDlg(null)} />}
      {dlg?.kind === 'priceDone' && <PriceImportDone plan={dlg.plan} onClose={() => setDlg(null)} />}
      {dlg?.kind === 'addPreview' && <AddItemsPreview plan={dlg.plan} busy={importing} onAdd={() => void addItems(dlg.plan)} onClose={() => setDlg(null)} />}
      {dlg?.kind === 'addDone' && <AddItemsDone fileName={dlg.fileName} result={dlg.result} onClose={() => setDlg(null)} />}
      {dlg?.kind === 'addUndo' && <AddItemsUndoDialog undo={dlg.undo} onUndo={undoAdd} onClose={() => setDlg(null)} />}
    </>
  );
}

function StorageNote({ storage }: { storage: StorageStatus | null }) {
  if (!storage) return null;
  const used = storage.usage === null ? '' : ` Using ${formatBytes(storage.usage)} on this tablet.`;
  if (storage.persisted)
    return (
      <div class="bk-store">
        <Icon name="check" />
        <span>
          <strong>Persistent storage granted.</strong> Chrome won’t clear the app’s data on its own.{used} Backups still matter if the tablet is lost, reset or broken.
        </span>
      </div>
    );
  return (
    <div class="bk-store warn">
      <Icon name="info" />
      <span>
        <strong>Persistent storage {storage.persisted === false ? 'not granted' : 'unknown'}.</strong> Chrome may clear the app’s data if the tablet runs low on space.{used}{' '}
        Installing the app to the home screen usually fixes this. Keep backups current.
      </span>
    </div>
  );
}
