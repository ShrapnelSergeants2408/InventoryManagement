// Storage-error state (SPEC §2): the database can't be opened (storage cleared or blocked).
import { useEffect, useState } from 'preact/hooks';
import { StateMessage } from '../components/common';
import { Icon } from '../icons';

function describe(error: unknown): string {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return text.replace(/\.+$/, '');
}

export function StorageError({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const [persisted, setPersisted] = useState<string>('checking…');
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
    <StateMessage
      icon="database"
      tone="alert"
      role="alert"
      title="Can’t open the inventory on this tablet"
      actions={
        <button type="button" class="btn" onClick={onRetry ?? (() => location.reload())}>
          <Icon name="retry" />
          Try again
        </button>
      }
    >
      <p class="state-text">
        The browser blocked or cleared this app’s storage. Nothing is lost if you have a backup. A mentor can restore the latest backup
        file (ZIP or CSV) from the Downloads folder, Drive, or email.
      </p>
      <p class="state-text small muted">
        Try again first. If the inventory still can’t be opened, the app has to be set up again before a backup can be restored; that path arrives with first-launch
        setup in a later update. Until then, don’t clear Chrome’s site data for this app.
      </p>
      <p class="small muted state-detail">
        Error: {describe(error)}. Persistent storage: {persisted}.
      </p>
    </StateMessage>
  );
}
