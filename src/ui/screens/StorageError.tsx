// Storage-error state (SPEC §2, spec-questions Q2): the database can't be opened (storage
// cleared or blocked). Try again first; if that fails, "Set up again" deletes what's left of
// the app's storage and starts first-launch setup, whose last step can restore a backup.
import Dexie from 'dexie';
import { useEffect, useState } from 'preact/hooks';
import { InventoryDb } from '../../data/db';
import { StateMessage } from '../components/common';
import { Dialog, DialogActions } from '../components/Dialog';
import { Icon } from '../icons';

function describe(error: unknown): string {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return text.replace(/\.+$/, '');
}

export function StorageError({ error, onRetry, canReset = false }: { error: unknown; onRetry?: () => void; canReset?: boolean }) {
  const [persisted, setPersisted] = useState<string>('checking…');
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    const s = navigator.storage;
    if (!s?.persisted) {
      setPersisted('unknown');
      return;
    }
    s.persisted().then(
      (p) => setPersisted(p ? 'granted' : 'not granted'),
      () => setPersisted('unknown'),
    );
  }, []);

  return (
    <>
      <StateMessage
        icon="database"
        tone="alert"
        role="alert"
        title="Can’t open the inventory on this tablet"
        actions={
          <>
            <button type="button" class="btn" onClick={onRetry ?? (() => location.reload())}>
              <Icon name="retry" />
              Try again
            </button>
            {canReset && (
              <button type="button" class="btn danger" onClick={() => setConfirm(true)}>
                Set up again…
              </button>
            )}
          </>
        }
      >
        <p class="state-text">
          The browser blocked or cleared this app’s storage. Nothing is lost if you have a backup: a mentor can restore the latest backup file (ZIP or CSV) from the Downloads
          folder, Drive, or email.
        </p>
        {canReset && (
          <p class="state-text small muted">
            Try again first. If the inventory still can’t be opened, choose <strong>Set up again</strong>: you set a new mentor PIN, then choose <strong>Restore a backup file</strong>.
          </p>
        )}
        <p class="small muted state-detail">
          Error: {describe(error)}. Persistent storage: {persisted}.
        </p>
      </StateMessage>
      {confirm && <ResetDialog onClose={() => setConfirm(false)} />}
    </>
  );
}

function ResetDialog({ onClose }: { onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reset = async () => {
    setBusy(true);
    try {
      await Dexie.delete(new InventoryDb().name);
      location.reload();
    } catch (e) {
      setBusy(false);
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <Dialog label="Set up again" role="alertdialog" onClose={() => !busy && onClose()}>
      <div class="dlg-form">
        <h2 class="h2">Set up this tablet again?</h2>
        <p class="dlg-p">
          This deletes whatever is left of the app’s storage on this tablet (the inventory, photos, PIN and settings) and starts first-time setup. Have the backup file ready to
          restore in the last step.
        </p>
        {error && (
          <p class="err" role="alert">
            Couldn’t delete the storage: {error}
          </p>
        )}
        <DialogActions>
          <button type="button" class="btn lg" data-autofocus disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button type="button" class="btn danger lg" disabled={busy} onClick={() => void reset()}>
            Delete and set up again
          </button>
        </DialogActions>
      </div>
    </Dialog>
  );
}
