// Import counts (§18.5; mockups 11d, 11e): choose counts files → each is checked whole →
// preview (nothing saved yet) with a choice for every conflict → Apply, saved together →
// summary with Review new items, Back up now and Undo this import. No PIN (§6).
import { useMemo, useRef, useState } from 'preact/hooks';
import { applyImport, previewImport, undoableItems, undoImport, type ImportSummary } from '../../../data/import-counts';
import { formatDateTime } from '../../../domain/dates';
import { newestChoices, noChoices, stampMs, type ConflictChoice, type CountsFile, type ImportChoices, type ImportPlan, type PlanRow } from '../../../domain/import-counts';
import { formatCents } from '../../../domain/money';
import { readCountsFile } from '../../../io/counts-file';
import { BackButton, TopBar, plural } from '../../components/common';
import { Dialog, DialogActions } from '../../components/Dialog';
import { useDb, useImportUndo, useSnapshot } from '../../data-hooks';
import { Icon } from '../../icons';
import { href } from '../../shell/router';
import { showToast } from '../../shell/toast';
import { StorageError } from '../StorageError';

const ACCEPT = '.zip,application/zip,application/x-zip-compressed';
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
/** "6:52 PM" for a count time today, else "Oct 26, 6:52 PM". */
const when = (stamp: string) => (stamp === '' ? 'never' : formatDateTime(new Date(stampMs(stamp))));

type Refused = { name: string; newer: boolean; problems: string[] };

export function ImportScreen() {
  const db = useDb();
  const live = useSnapshot();
  const [files, setFiles] = useState<CountsFile[]>([]);
  const [refused, setRefused] = useState<Refused[]>([]);
  const [reading, setReading] = useState(false);
  const [choices, setChoices] = useState<ImportChoices>(noChoices);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<ImportSummary | null>(null);
  const [undoing, setUndoing] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const undo = useImportUndo();

  const replan = async (fs: CountsFile[], c: ImportChoices) => {
    setChoices(c);
    setPlan(fs.length ? await previewImport(db, fs, c) : null);
  };
  const picked = async (list: FileList) => {
    setReading(true);
    const ok: CountsFile[] = [];
    const bad: Refused[] = [];
    for (const f of [...list]) {
      try {
        const r = await readCountsFile(f.name, new Uint8Array(await f.arrayBuffer()));
        if (r.ok) ok.push(r.file);
        else bad.push({ name: f.name, newer: r.newer, problems: r.problems });
      } catch (e) {
        bad.push({ name: f.name, newer: false, problems: [`This file couldn’t be read: ${message(e)}`] });
      }
    }
    // The same file picked twice is used once.
    const next = [...files, ...ok.filter((o) => !files.some((x) => x.fileName === o.fileName && x.meta.sequence === o.meta.sequence && x.meta.helperId === o.meta.helperId))];
    setFiles(next);
    setRefused(bad);
    await replan(next, choices);
    setReading(false);
  };
  const choose = (patch: Partial<ImportChoices>) => void replan(files, { ...choices, ...patch });
  const apply = async () => {
    if (!plan?.ready || busy) return;
    setBusy(true);
    try {
      setDone(await applyImport(db, files, choices));
    } catch (e) {
      showToast(`Nothing was saved: ${message(e)}`);
    } finally {
      setBusy(false);
    }
  };

  if (live.state === 'error') return <StorageError error={live.error} />;
  const locations = live.state === 'ready' ? live.value.locations : [];
  const back = <BackButton label="Count-in" fallback={href.tab('count')} />;
  const fileInput = (
    <input
      ref={picker}
      type="file"
      multiple
      accept={ACCEPT}
      class="vh"
      tabIndex={-1}
      aria-hidden="true"
      onChange={(e) => {
        const input = e.currentTarget as HTMLInputElement;
        const list = input.files;
        if (list && list.length) void picked(list).finally(() => (input.value = ''));
      }}
    />
  );

  // ── 4. Summary (11e) ──
  if (done) {
    const undone = undo === null || undo.at !== done.at;
    return (
      <>
        <TopBar title="Import counts" subtitle={undone ? 'Applied' : 'Applied · Undo is available until the next import or restore'} back={back} actions={<NoPin />} />
        <div class="cbody imp">
          <div class="done-h">
            <span class="done-ic">
              <Icon name="check" />
            </span>
            <div>
              <h2 class="h1">Counts from {done.helperNames.join(', ')} applied</h2>
              <div class="small muted">
                {formatDateTime(new Date(done.at))} · counted_by set to the helper’s name on every applied item
              </div>
            </div>
          </div>
          <div class="sumgrid imp-tiles">
            <Tile k="Applied" v={done.applied} />
            <Tile k="Conflicts settled" v={done.conflictsSettled} />
            <Tile k="Skipped" v={done.skipped} />
            <Tile k="Outside groups" v={done.outside} />
            <Tile k="New items waiting" v={done.newItems} />
          </div>
          <div class="card imp-total">
            <Icon name="order" class="ic xl" />
            <div>
              <div class="lbl">Order list</div>
              <div class="imp-money">
                {formatCents(done.totalBefore)} → {formatCents(done.totalAfter)}
              </div>
            </div>
          </div>
          <div class="wacts">
            {done.newItems > 0 && (
              <a class="btn pri lg" href={href.pending}>
                <span class="chip pend">{done.newItems}</span>
                Review new items
              </a>
            )}
            <a class="btn lg" href={href.backup}>
              Back up now
            </a>
            {!undone && (
              <button type="button" class="btn danger lg" onClick={() => setUndoing(true)}>
                <Icon name="retry" />
                Undo this import
              </button>
            )}
            <a class="btn lg" href={href.tab('count')}>
              Done
            </a>
          </div>
          {undone && undo === null && <p class="small muted m0">This import was undone.</p>}
        </div>
        {undoing && <UndoDialog onClose={() => setUndoing(false)} />}
      </>
    );
  }

  // ── 1. Choose and check ──
  if (!plan) {
    return (
      <>
        <TopBar title="Import counts" subtitle="Counts files from helper devices" back={back} actions={<NoPin />} />
        <div class="cbody imp">
          <div class="card imp-start">
            <Icon name="upload" class="ic xl" />
            <div class="grow">
              <h2 class="h2">Choose one or more counts files</h2>
              <p class="small muted m0">
                Helpers send <span class="mono">counts-…zip</span> from their Send tab. Each file is checked first; nothing is saved until you see the preview and tap Apply.
              </p>
            </div>
            <button type="button" class="btn pri lg" disabled={reading} onClick={() => picker.current?.click()}>
              {reading ? 'Checking…' : 'Choose counts files…'}
            </button>
          </div>
          <RefusedList refused={refused} />
          {undo && (
            <div class="card imp-undo">
              <Icon name="retry" class="ic xl" />
              <div class="grow">
                <strong>Last import: {undo.helperNames.join(', ')}</strong>
                <div class="small muted">{formatDateTime(new Date(undo.at))} · can still be undone</div>
              </div>
              <button type="button" class="btn danger" onClick={() => setUndoing(true)}>
                <Icon name="retry" />
                Undo this import
              </button>
            </div>
          )}
          {fileInput}
        </div>
        {undoing && <UndoDialog onClose={() => setUndoing(false)} />}
      </>
    );
  }

  // ── 2. Preview (11d) ──
  const conflictRows = plan.rows.filter((r) => r.kind === 'conflict');
  const choiceRows = plan.rows.filter((r) => r.location?.state === 'choice' || r.barcode?.state === 'choice');
  const unknown = plan.rows.filter((r) => r.kind === 'unknown');
  const taken = plan.rows.filter((r) => r.barcode?.state === 'taken');
  const applyCount = plan.counts.apply + plan.counts.conflicts;
  return (
    <>
      <TopBar title="Import counts: check before saving" subtitle="Nothing has been saved yet" back={back} actions={<NoPin />} />
      <div class="imp-grid">
        <div class="cbody imp">
          {files.map((f) => (
            <FileCard key={f.fileName + f.meta.sequence} file={f} />
          ))}
          <div>
            <button type="button" class="btn" disabled={reading} onClick={() => picker.current?.click()}>
              <Icon name="plus" />
              Add another file
            </button>
          </div>
          {fileInput}
          <RefusedList refused={refused} />
          {plan.warnings.map((w) => (
            <div key={w} class="hwarn" role="status">
              <Icon name="low" />
              <span>{w}</span>
            </div>
          ))}
          <div class="imp-tiles6">
            <Tile k="Will apply" v={plan.counts.apply} />
            <Tile k="Conflicts" v={plan.counts.conflictsLeft > 0 ? `${plan.counts.conflictsLeft} left` : plan.counts.conflicts} hot={plan.counts.conflictsLeft > 0} />
            <Tile k="Same number" v={plan.counts.same} />
            <Tile k="Outside groups" v={plan.counts.outside} />
            <Tile k="Already applied" v={plan.counts.applied} />
            <Tile k="Unknown items" v={plan.counts.unknown} />
          </div>

          {conflictRows.length > 0 && (
            <section class="imp-sec">
              <div class="imp-sec-h">
                <h2 class="h2 grow">Conflicts: choose one for each</h2>
                <button type="button" class="btn" onClick={() => choose({ conflicts: newestChoices(plan, choices).conflicts })}>
                  Use newest for all
                </button>
              </div>
              {conflictRows.map((r) => (
                <ConflictCard key={r.key} row={r} onChoose={(c) => choose({ conflicts: { ...choices.conflicts, [r.key]: c } })} />
              ))}
            </section>
          )}

          {choiceRows.length > 0 && (
            <section class="imp-sec">
              <h2 class="h2">Locations and barcodes that differ</h2>
              <p class="small muted m0">This tablet’s is kept unless you choose the helper’s.</p>
              {choiceRows.map((r) => (
                <div key={r.key} class="card imp-row">
                  <strong>{r.item?.name}</strong>
                  {r.location?.state === 'choice' && (
                    <KeepUse
                      label="Location"
                      here={r.location.current}
                      theirs={r.location.name}
                      helper={r.helperName}
                      value={r.location.choice}
                      onChange={(v) => choose({ locations: { ...choices.locations, [r.key]: v } })}
                    />
                  )}
                  {r.barcode?.state === 'choice' && (
                    <KeepUse
                      label="Barcode"
                      here={r.barcode.current}
                      theirs={r.barcode.code}
                      helper={r.helperName}
                      value={r.barcode.choice}
                      onChange={(v) => choose({ barcodes: { ...choices.barcodes, [r.key]: v } })}
                    />
                  )}
                </div>
              ))}
            </section>
          )}

          {plan.newLocations.length > 0 && (
            <section class="imp-sec">
              <h2 class="h2">New location names</h2>
              <p class="small muted m0">Names that match a location here (ignoring capitals) are merged. These are new: add them at the end of the walk order, or say which location they are (for one renamed here since the kit).</p>
              {plan.newLocations.map((n) => (
                <div key={n.key} class="card imp-row imp-loc">
                  <strong class="grow">{n.name}</strong>
                  <label class="lbl vh" for={`nl-${n.key}`}>
                    What to do with {n.name}
                  </label>
                  <select
                    id={`nl-${n.key}`}
                    class="field imp-sel"
                    value={n.choice.kind === 'add' ? '' : n.choice.as}
                    onChange={(e) => {
                      const v = (e.currentTarget as HTMLSelectElement).value;
                      choose({ newLocations: { ...choices.newLocations, [n.key]: v === '' ? { kind: 'add' } : { kind: 'same', as: v } } });
                    }}
                  >
                    <option value="">Add as a new location</option>
                    {locations.map((l) => (
                      <option key={l.name} value={l.name}>
                        Same as {l.name}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </section>
          )}

          {(unknown.length > 0 || taken.length > 0) && (
            <section class="imp-sec">
              <h2 class="h2">Skipped</h2>
              {unknown.map((r) => (
                <div key={r.key} class="small imp-skip">
                  Item <span class="mono">{r.itemId}</span> from {r.helperName}: not on this tablet any more (deleted since the kit).
                </div>
              ))}
              {taken.map((r) => (
                <div key={`${r.key}-b`} class="small imp-skip">
                  Barcode <span class="mono">{r.barcode!.code}</span> for {r.item?.name}: already on “{r.barcode!.takenBy}”, so it isn’t used.
                </div>
              ))}
            </section>
          )}
        </div>

        <aside class="imp-side">
          <div class="card imp-total">
            <div>
              <div class="lbl">Order list</div>
              <div class="imp-money">
                {formatCents(plan.totalBefore)} → {formatCents(plan.totalAfter)}
              </div>
              {!plan.ready && <div class="small muted">Estimate; {plural(plan.counts.conflictsLeft, 'conflict')} not settled yet.</div>}
            </div>
          </div>
          {plan.pending.length > 0 && (
            <div class="card imp-pend">
              <span class="chip pend">PENDING</span>
              <span>
                <strong>{plural(plan.pending.length, 'new item')}</strong> from helpers. You review them after applying; they don’t touch the inventory until accepted.
              </span>
            </div>
          )}
          {plan.pendingSkipped > 0 && <div class="small muted">{plural(plan.pendingSkipped, 'new item')} already here or already dealt with: skipped.</div>}
          <div class="sp" />
          {!plan.ready && <p class="small m0">Choose an option for each conflict to continue.</p>}
          <button type="button" class="btn pri lg" disabled={!plan.ready || busy || (applyCount === 0 && plan.changes.size === 0 && plan.pending.length === 0 && plan.createdLocations.length === 0)} onClick={() => void apply()}>
            {busy ? 'Saving…' : `Apply ${plural(applyCount, 'count')}`}
          </button>
          <p class="small muted m0">
            Everything is saved together. <strong>Undo this import</strong> stays available until the next import or restore.
          </p>
        </aside>
      </div>
    </>
  );
}

function NoPin() {
  return (
    <span class="chip ok">
      <Icon name="check" />
      No PIN needed
    </span>
  );
}

function Tile({ k, v, hot }: { k: string; v: number | string; hot?: boolean }) {
  return (
    <div class={hot ? 'tile hot' : 'tile'}>
      <span class="k">{k}</span>
      <span class="v">{v}</span>
    </div>
  );
}

function RefusedList({ refused }: { refused: Refused[] }) {
  return (
    <>
      {refused.map((r) => (
        <div key={r.name} class="card sfile" role="alert">
          <strong class="mono">{r.name}: not used</strong>
          <ul class="small swarn">
            {r.problems.slice(0, 8).map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
          {r.problems.length > 8 && <span class="small muted">and {plural(r.problems.length - 8, 'more problem')}</span>}
          {r.newer ? (
            <button type="button" class="btn" onClick={() => location.reload()}>
              <Icon name="retry" />
              Reload the app
            </button>
          ) : (
            <span class="small muted">Nothing from this file was used.</span>
          )}
        </div>
      ))}
    </>
  );
}

function FileCard({ file: f }: { file: CountsFile }) {
  const n = f.counts.length;
  return (
    <div class="card imp-file">
      <Icon name="note" class="ic xl" />
      <div class="grow">
        <strong class="mono">{f.fileName}</strong>
        <div class="small muted">
          {f.meta.helperName} · file {f.meta.sequence} · {plural(n, 'item')} · {plural(f.newItems.length, 'new item')} · checked: no errors · nothing saved yet
        </div>
      </div>
    </div>
  );
}

function ConflictCard({ row: r, onChoose }: { row: PlanRow; onChoose: (c: ConflictChoice) => void }) {
  const c = r.conflict!;
  const b = r.before!;
  const who = b.countedBy === '' ? 'this tablet' : b.countedBy;
  const opts: Array<[ConflictChoice, string, number, string]> = [
    ['keep', 'Keep this tablet’s', c.keep, `${b.countedBy === '' ? 'counted here' : b.countedBy} ${when(b.lastCounted)}`],
    ['helper', 'Use helper’s', c.helper, `${r.helperName} ${when(r.countedAt)}`],
    ['add', 'Add together', c.add, 'stored in two places'],
  ];
  return (
    <div class="card imp-conf">
      <div>
        <strong class="imp-conf-n">{r.item?.name}</strong>
        <div class="small muted">
          Counted by {who} ({c.keep}) and on {r.helperName} ({c.helper}) after the kit was sent.{r.outside ? ' Outside this helper’s groups.' : ''}
        </div>
      </div>
      <div class="imp-opts" role="radiogroup" aria-label={`Which count for ${r.item?.name ?? r.itemId}`}>
        {opts.map(([k, label, v, sub]) => (
          <button key={k} type="button" role="radio" aria-checked={c.choice === k} class={c.choice === k ? 'imp-opt on' : 'imp-opt'} onClick={() => onChoose(k)}>
            <strong>{label}</strong>
            <span class="imp-opt-v">{v}</span>
            <span class="small muted">{sub}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function KeepUse(props: { label: string; here: string; theirs: string; helper: string; value: 'keep' | 'helper'; onChange: (v: 'keep' | 'helper') => void }) {
  return (
    <div class="imp-ku" role="radiogroup" aria-label={props.label}>
      <span class="lbl">{props.label}</span>
      <button type="button" role="radio" aria-checked={props.value === 'keep'} class={props.value === 'keep' ? 'choice on' : 'choice'} onClick={() => props.onChange('keep')}>
        <span class="dot" />
        Keep {props.here}
      </button>
      <button type="button" role="radio" aria-checked={props.value === 'helper'} class={props.value === 'helper' ? 'choice on' : 'choice'} onClick={() => props.onChange('helper')}>
        <span class="dot" />
        Use {props.helper}’s: {props.theirs}
      </button>
    </div>
  );
}

/** Undo this import (§18.5): a confirmation in destructive style (§17). */
export function UndoDialog({ onClose }: { onClose: () => void }) {
  const db = useDb();
  const undo = useImportUndo();
  const [busy, setBusy] = useState(false);
  const back = undo ? undoableItems(undo).length : 0;
  const kept = undo ? undo.items.length - back : 0;
  const what = useMemo(() => (undo ? `${plural(back, 'item')}, ${plural(undo.pending.length, 'pending item')}, ${plural(undo.locations.length, 'new location')}` : ''), [undo, back]);
  const go = async () => {
    setBusy(true);
    try {
      const r = await undoImport(db);
      showToast(`Import undone: ${plural(r.items, 'item')} put back${r.kept ? `, ${plural(r.kept, 'received item')} kept` : ''}${r.pending ? `, ${plural(r.pending, 'pending item')} removed` : ''}${r.locations ? `, ${plural(r.locations, 'location')} removed` : ''}.`);
      onClose();
    } catch (e) {
      setBusy(false);
      showToast(message(e));
    }
  };
  return (
    <Dialog label="Undo this import" role="alertdialog" onClose={() => !busy && onClose()}>
      <div class="dlg-form">
        <h2 class="h2">Undo this import?</h2>
        {undo ? (
          <p class="dlg-p">
            The counts from {undo.helperNames.join(', ')} ({formatDateTime(new Date(undo.at))}) are taken back: {what}. Every item gets back the on-hand number, location, barcode and count date it had before. New locations an item now uses are kept, and pending items already accepted stay.
            {kept > 0 && ` ${kept === 1 ? '1 item has' : `${kept} items have`} had parts received since the import, so ${kept === 1 ? 'it keeps' : 'they keep'} what ${kept === 1 ? 'it has' : 'they have'} now.`}
          </p>
        ) : (
          <p class="dlg-p">There is no import to undo.</p>
        )}
        <DialogActions>
          <button type="button" class="btn lg" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          {undo && (
            <button type="button" class="btn danger lg" disabled={busy} onClick={() => void go()}>
              <Icon name="retry" />
              Undo this import
            </button>
          )}
        </DialogActions>
      </div>
    </Dialog>
  );
}
