// Restore confirmation (F17, S6, mockup 8c): "on this tablet now" vs "in the backup", an
// optional backup first, and Replace everything only after the "I understand" tick.
import { useState } from 'preact/hooks';
import { replaceAll } from '../../../data/inventory';
import { formatBytes, formatDateTime, formatIsoDate, localIsoDate } from '../../../domain/dates';
import type { RestorePlan } from '../../../io/restore';
import { gate } from '../../../security/gate';
import { Dialog, DialogActions } from '../../components/Dialog';
import { PinMark, plural } from '../../components/common';
import { forgetAllThumbnails, useDb } from '../../data-hooks';
import { Icon } from '../../icons';
import { showToast } from '../../shell/toast';
import { exportBackup, exportMessage } from './export-backup';

export interface TabletNow {
  items: number;
  photos: number;
  photoIds: ReadonlySet<string>;
  suppliers: number;
  lastChangeAt: number | null;
}

export function RestoreDialog({ plan, tablet, onClose }: { plan: RestorePlan; tablet: TabletNow; onClose: () => void }) {
  const db = useDb();
  const [understood, setUnderstood] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [backedUp, setBackedUp] = useState<string | null>(null);
  const now = new Date();

  const keptPhotos = plan.kind === 'csv' ? plan.items.filter((i) => tablet.photoIds.has(i.id)).length : 0;
  const backupPhotos = plan.kind === 'zip' ? String(plan.photos.size) : `${keptPhotos} kept from this tablet`;
  const saved = plan.savedAt ? formatDateTime(plan.savedAt, now) + (plan.savedAtSource === 'file name' ? ' (from the file name)' : '') : 'unknown';
  const changed = tablet.lastChangeAt === null ? 'unknown' : `changed ${formatDateTime(new Date(tablet.lastChangeAt), now)}`;
  const since = plan.savedAt ? ` since ${formatIsoDate(localIsoDate(plan.savedAt))}` : ' since the backup was made';

  const backUpFirst = async () => {
    setBusy('Building the full backup…');
    try {
      const { result, name } = await exportBackup(db, 'full');
      const msg = exportMessage(result, name);
      if (msg) {
        setBackedUp(name);
        showToast(msg);
      }
    } catch (e) {
      showToast(`Couldn’t make the backup: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const replace = async () => {
    if (!(await gate('Restoring replaces all inventory on this tablet.'))) return;
    setBusy('Replacing everything…');
    try {
      const withPhotos = await replaceAll(db, plan, Date.now(), { keepPhotos: plan.kind === 'csv' });
      forgetAllThumbnails();
      showToast(`Restored ${plural(plan.items.length, 'item')} and ${plural(withPhotos, 'photo')} from ${plan.fileName}.`);
      onClose();
    } catch (e) {
      setBusy(null);
      showToast(`Restore failed, nothing was changed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const rows: [string, string, string][] = [
    ['Items', String(tablet.items), String(plan.items.length)],
    ['Photos', String(tablet.photos), backupPhotos],
    ['Suppliers', String(tablet.suppliers), plan.kind === 'zip' ? String(plan.suppliers.length) : `${plan.suppliers.length} (this tablet’s list${plan.addedSuppliers.length ? ' + new names' : ''})`],
    ['Saved', changed, saved],
  ];

  return (
    <Dialog label="Replace all inventory with this backup?" role="alertdialog" onClose={() => !busy && onClose()}>
      <h2 class="h2">Replace all inventory with this backup?</h2>
      <div class="mono small">
        {plan.fileName} · {formatBytes(plan.fileSize)} · {plan.kind === 'zip' ? 'full backup' : 'data-only CSV'}
      </div>
      <table class="cmp">
        <thead>
          <tr>
            <th />
            <th>On this tablet now</th>
            <th>In the backup</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([k, a, b]) => (
            <tr key={k}>
              <th scope="row">{k}</th>
              <td>{a}</td>
              <td>{b}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {(plan.addedSuppliers.length > 0 || plan.addedLocations.length > 0 || plan.warnings.length > 0) && (
        <ul class="small notes-list">
          {plan.addedSuppliers.length > 0 && <li>Suppliers added to the list: {plan.addedSuppliers.join(', ')}</li>}
          {plan.addedLocations.length > 0 && <li>Locations added to the end of the walk order: {plan.addedLocations.join(', ')}</li>}
          {plan.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
      <p class="dlg-p">
        Everything on the tablet is replaced{plan.kind === 'csv' ? ' (photos are kept for matching item ids)' : ''}. Counts and items added{since} will be lost unless you back up first.
      </p>
      <label class="tick">
        <input type="checkbox" checked={understood} disabled={!!busy} onChange={(e) => setUnderstood((e.currentTarget as HTMLInputElement).checked)} />
        <span>I understand this replaces everything</span>
      </label>
      {backedUp && (
        <p class="dlg-p small">
          <Icon name="check" /> Backed up first: <span class="mono">{backedUp}</span>
        </p>
      )}
      <DialogActions>
        <button type="button" class="btn lg" disabled={!!busy} onClick={() => void backUpFirst()}>
          Back up this tablet first
        </button>
        <button type="button" class="btn lg" data-autofocus disabled={!!busy} onClick={onClose}>
          Cancel
        </button>
      </DialogActions>
      <DialogActions>
        <button type="button" class="btn danger lg" disabled={!understood || !!busy} onClick={() => void replace()}>
          <Icon name="trash" />
          {busy ?? 'Replace everything'}
          <PinMark />
        </button>
      </DialogActions>
    </Dialog>
  );
}
