// When the storage-error screen may offer "Set up again" (Stage 5 finding 1). Deleting the
// database can't be protected by the PIN (the PIN is in it), so it's offered only when trying
// again hasn't helped and the error isn't one that clears up by itself.

/** Errors that usually clear up: a full disk, a closed or aborted connection, a timeout. */
const TRANSIENT = new Set(['QuotaExceededError', 'AbortError', 'TimeoutError', 'DatabaseClosedError', 'VersionError']);

/** The browser's own error name; Dexie wraps open failures (OpenFailedError) around it. */
export function storageErrorName(error: unknown): string {
  const e = error as { name?: unknown; inner?: { name?: unknown } } | null;
  const inner = e?.inner?.name;
  if (typeof inner === 'string' && inner !== '') return inner;
  return typeof e?.name === 'string' ? e.name : '';
}

/** "Set up again" only after the first open and at least one Try again have failed, and never for transient errors. */
export function canOfferReset(error: unknown, failures: number): boolean {
  return failures >= 2 && !TRANSIENT.has(storageErrorName(error));
}

/** The word typed to confirm the reset. */
export const RESET_WORD = 'DELETE';

export function resetConfirmed(typed: string): boolean {
  return typed.trim().toUpperCase() === RESET_WORD;
}
