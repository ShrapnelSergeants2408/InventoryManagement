// Count-in (F24; mockups 10a–10e): choose how to walk the shop, count one item per screen
// with a keypad, then a summary per group. Each Save sets on_hand and last_counted straight
// away, so a count can stop and resume across meetings. No PIN anywhere here (§6).
// On a helper device (§18.3) the same screens count the helper's own copy: only its assigned
// groups are walked, any item can still be scanned or typed, the shop-tablet parts (order
// total, count rounds, helper devices, labels, backups) are left out, and a count outside the
// assignment is allowed and marked.
// The start screen is in CountStart.tsx and counting one item in CountItem.tsx; moving through a
// walk is in domain/count-walk.ts (review R9, M33).
import { useLiveValue } from '../../live';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { getCountSince, saveCount } from '../../../data/count';
import { getRecentLocations } from '../../../data/items';
import type { InventorySnapshot } from '../../../data/inventory';
import { loadCountOptions, saveCountOptions, saveCountPause, type CountOptions } from '../../../data/prefs';
import { countGroups, firstToCount, nextGroup, orderTotalCents, overallProgress, type CountGroup, type CountMode } from '../../../domain/count';
import { dueCount } from '../../../domain/recount';
import { formatIsoDate, localIsoDate } from '../../../domain/dates';
import { inAssignment } from '../../../domain/helper-mode';
import { type Item } from '../../../domain/types';
import { TopBar, plural } from '../../components/common';
import { useDb, useOnOrder, useSettings, useSnapshot } from '../../data-hooks';
import { Icon } from '../../icons';
import { useHelper } from '../../helper/session';
import { showToast } from '../../shell/toast';
import { StorageError } from '../StorageError';
import { moveTo, openWalk, savedStep, scanBack, scanOpen, scanSaved, scanSkip, skippedStep, startScan, type CountView, type Step } from '../../../domain/count-walk';
import { ItemCount, ScanCount, Summary } from './CountItem';
import { CountStart } from './CountStart';

/** `scanOnly`: the helper's Scan tab, which is scan as you go and nothing else (§18.3). */
export function CountScreen({ scanOnly = false }: { scanOnly?: boolean }) {
  const live = useSnapshot();
  if (live.state === 'error') return <StorageError error={live.error} />;
  if (live.state === 'loading') {
    return (
      <>
        <TopBar title="Count-in" subtitle="Loading…" />
        <div class="state" aria-busy="true">
          <p class="state-text muted">Loading…</p>
        </div>
      </>
    );
  }
  return <Count snap={live.value} scanOnly={scanOnly} />;
}

function Count({ snap, scanOnly }: { snap: InventorySnapshot; scanOnly: boolean }) {
  const db = useDb();
  const helper = useHelper();
  // Units on open placed orders (§4); none on a helper, which has no orders.
  const onOrder = useOnOrder();
  const [options, setOptionsRaw] = useState<CountOptions>(loadCountOptions);
  const [view, setView] = useState<CountView>(scanOnly ? startScan() : { kind: 'start' });
  const [recent, setRecent] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => void getRecentLocations(db).then(setRecent), [db]);
  // The count round (F24): items count as done when counted on or after this date; '' = ever.
  const since = useLiveValue(() => getCountSince(db), '', [db], 'keep');

  const setOptions = (patch: Partial<CountOptions>) => {
    const next = { ...options, ...patch };
    setOptionsRaw(next);
    saveCountOptions(next);
  };
  const byId = useMemo(() => new Map(snap.items.map((i) => [i.id, i])), [snap.items]);
  // What this device walks and counts progress over: everything, or a helper's assigned groups.
  const kit = helper?.kit ?? null;
  const mine = useMemo(() => (kit ? snap.items.filter((i) => inAssignment(i, kit)) : snap.items), [snap.items, kit]);
  const settings = useSettings();
  const recount = { today: localIsoDate(), days: settings.recountDays };
  const groupsFor = (mode: CountMode) => countGroups(mine, snap.categories, snap.locations, mode, options.skipZero, since, recount);

  /** Shows the step's screen and remembers (or forgets) where the walk is paused. */
  const go = (step: Step) => {
    saveCountPause(step.pause);
    setView(step.view);
  };
  const startWalk = (mode: 'category' | 'location', g: CountGroup, index = firstToCount(g.items, since)) => go(openWalk(mode, g, index, orderTotalCents(snap.items, onOrder)));

  /** Saves one count; true when it was saved. */
  const save = async (item: Item, value: number, location: string | undefined): Promise<boolean> => {
    if (busy) return false;
    setBusy(true);
    try {
      await saveCount(db, item.id, value, location);
      if (location) setRecent(await getRecentLocations(db));
      return true;
    } catch (e) {
      showToast(`Couldn't save the count: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const progress = overallProgress(mine, since);
  const dueTotal = dueCount(mine, recount.today, recount.days);
  const everCounted = overallProgress(mine).counted;
  const pct = progress.total ? Math.round((100 * progress.counted) / progress.total) : 0;
  const walking = view.kind === 'walk' || view.kind === 'scan';
  const top = (
    <TopBar
      title="Count-in"
      subtitle={
        view.kind === 'scan' ? (helper ? 'Scan as you go · any item, in your groups or not' : 'Scan as you go') : view.kind === 'walk' ? 'One item at a time · progress saves after each item' : 'A walk-through for counting what’s in the shop'
      }
      back={
        walking &&
        !scanOnly && (
          <button
            type="button"
            class="btn"
            // Not while a save is running: it would carry on to the next item after the pause.
            disabled={busy}
            onClick={() => {
              if (view.kind === 'scan' && view.saved.size > 0) showToast(`Counted ${plural(view.saved.size, 'item')} while scanning.`);
              setView({ kind: 'start' });
            }}
          >
            <Icon name="chevLeft" />
            Pause
          </button>
        )
      }
    >
      <div class="cprog" role="group" aria-label="Overall progress">
        <div class="cprog-t small">
          <span>
            {progress.counted} of {progress.total}{helper ? ' in your groups counted' : ' counted'}{since && ` since ${formatIsoDate(since)}`}
            {dueTotal > 0 && ` · ${dueTotal} due for a recount (not counted in ${settings.recountDays} days)`}
          </span>
          <span>{pct}%</span>
        </div>
        <div class="bar" aria-hidden="true">
          <span style={{ width: `${pct}%` }} />
        </div>
      </div>
    </TopBar>
  );

  if (view.kind === 'walk') {
    const w = view.walk;
    const item = byId.get(w.ids[w.index]!);
    const where = item ? (w.mode === 'category' && item.subcategory ? `${w.group} › ${item.subcategory}` : w.group) : w.group;
    return (
      <>
        {top}
        {item ? (
          <div class="walk">
            <ItemCount
              key={item.id}
              item={item}
              photo
              where={where}
              pos={`Item ${w.index + 1} of ${w.ids.length}`}
              pct={Math.round((100 * w.index) / w.ids.length)}
              initial={w.saved.has(item.id) ? String(item.onHand) : ''}
              askLocation={options.askLocation}
              snap={snap}
              recent={recent}
              busy={busy}
              onBack={w.index > 0 ? () => go(moveTo(w, w.index - 1)) : null}
              onSkip={() => go(skippedStep(w, item.id))}
              onSave={async (value, loc) => {
                if (await save(item, value, loc)) go(savedStep(w, item.id));
              }}
            />
          </div>
        ) : (
          <div class="state">
            <h2 class="h2">This item was deleted</h2>
            <button type="button" class="btn pri lg" onClick={() => go(moveTo(w, w.index + 1))}>
              Next item
            </button>
          </div>
        )}
      </>
    );
  }

  if (view.kind === 'done') {
    const groups = groupsFor(view.walk.mode);
    return (
      <>
        {top}
        <Summary walk={view.walk} snap={snap} onOrder={onOrder} since={since} helper={helper !== null} next={nextGroup(groups, view.walk.group)} onNext={(g) => startWalk(view.walk.mode, g)} onStart={() => setView({ kind: 'start' })} />
      </>
    );
  }

  if (view.kind === 'scan') {
    const item = view.current ? byId.get(view.current) : undefined;
    return (
      <>
        {top}
        <ScanCount
          snap={snap}
          item={item ?? null}
          count={view.history.length}
          askLocation={options.askLocation}
          recent={recent}
          busy={busy}
          initial={item && view.saved.has(item.id) ? String(item.onHand) : ''}
          onOpen={(id) => setView(scanOpen(view, id))}
          onBack={view.history.length > 0 ? () => setView(scanBack(view)) : null}
          onSkip={() => setView(scanSkip(view))}
          onSave={async (value, loc) => {
            if (!item) return;
            if (await save(item, value, loc)) setView(scanSaved(view, item.id));
          }}
        />
      </>
    );
  }

  return (
    <>
      {top}
      <CountStart
        snap={snap}
        mine={mine}
        helper={helper}
        options={options}
        setOptions={setOptions}
        since={since}
        progress={progress}
        everCounted={everCounted}
        onOrder={onOrder}
        groupsFor={groupsFor}
        openWalk={startWalk}
        startScan={() => setView(startScan())}
      />
    </>
  );
}
