// A Holiday season (SPEC v3.0 F23, F25, F8): this year's run and its next step (Start setup,
// the setup list), the season's setup and takedown tasks, its setup notes and photos, its
// displays, Browse and Add to Calendar.
import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import type { InventorySnapshot } from '../../../data/inventory';
import { addTask, moveTask, removeTask, startSetup, updateTask } from '../../../data/holiday';
import { saveBrowseBy, saveFilters, loadFilters } from '../../../data/prefs';
import { currentRun, runDates, runYear, seasonItems, setupList } from '../../../domain/holiday';
import { partView } from '../../../domain/parts';
import { indexPlaces } from '../../../domain/places';
import { nextWindow, shortDate, windowNow, windowText } from '../../../domain/seasons';
import type { Season, SeasonRun, SeasonTask, TaskPhase } from '../../../domain/types';
import { BackButton, StateMessage, TopBar, plural } from '../../components/common';
import { Dialog, DialogActions } from '../../components/Dialog';
import { PhotoCarousel } from '../../components/PhotoCarousel';
import { useDb, useNow, useSnapshot } from '../../data-hooks';
import { Icon } from '../../icons';
import { useRecordPart } from '../../part';
import { href } from '../../shell/router';
import { showToast } from '../../shell/toast';
import { StorageError } from '../StorageError';
import { UpDown } from '../more/Seasons';
import { addToCalendar } from './calendar';

const fail = (e: unknown) => showToast(e instanceof Error ? e.message : String(e));

/** Opens Browse by season, filtered to one season. */
export function openInBrowse(seasonId: string): void {
  saveBrowseBy('holiday', 'season');
  saveFilters('holiday', { ...loadFilters('holiday'), season: seasonId });
  location.hash = href.tab('holiday', 'browse');
}

/** Start setup (F25): this year's run, then its setup list. */
export async function beginSetup(db: ReturnType<typeof useDb>, season: Season, runs: readonly SeasonRun[], today: Date): Promise<void> {
  await startSetup(db, season.id, runYear(season, runs, today));
  location.hash = href.setup(season.id);
}

/** One line on where a season's run is (§3 phases). */
export function runText(season: Season, run: SeasonRun | null, done: { done: number; total: number }, today: Date): string {
  const dates = runDates(season, run);
  if (!run || run.phase === 'planned') {
    const w = windowNow(season, today) ?? nextWindow(season, today);
    return w ? `Not started · setup from ${shortDate(w.start)}` : 'Not started';
  }
  if (run.phase === 'setting up') return `Setting up · ${done.done} of ${done.total} done`;
  if (run.phase === 'up') return dates.takedownBy ? `Up · take down by ${shortDate(dates.takedownBy)}` : 'Up';
  if (run.phase === 'taking down') return 'Taking down';
  return `Done for ${run.year}`;
}

export function SeasonScreen({ id }: { id: string }) {
  const live = useSnapshot();
  const back = <BackButton fallback={href.home('holiday')} />;
  useRecordPart('holiday');
  if (live.state === 'error') return <StorageError error={live.error} />;
  if (live.state === 'loading') return <TopBar title="Season" back={back} part="holiday" />;
  const season = live.value.seasons.find((s) => s.id === id);
  if (!season)
    return (
      <>
        <TopBar title="Season not found" back={back} part="holiday" />
        <StateMessage icon="season" title="This season isn’t on this phone">
          <p class="state-text">It may have been removed, or this phone was restored from an older backup.</p>
        </StateMessage>
      </>
    );
  return <SeasonDetail season={season} all={live.value} back={back} />;
}

function SeasonDetail({ season, all, back }: { season: Season; all: InventorySnapshot; back: ComponentChildren }) {
  const db = useDb();
  const now = useNow(60_000);
  const today = new Date(now);
  const snap = partView(all, 'holiday');
  const run = currentRun(season, snap.seasonRuns, today);
  const list = setupList(snap, season.id, run);
  const ix = indexPlaces(snap);
  const items = seasonItems(snap, season.id, ix);
  const bins = snap.bins.filter((b) => b.seasonId === season.id);
  const started = run && run.phase !== 'planned';
  const tasks = snap.seasonTasks.filter((t) => t.seasonId === season.id);

  return (
    <>
      <TopBar title={season.name} kicker={windowText(season) || 'No dates'} back={back} part="holiday" />
      <div class="hsbody">
        <section class="card" aria-label="This year">
          <span>
            <span class={`chip season c-${season.color}`}>{season.name}</span> <span class="small muted">{`${plural(bins.length, 'bin')}, ${plural(items.length, 'item')}`}</span>
          </span>
          <h2 class="h2">{runText(season, run, list.count.all, today)}</h2>
          {started && (
            <div class="bar ink" role="progressbar" aria-label="Setup progress" aria-valuemin={0} aria-valuemax={list.count.all.total} aria-valuenow={list.count.all.done}>
              <span style={{ width: `${list.count.all.total ? Math.round((100 * list.count.all.done) / list.count.all.total) : 0}%` }} />
            </div>
          )}
          {started ? (
            <a class="btn pri lg" href={href.setup(season.id)}>
              <Icon name="lists" />
              Setup list
            </a>
          ) : (
            <button type="button" class="btn pri lg" onClick={() => void beginSetup(db, season, snap.seasonRuns, today).catch(fail)}>
              <Icon name="arrowOut" />
              Start setup
            </button>
          )}
          {(run?.phase === 'up' || run?.phase === 'taking down') && <p class="small muted m0">The takedown list comes in a later update.</p>}
          <div class="links">
            <button type="button" class="btn sm" onClick={() => openInBrowse(season.id)}>
              <Icon name="browse" />
              Bins and items
            </button>
            <button type="button" class="btn sm" onClick={() => void addToCalendar(snap.seasons)}>
              <Icon name="calendar" />
              Add to Calendar
            </button>
            <a class="btn sm" href={href.list('seasons')}>
              <Icon name="pencil" />
              Dates and notes
            </a>
          </div>
        </section>

        <TaskEditor season={season} phase="setup" tasks={tasks} />
        <TaskEditor season={season} phase="takedown" tasks={tasks} />

        <section class="card" aria-label="Setup notes and photos">
          <h2 class="h2">Setup notes and photos</h2>
          <p class={season.setupNotes ? 'notes m0' : 'muted m0'}>{season.setupNotes || 'No setup notes. Add them in Dates and notes.'}</p>
          <PhotoCarousel ownerType="season" ownerId={season.id} name={`${season.name} setup`} />
        </section>

        <section class="card" aria-label="Displays">
          <h2 class="h2">Displays</h2>
          {snap.displays.length === 0 ? (
            <p class="muted m0">
              No displays yet. Add the places decorations go (Mantel, Front porch) in <a href={href.list('displays')}>More › Displays</a>.
            </p>
          ) : (
            snap.displays.map((d) => {
              const n = items.filter((i) => i.displayId === d.id).length;
              return (
                <a key={d.id} class="lrow" href={href.display(d.id)}>
                  <Icon name="pin" />
                  <span class="t">
                    <strong>{d.name}</strong>
                    <span>{n ? `${plural(n, 'item')} of ${season.name}` : `Nothing of ${season.name} yet`}</span>
                  </span>
                  <Icon name="chevRight" />
                </a>
              );
            })
          )}
        </section>
      </div>
    </>
  );
}

/** A season's setup or takedown tasks: add, edit, reorder (▲/▼), remove. */
function TaskEditor({ season, phase, tasks }: { season: Season; phase: TaskPhase; tasks: readonly SeasonTask[] }) {
  const db = useDb();
  const [text, setText] = useState('');
  const [editing, setEditing] = useState<SeasonTask | null>(null);
  const mine = tasks.filter((t) => t.phase === phase).sort((a, b) => a.order - b.order);
  const title = phase === 'setup' ? 'Setup tasks' : 'Takedown tasks';
  return (
    <section class="card" aria-label={title}>
      <h2 class="h2">{title}</h2>
      <p class="small muted m0">{phase === 'setup' ? 'Ticked on the setup list each year.' : 'For the takedown list (a later update).'}</p>
      {mine.map((t, i) => (
        <div class="task" key={t.id}>
          <UpDown name={t.text} first={i === 0} last={i === mine.length - 1} move={(d) => void moveTask(db, t.id, d).catch(fail)} />
          <span class="t">{t.text}</span>
          <button type="button" class="btn sm" onClick={() => setEditing(t)}>
            Edit
          </button>
        </div>
      ))}
      <form
        class="inline-add"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) void addTask(db, season.id, phase, text).then(() => setText(''), fail);
        }}
      >
        <input class="field" aria-label={`New ${phase} task`} value={text} placeholder={phase === 'setup' ? 'e.g. Test the lights before hanging' : 'e.g. Recycle the tree'} autoComplete="off" onInput={(e) => setText((e.currentTarget as HTMLInputElement).value)} />
        <button type="submit" class="btn" disabled={text.trim() === ''}>
          <Icon name="plus" />
          Add
        </button>
      </form>
      {editing && <TaskDialog task={editing} onClose={() => setEditing(null)} />}
    </section>
  );
}

function TaskDialog({ task, onClose }: { task: SeasonTask; onClose: () => void }) {
  const db = useDb();
  const [text, setText] = useState(task.text);
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog label="Edit task" onClose={onClose}>
      <form
        class="dlg-form"
        onSubmit={(e) => {
          e.preventDefault();
          void updateTask(db, task.id, text).then(onClose, (err: unknown) => setError(err instanceof Error ? err.message : String(err)));
        }}
      >
        <h2 class="h2">Edit task</h2>
        <input class="field" aria-label="Task" value={text} autoComplete="off" onInput={(e) => setText((e.currentTarget as HTMLInputElement).value)} />
        {error && (
          <div class="err" role="alert">
            {error}
          </div>
        )}
        <DialogActions>
          <button
            type="button"
            class="btn danger lg"
            onClick={() =>
              void removeTask(db, task.id).then(() => {
                showToast(`Removed “${task.text}”.`);
                onClose();
              }, fail)
            }
          >
            <Icon name="trash" />
            Remove
          </button>
          <button type="submit" class="btn pri lg" disabled={text.trim() === ''}>
            Save
          </button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
