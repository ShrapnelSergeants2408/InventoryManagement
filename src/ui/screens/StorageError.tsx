// Storage-error state (SPEC §2, spec-questions Q2): the database can't be opened (storage
// cleared or blocked). Try again first; if that fails too, and the error isn't one that clears
// up by itself, "Set up again" deletes what's left of the app's storage and starts first-launch
// setup, whose last step can restore a backup. It needs DELETE typed: the PIN can't protect it
// (Stage 5 finding 1). Also the screens for a blocked upgrade and an out-of-date copy (§3 plan).
import Dexie from 'dexie';
import { useEffect, useState } from 'preact/hooks';
import { InventoryDb } from '../../data/db';
import { RESET_WORD, canOfferReset, resetConfirmed } from '../../domain/storage-error';
import { StateMessage } from '../components/common';
import { Dialog, DialogActions } from '../components/Dialog';
import { Icon } from '../icons';
import { updateAndReload } from '../shell/UpdateBanner';

function describe(error: unknown): string {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return text.replace(/\.+$/, '');
}

/** `failures`: failed opens in a row at boot (0 elsewhere, where Set up again is never offered). */
export function StorageError({ error, onRetry, failures = 0 }: { error: unknown; onRetry?: () => void; failures?: number }) {
  const canReset = canOfferReset(error, failures);
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
        {canReset ? (
          <p class="state-text small muted">
            If the inventory still can’t be opened, choose <strong>Set up again</strong>: you set a new mentor PIN, then choose <strong>Restore a backup file</strong>.
          </p>
        ) : (
          <p class="state-text small muted">Close other tabs of this app, then try again. This often clears up after a moment.</p>
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
  const [typed, setTyped] = useState('');
  const reset = async () => {
    if (!resetConfirmed(typed)) return;
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
          This deletes whatever is left of the app’s storage on this tablet (the inventory, photos, order lists, PIN and settings) and starts first-time setup. Have the
          backup file ready to restore in the last step.
        </p>
        <p class="dlg-p">
          <strong>The mentor PIN can’t protect this step</strong>, because the PIN is stored in what gets deleted. Only a mentor should do it.
        </p>
        <div>
          <label class="lbl" for="rsword">
            Type {RESET_WORD} to confirm
          </label>
          <input id="rsword" class="field" value={typed} disabled={busy} autoComplete="off" spellcheck={false} onInput={(e) => setTyped((e.currentTarget as HTMLInputElement).value)} />
        </div>
        {error && (
          <p class="err" role="alert">
            Couldn’t delete the storage: {error}
          </p>
        )}
        <DialogActions>
          <button type="button" class="btn lg" data-autofocus disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button type="button" class="btn danger lg" disabled={busy || !resetConfirmed(typed)} onClick={() => void reset()}>
            Delete and set up again
          </button>
        </DialogActions>
      </div>
    </Dialog>
  );
}

/** Another tab or window of the app is open while this one upgrades the database. Nothing is lost; the open finishes once they close. */
export function OpenBlocked() {
  return (
    <StateMessage
      icon="database"
      tone="alert"
      role="alert"
      title="Close other tabs of this app"
      actions={
        <button type="button" class="btn" onClick={() => location.reload()}>
          <Icon name="retry" />
          Try again
        </button>
      }
    >
      <p class="state-text">
        This version of the app needs to update how the inventory is stored, and another tab or window of the app is still using it. Close the other tabs (in Chrome and in
        the installed app). The inventory opens by itself as soon as they’re closed.
      </p>
      <p class="state-text small muted">Nothing has been changed or lost.</p>
    </StateMessage>
  );
}

/** The database was saved by a newer version (Stage 5 finding 6). Nothing is read or written until the app updates. */
export function AppOutdated() {
  const [busy, setBusy] = useState(false);
  return (
    <StateMessage
      icon="database"
      tone="alert"
      role="alert"
      title="This app is out of date — reload to update"
      actions={
        <button
          type="button"
          class="btn pri"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void updateAndReload();
          }}
        >
          <Icon name="retry" />
          {busy ? 'Updating…' : 'Reload'}
        </button>
      }
    >
      <p class="state-text">
        The inventory on this tablet was saved by a newer version of the app. This copy is older, so it won’t open the inventory, to keep from damaging it. Connect to the
        internet and reload to get the newest version.
      </p>
      <p class="state-text small muted">Nothing has been changed or lost.</p>
    </StateMessage>
  );
}

/** A newer copy of the app upgraded the database from another tab; this tab let go of it. */
export function UpdatedElsewhere() {
  return (
    <StateMessage
      icon="database"
      title="The app was updated in another tab"
      actions={
        <button type="button" class="btn pri" onClick={() => void updateAndReload()}>
          <Icon name="retry" />
          Reload
        </button>
      }
    >
      <p class="state-text">Another tab or window opened a newer version of the app. Reload this one to keep going.</p>
    </StateMessage>
  );
}
