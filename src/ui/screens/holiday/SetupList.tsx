// A season's setup list (SPEC v3.0 F25, H3 mockup "Setup list"): progress over three sections —
// Bins to bring out (ticked when out, or scan the bin), Put out (the season's items by display,
// ticked when out on their display; Unpack a whole bin), and Tasks (ticked in this year's run,
// added straight from the list) — then Finish setup. Anything left unticked doesn't block.
import type { ComponentChildren } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import type { InventorySnapshot } from '../../../data/inventory';
import { addTask, finishSetup, putBack, putOut, reopenSetup, setBinsState, startSetup, tickTask } from '../../../data/holiday';
import { currentRun, runYear, setupList, type SetupItem } from '../../../domain/holiday';
import { partView } from '../../../domain/parts';
import { resolveScan } from '../../../domain/scan';
import { itemSeasonId, indexPlaces } from '../../../domain/places';
import type { Bin, SeasonRun } from '../../../domain/types';
import { plural } from '../../components/common';
import { Qty } from '../../components/chips';
import { Dialog, DialogActions } from '../../components/Dialog';
import { ScanDialog } from '../../components/ScanDialog';
import { useDb, useNow, useSnapshot } from '../../data-hooks';
import { Icon } from '../../icons';
import { useRecordPart } from '../../part';
import { goBack, href } from '../../shell/router';
import { showToast } from '../../shell/toast';
import { StorageError } from '../StorageError';
import { Missing } from '../places/Bin';
import { UnpackDialog } from './PutOut';

const fail = (e: unknown) => showToast(e instanceof Error ? e.message : String(e));
const TIME = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' });
const DAY = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });

function started(at: number | null, now: number): string {
  if (at === null) return 'not started';
  const d = new Date(at);
  return new Date(now).toDateString() === d.toDateString() ? `started today, ${TIME.format(d)}` : `started ${DAY.format(d)}`;
}

function Tick(props: { on: boolean; label: string; onToggle: () => void }) {
  return (
    <button type="button" class="tbox" role="checkbox" aria-checked={props.on} aria-label={props.label} onClick={props.onToggle}>
      <span>{props.on && <Icon name="check" />}</span>
    </button>
  );
}

export function SetupListScreen({ id }: { id: string }) {
  const live = useSnapshot();
  const back = (
    <button type="button" class="btn onb" aria-label="Back" onClick={() => goBack(href.season(id))}>
      <Icon name="chevLeft" />
    </button>
  );
  useRecordPart('holiday');
  if (live.state === 'error') return <StorageError error={live.error} />;
  if (live.state === 'loading') return <p class="fnote">Loading…</p>;
  const season = live.value.seasons.find((s) => s.id === id);
  if (!season) return <Missing what="Season" id={id} back={back} />;
  return <SetupList key={id} all={live.value} seasonId={id} back={back} />;
}

function SetupList({ all, seasonId, back }: { all: InventorySnapshot; seasonId: string; back: ComponentChildren }) {
  const db = useDb();
  const now = useNow(60_000);
  const today = new Date(now);
  const snap = useMemo(() => partView(all, 'holiday'), [all]);
  const season = snap.seasons.find((s) => s.id === seasonId)!;
  const runs = snap.seasonRuns;
  const run = currentRun(season, runs, today);
  const list = useMemo(() => setupList(snap, seasonId, run), [snap, seasonId, run]);
  const [showDone, setShowDone] = useState(false);
  const [unpack, setUnpack] = useState<Bin | 'choose' | null>(null);
  const [scanning, setScanning] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [task, setTask] = useState('');
  const displays = snap.displays;

  /** This year's run, started on the first tick if Start setup wasn't tapped. */
  const ensureRun = async (): Promise<SeasonRun> => (run && run.phase !== 'planned' ? run : startSetup(db, seasonId, runYear(season, runs, today)));
  const act = (f: () => Promise<unknown>) => void ensureRun().then(f).catch(fail);

  const toggleItem = (s: SetupItem) => act(() => (s.done ? putBack(db, [s.item.id]) : putOut(db, [{ id: s.item.id }])));
  const toggleBin = (b: Bin, out: boolean) => act(() => setBinsState(db, [b.id], out ? 'out' : 'stored'));

  const ix = indexPlaces(snap);
  const binsToUnpack = list.bins.map((b) => b.bin).filter((b) => snap.items.some((i) => i.binId === b.id && i.status === 'stored'));

  const onScan = (raw: string) => {
    setScanning(false);
    const r = resolveScan(raw, all);
    if (r.kind === 'bin') {
      const b = r.bin;
      if (b.part !== 'holiday' || b.seasonId !== seasonId) {
        showToast(`${b.code} ${b.name} isn’t a ${season.name} bin.`, { label: 'Open it', run: () => (location.hash = href.bin(b.id)) });
        return;
      }
      act(async () => {
        await setBinsState(db, [b.id], 'out');
        if (snap.items.some((i) => i.binId === b.id && i.status === 'stored')) setUnpack(b);
        else showToast(`${b.code} is out.`);
      });
    } else if (r.kind === 'item' && r.item.part === 'holiday' && itemSeasonId(r.item, ix) === seasonId) {
      const item = r.item;
      act(() => putOut(db, [{ id: item.id }]).then(() => showToast(`${item.name} is out.`)));
    } else if (r.kind === 'empty') {
      return;
    } else showToast(r.kind === 'unknown' || r.kind === 'missing-label' ? 'That code isn’t a bin on this phone.' : `That isn’t one of ${season.name}’s bins.`);
  };

  const c = list.count;
  const pct = c.all.total ? Math.round((100 * c.all.done) / c.all.total) : 0;
  const doneBins = list.bins.filter((b) => b.done);
  const openBins = list.bins.filter((b) => !b.done);
  const finished = run?.phase === 'up' || run?.phase === 'taking down' || run?.phase === 'done';

  return (
    <>
      <header class="top tint sl-head">
        <div class="sl-row">
          {back}
          <h1 class="h1">{season.name} setup</h1>
          <span class="ptag">Holiday</span>
        </div>
        <div class="bar" role="progressbar" aria-label="Setup progress" aria-valuemin={0} aria-valuemax={c.all.total} aria-valuenow={c.all.done}>
          <span style={{ width: `${pct}%` }} />
        </div>
        <span class="sl-meta">
          {c.all.done} of {c.all.total} done · {finished ? 'setup finished' : started(run?.startedAt ?? null, now)}
        </span>
      </header>
      <div class="slbody">
        {finished && <p class="slnote">Setup is finished. Ticks still change things; Reopen setup puts the season back to setting up.</p>}

        <div class="slsec">
          <h2>1 · Bins to bring out</h2>
          <span>
            {c.bins.done} of {c.bins.total}
          </span>
        </div>
        {list.bins.length === 0 && <p class="slempty">No bins have the {season.name} season. Give a bin its season in Edit bin.</p>}
        {[...openBins, ...(showDone ? doneBins : [])].map(({ bin, where, done }) => (
          <div class={done ? 'slrow done' : 'slrow'} key={bin.id}>
            <Tick on={done} label={done ? `${bin.code} is out; put it back to stored` : `Mark ${bin.code} out`} onToggle={() => toggleBin(bin, !done)} />
            <a class="rt" href={href.bin(bin.id)}>
              <strong>
                <span class="code">{bin.code}</span> {bin.name}
              </strong>
              <span>{where}</span>
            </a>
            {!done && (
              <button type="button" class="btn sm" onClick={() => toggleBin(bin, true)}>
                Out
              </button>
            )}
          </div>
        ))}
        {doneBins.length > 0 && (
          <button type="button" class="slmore" aria-expanded={showDone} onClick={() => setShowDone(!showDone)}>
            {showDone ? 'Hide the bins that are out' : `+ ${doneBins.length} more done (${doneBins.map((b) => b.bin.code).join(', ')})`}
          </button>
        )}

        <div class="slsec">
          <h2>2 · Put out</h2>
          <span>
            {c.items.done} of {c.items.total}
          </span>
        </div>
        {list.groups.length === 0 && <p class="slempty">No items have the {season.name} season yet.</p>}
        {list.groups.map((g) => (
          <div key={g.display?.id ?? 'none'}>
            <p class="slsub">
              <span>
                {g.display?.name ?? 'No display'} · {g.count.done} of {g.count.total}
              </span>
              {g.display && <a href={href.display(g.display.id)}>Photos</a>}
            </p>
            {g.items.map((s) => (
              <div class={s.done ? 'slrow done' : 'slrow'} key={s.item.id}>
                <Tick on={s.done} label={s.done ? `${s.item.name} is out; put it back` : `Put out ${s.item.name}`} onToggle={() => toggleItem(s)} />
                <a class="rt" href={href.item(s.item.id)}>
                  <strong>
                    {s.item.name} <Qty item={s.item} />
                  </strong>
                  <span>{s.done ? `out${s.item.outWhere && s.item.outDisplayId !== g.display?.id ? ` · ${s.item.outWhere}` : ''} · from ${s.home}` : `in ${s.home}`}</span>
                </a>
              </div>
            ))}
          </div>
        ))}
        {binsToUnpack.length > 0 && (
          <div class="slpad">
            <button type="button" class="btn" onClick={() => setUnpack(binsToUnpack.length === 1 ? binsToUnpack[0]! : 'choose')}>
              <Icon name="arrowOut" />
              Unpack a whole bin
            </button>
          </div>
        )}

        <div class="slsec">
          <h2>3 · Tasks</h2>
          <span>
            {c.tasks.done} of {c.tasks.total}
          </span>
        </div>
        {list.tasks.map(({ task: t, done }) => (
          <div class={done ? 'slrow done' : 'slrow'} key={t.id}>
            <Tick on={done} label={done ? `Done: ${t.text}` : t.text} onToggle={() => act(async () => tickTask(db, (await ensureRun()).id, t.id, !done))} />
            <span class="rt">
              <strong>{t.text}</strong>
            </span>
          </div>
        ))}
        <form
          class="sladd"
          onSubmit={(e) => {
            e.preventDefault();
            if (task.trim() === '') return;
            void addTask(db, seasonId, 'setup', task).then(() => setTask(''), fail);
          }}
        >
          <input class="field" aria-label="New setup task" value={task} placeholder="Add a task, e.g. Get the ladder" autoComplete="off" onInput={(e) => setTask((e.currentTarget as HTMLInputElement).value)} />
          <button type="submit" class="btn" disabled={task.trim() === ''}>
            <Icon name="plus" />
            Add
          </button>
        </form>
      </div>
      <div class="slfoot">
        <button type="button" class="btn pri lg" onClick={() => setScanning(true)}>
          <Icon name="scan" />
          Scan a bin
        </button>
        {finished ? (
          run?.phase === 'up' && (
            <button type="button" class="btn lg" onClick={() => void reopenSetup(db, run.id).then(() => showToast('Setup reopened.'), fail)}>
              Reopen setup
            </button>
          )
        ) : (
          <button type="button" class="btn lg" onClick={() => setFinishing(true)}>
            Finish setup
          </button>
        )}
      </div>

      {scanning && <ScanDialog labels title="Scan a bin’s label" onCode={onScan} onClose={() => setScanning(false)} />}
      {unpack === 'choose' && (
        <Dialog label="Unpack which bin?" onClose={() => setUnpack(null)}>
          <h2 class="h2">Unpack which bin?</h2>
          <div class="uplist">
            {binsToUnpack.map((b) => (
              <button key={b.id} type="button" class="uprow btn" style={{ justifyContent: 'flex-start', border: 0, borderRadius: 0 }} onClick={() => setUnpack(b)}>
                <span class="code">{b.code}</span>
                <span class="grow" style={{ textAlign: 'left' }}>
                  {b.name}
                </span>
              </button>
            ))}
          </div>
          <DialogActions>
            <button type="button" class="btn lg" onClick={() => setUnpack(null)}>
              Cancel
            </button>
          </DialogActions>
        </Dialog>
      )}
      {unpack && unpack !== 'choose' && <UnpackDialog bin={unpack} items={snap.items} displays={displays} onClose={() => setUnpack(null)} onDone={() => void ensureRun().catch(fail)} />}
      {finishing && (
        <Dialog label="Finish setup" onClose={() => setFinishing(false)}>
          <h2 class="h2">Finish {season.name} setup?</h2>
          <p class="dlg-p">
            {c.all.done === c.all.total
              ? 'Everything is ticked.'
              : `Still unticked: ${[c.bins.total - c.bins.done ? plural(c.bins.total - c.bins.done, 'bin') : '', c.items.total - c.items.done ? plural(c.items.total - c.items.done, 'item') : '', c.tasks.total - c.tasks.done ? plural(c.tasks.total - c.tasks.done, 'task') : ''].filter(Boolean).join(', ')}. They stay as they are.`}
          </p>
          <DialogActions>
            <button type="button" class="btn lg" data-autofocus onClick={() => setFinishing(false)}>
              Keep going
            </button>
            <button
              type="button"
              class="btn pri lg"
              onClick={() =>
                act(async () => {
                  await finishSetup(db, (await ensureRun()).id);
                  setFinishing(false);
                  showToast(`${season.name} is up.`);
                  location.hash = href.home('holiday');
                })
              }
            >
              <Icon name="check" />
              Finish setup
            </button>
          </DialogActions>
        </Dialog>
      )}
    </>
  );
}
