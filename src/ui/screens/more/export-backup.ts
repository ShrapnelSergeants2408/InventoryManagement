// Sending a backup off the tablet (F15) from the Backup screen or the restore dialog.
import { buildBackup, recordBackup } from '../../../data/backup';
import type { InventoryDb } from '../../../data/db';
import { backupFileName, type BackupKind } from '../../../io/backup';
import { shareOrDownload, type ShareDeps, type ShareResult } from '../../../io/share';

/** Builds a backup and sends it off the tablet; any export but a cancelled share resets the clock (F16). */
export async function exportBackup(db: InventoryDb, kind: BackupKind, deps?: ShareDeps): Promise<{ result: ShareResult; name: string }> {
  const now = new Date();
  const name = backupFileName(kind, now);
  const blob = await buildBackup(db, kind, now);
  const file = new File([blob], name, { type: kind === 'full' ? 'application/zip' : 'text/csv' });
  const result = await shareOrDownload(file, 'Inventory backup', deps);
  if (result !== 'cancelled') await recordBackup(db, Date.now());
  return { result, name };
}

export function exportMessage(result: ShareResult, name: string): string | null {
  if (result === 'shared') return `Shared ${name}.`;
  // The reminder still resets (F16), so say plainly that the file isn't safe yet (Stage 5 finding 7).
  if (result === 'downloaded')
    return `Saved ${name} to Downloads on this tablet only. Send it to Drive or another device (Files › Share): a backup on the tablet is lost with the tablet.`;
  return null;
}
