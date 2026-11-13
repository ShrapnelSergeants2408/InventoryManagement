// The count report and spot-check list of an import (§18.5, v0.20): buttons for the summary and
// the Last import card, and the dialog listing the items worth a recount. No PIN (§6).
import { useMemo, useState } from 'preact/hooks';
import type { ImportUndo } from '../../../data/import-counts';
import { formatDateTime } from '../../../domain/dates';
import { BIG_PERCENT, BIG_UNITS, FLAG_LABEL, reportRows, spotCheck, type SpotFlag } from '../../../domain/import-report';
import { importReportFileName, serializeImportReport } from '../../../io/import-report-csv';
import { shareOrDownload } from '../../../io/share';
import { plural } from '../../components/common';
import { Dialog, DialogActions } from '../../components/Dialog';
import { useSnapshot } from '../../data-hooks';
import { Icon } from '../../icons';
import { href } from '../../shell/router';
import { showToast } from '../../shell/toast';

const FLAG_CLASS: Record<SpotFlag, string> = { zero: 'chip stale', big: 'chip stale', outside: 'chip np' };

/** The two buttons; hidden for an import saved before v0.20, which kept no after-values. */
export function ImportReportButtons({ undo, large }: { undo: ImportUndo; large?: boolean }) {
  const snap = useSnapshot();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const rows = useMemo(() => (undo.after ? reportRows(undo.items, undo.after, undo.outside ?? []) : null), [undo]);
  if (rows === null) return null;
  const flagged = spotCheck(rows);
  const cls = large ? 'btn lg' : 'btn';

  const exportReport = async () => {
    if (busy || snap.state !== 'ready') return;
    setBusy(true);
    const name = importReportFileName(undo.at);
    try {
      const note = `Count report: import of ${undo.helperNames.join(', ')}, ${formatDateTime(new Date(undo.at))} · ${plural(rows.length, 'item')} changed, ${flagged.length} to spot-check`;
      const file = new File([serializeImportReport(rows, snap.value.items, note)], name, { type: 'text/csv' });
      const r = await shareOrDownload(file, 'Count report');
      if (r !== 'cancelled') showToast(r === 'shared' ? `Shared ${name}.` : `Saved ${name} to Downloads.`);
    } catch (e) {
      showToast(`Couldn’t export: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button type="button" class={cls} onClick={() => setOpen(true)}>
        <Icon name="search" />
        Spot-check list{' '}
        <span class={flagged.length > 0 ? 'chip stale' : 'chip'}>{flagged.length}</span>
      </button>
      <button type="button" class={cls} disabled={busy || snap.state !== 'ready'} onClick={() => void exportReport()}>
        <Icon name="upload" />
        Count report (CSV)
      </button>
      {open && snap.state === 'ready' && <SpotCheckDialog undo={undo} rows={flagged} total={rows.length} items={snap.value.items} onClose={() => setOpen(false)} onExport={() => void exportReport()} />}
    </>
  );
}

function SpotCheckDialog(props: { undo: ImportUndo; rows: ReturnType<typeof spotCheck>; total: number; items: ReadonlyArray<{ id: string; name: string }>; onClose: () => void; onExport: () => void }) {
  const names = new Map(props.items.map((i) => [i.id, i.name]));
  return (
    <Dialog label="Spot-check list" onClose={props.onClose}>
      <h2 class="h2">Spot-check list</h2>
      <p class="dlg-p">
        {props.rows.length === 0
          ? `Nothing stands out among the ${plural(props.total, 'item')} this import changed.`
          : `${plural(props.rows.length, 'item')} of the ${props.total} this import changed are worth a recount: a count of zero where there was stock, a change of ${BIG_PERCENT}% and ${BIG_UNITS} or more, or an item outside the helper’s groups.`}
      </p>
      {props.rows.length > 0 && (
        <div class="spot-list" role="list">
          {props.rows.map((r) => (
            <div key={r.itemId} class="spot-row" role="listitem">
              <a class="spot-name" href={href.item(r.itemId)} onClick={props.onClose}>
                {names.get(r.itemId) ?? r.itemId}
              </a>
              <strong class="spot-nums">
                {r.before.onHand} → {r.after.onHand}
              </strong>
              <span class="spot-flags">
                {r.flags.map((f) => (
                  <span key={f} class={FLAG_CLASS[f]}>
                    {FLAG_LABEL[f]}
                  </span>
                ))}
              </span>
              <span class="small muted">counted by {r.after.countedBy || 'this tablet'}</span>
            </div>
          ))}
        </div>
      )}
      <DialogActions>
        <button type="button" class="btn lg" onClick={props.onExport}>
          <Icon name="upload" />
          Count report (CSV)
        </button>
        <button type="button" class="btn pri lg" data-autofocus onClick={props.onClose}>
          Done
        </button>
      </DialogActions>
    </Dialog>
  );
}
