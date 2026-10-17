// Storage-error state (SPEC §2): the database can't be opened (storage cleared or blocked).
import { useEffect, useState } from 'preact/hooks';
import { StateMessage } from '../components/common';
import { Icon } from '../icons';

function describe(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
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
        Restore from backup arrives in a later update. Until then, try again, and don’t clear Chrome’s site data for this app.
      </p>
      <p class="small muted state-detail">
        Error: {describe(error)}. Persistent storage: {persisted}.
      </p>
    </StateMessage>
  );
}
