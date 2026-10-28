// Count-in (F24; mockups 10a–10e): choose how to walk the shop, count one item per screen
// with a keypad, then a summary per group. Each Save sets on_hand and last_counted straight
// away, so a count can stop and resume across meetings. No PIN anywhere here (§6).
// On a helper device (§18.3) the same screens count the helper's own copy: only its assigned
// groups are walked, any item can still be scanned or typed, the shop-tablet parts (order
// total, count rounds, helper devices, labels, backups) are left out, and a count outside the
// assignment is allowed and marked.
import { liveQuery } from 'dexie';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { getCountSince, saveCount, setCountSince } from '../../../data/count';
import { getRecentLocations, setBarcode } from '../../../data/items';
import type { InventorySnapshot } from '../../../data/inventory';
import { addLocation } from '../../../data/lists';
import { loadCountOptions, loadCountPause, saveCountOptions, saveCountPause, type CountOptions } from '../../../data/prefs';
import {
  cleanSince,
  countGroups,
  entryValue,
  firstToCount,
  nextGroup,
  orderTotalCents,
  overallProgress,
  previewStatus,
  summarize,
  type CountGroup,
  type CountMode,
} from '../../../domain/count';
import { countedDate, formatIsoDate, localIsoDate } from '../../../domain/dates';
import { assignedHelpers } from '../../../domain/helpers';
import { inAssignment } from '../../../domain/helper-mode';
import { NO_LOCATION, checkName, takenLocationNames } from '../../../domain/lists';
import { formatCents } from '../../../domain/money';
import { resolveScan } from '../../../domain/scan';
import { matchesQuery } from '../../../domain/search';
import { statusLabel, stockStatus } from '../../../domain/status';
import { nameKey, preferredVendorOf, type Item } from '../../../domain/types';
import { StatusChip, Toggle, TopBar, plural } from '../../components/common';
import { Dialog, DialogActions } from '../../components/Dialog';
import { Keypad } from '../../components/Keypad';
import { LocationScanDialog } from '../../components/LocationScanDialog';
import { Scanner, type CameraState } from '../../components/Scanner';
import { useDb, useHelpers, usePending, usePhoto, useSnapshot, useThumbnail } from '../../data-hooks';
import { Icon, type IconName } from '../../icons';
import { useHelper } from '../../helper/session';
import { href } from '../../shell/router';
import { showToast } from '../../shell/toast';
import { StorageError } from '../StorageError';

/** A walk through one group, frozen when it starts so a location picked mid-walk doesn't reshuffle it. */
interface Walk {
  mode: 'category' | 'location';
  group: string;
  ids: string[];
  index: number;
  /** Order-list total when the walk started (summary: before → after). */
  beforeCents: number;
  saved: ReadonlySet<string>;
  skipped: ReadonlySet<string>;
}

type View =
  | { kind: 'start' }
  | { kind: 'walk'; walk: Walk }
  | { kind: 'done'; walk: Walk }
  | {
      kind: 'scan';
      current: string | null;
      history: string[];
      saved: ReadonlySet<string>;
    };

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
  const [options, setOptionsRaw] = useState<CountOptions>(loadCountOptions);
  const [view, setView] = useState<View>(scanOnly ? { kind: 'scan', current: null, history: [], saved: new Set() } : { kind: 'start' });
  const [recent, setRecent] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => void getRecentLocations(db).then(setRecent), [db]);
  // The count round (F24): items count as done when counted on or after this date; '' = ever.
  const [since, setSince] = useState('');
  const [newRound, setNewRound] = useState(false);
  const [scanningLoc, setScanningLoc] = useState(false);
  const liveHelpers = useHelpers();
  const livePending = usePending();
  const pendingCount = livePending.state === 'ready' ? livePending.value.length : 0;
  const helpers = liveHelpers.state === 'ready' ? liveHelpers.value : [];
  useEffect(() => {
    const sub = liveQuery(() => getCountSince(db)).subscribe({ next: setSince, error: () => undefined });
    return () => sub.unsubscribe();
  }, [db]);

  const setOptions = (patch: Partial<CountOptions>) => {
    const next = { ...options, ...patch };
    setOptionsRaw(next);
    saveCountOptions(next);
  };
  const byId = useMemo(() => new Map(snap.items.map((i) => [i.id, i])), [snap.items]);
  // What this device walks and counts progress over: everything, or a helper's assigned groups.
  const kit = helper?.kit ?? null;
  const mine = useMemo(() => (kit ? snap.items.filter((i) => inAssignment(i, kit)) : snap.items), [snap.items, kit]);
  const groupsFor = (mode: CountMode) => countGroups(mine, snap.categories, snap.locations, mode, options.skipZero, since);

  const openWalk = (mode: 'category' | 'location', g: CountGroup, index = firstToCount(g.items, since)) => {
    const walk: Walk = {
      mode,
      group: g.name,
      ids: g.items.map((i) => i.id),
      index,
      beforeCents: orderTotalCents(snap.items),
      saved: new Set(),
      skipped: new Set(),
    };
    saveCountPause({ mode, group: g.name, itemId: walk.ids[index]! });
    setView({ kind: 'walk', walk });
  };
  const moveTo = (walk: Walk, index: number, patch: Partial<Walk> = {}) => {
    const next = { ...walk, ...patch };
    if (index >= walk.ids.length) {
      saveCountPause(null);
      setView({ kind: 'done', walk: next });
      return;
    }
    saveCountPause({
      mode: walk.mode,
      group: walk.group,
      itemId: walk.ids[index]!,
    });
    setView({ kind: 'walk', walk: { ...next, index } });
  };

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
              onBack={w.index > 0 ? () => moveTo(w, w.index - 1) : null}
              onSkip={() =>
                moveTo(w, w.index + 1, {
                  skipped: new Set(w.skipped).add(item.id),
                })
              }
              onSave={async (value, loc) => {
                if (await save(item, value, loc))
                  moveTo(w, w.index + 1, {
                    saved: new Set(w.saved).add(item.id),
                  });
              }}
            />
          </div>
        ) : (
          <div class="state">
            <h2 class="h2">This item was deleted</h2>
            <button type="button" class="btn pri lg" onClick={() => moveTo(w, w.index + 1)}>
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
        <Summary walk={view.walk} snap={snap} since={since} helper={helper !== null} next={nextGroup(groups, view.walk.group)} onNext={(g) => openWalk(view.walk.mode, g)} onStart={() => setView({ kind: 'start' })} />
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
          onOpen={(id) =>
            setView({
              ...view,
              current: id,
              history: view.current ? [...view.history, view.current] : view.history,
            })
          }
          onBack={
            view.history.length > 0
              ? () =>
                  setView({
                    ...view,
                    current: view.history.at(-1)!,
                    history: view.history.slice(0, -1),
                  })
              : null
          }
          onSkip={() =>
            setView({
              ...view,
              current: null,
              history: view.current ? [...view.history, view.current] : view.history,
            })
          }
          onSave={async (value, loc) => {
            if (!item) return;
            if (await save(item, value, loc))
              setView({
                ...view,
                current: null,
                history: [...view.history, item.id],
                saved: new Set(view.saved).add(item.id),
              });
          }}
        />
      </>
    );
  }

  // Start (10a)
  const groups = groupsFor(options.mode);
  // F24: each group shows the helper it's assigned to (scan mode tracks by category).
  const assigned = assignedHelpers(helpers, options.mode === 'location' ? 'location' : 'category');
  const pause = loadCountPause();
  const paused = (() => {
    if (!pause) return null;
    const g = groupsFor(pause.mode).find((x) => x.name === pause.group);
    const at = g ? g.items.findIndex((i) => i.id === pause.itemId) : -1;
    return g && at >= 0 ? { mode: pause.mode, group: g, at } : null;
  })();
  const located = mine.filter((i) => i.location !== '').length;
  const coded = mine.filter((i) => i.barcode !== '').length;
  const zero = mine.filter((i) => i.desired === 0).length;
  const modes: Array<{
    k: CountMode;
    icon: IconName;
    title: string;
    desc: string;
    rec?: string;
  }> = [
    {
      k: 'category',
      icon: 'folder',
      title: 'By category',
      desc: 'Follows the inventory list order. Works before any item has a location.',
      rec: everCounted === 0 ? 'Recommended for the first count' : undefined,
    },
    {
      k: 'location',
      icon: 'pin',
      title: 'By location',
      desc: `${plural(located, 'item')} ${located === 1 ? 'has' : 'have'} a location. Fastest once bins are labeled: one shelf at a time, in walk order.`,
    },
    {
      k: 'scan',
      icon: 'scan',
      title: 'Scan as you go',
      desc: `Scan a QR label or barcode and the keypad opens for that item. ${plural(coded, 'item')} ${coded === 1 ? 'has' : 'have'} a manufacturer barcode; best after QR labels are printed.`,
    },
  ];
  return (
    <>
      {top}
      <div class="cbody">
        {helper ? (
          <HelperStart groups={helper.kit.groups} kind={helper.kit.kind} items={mine.length} unsent={helper.unsent} allowNew={helper.kit.allowNewItems} />
        ) : (
          <>
        <div class="card ctotal">
          <Icon name="order" class="ic xl" />
          <div class="grow">
            <div class="ctotal-h">Order list right now: {formatCents(orderTotalCents(snap.items))}</div>
            <div class="small">
              {everCounted < progress.total
                ? 'Every item not counted yet counts with the on-hand number it has now (starter items begin at 0). The total drops as you count what’s already in the shop. '
                : 'Every item has been counted at least once. Recount a group whenever the shelves change. '}
              Progress saves after every item, so a count can span several meetings.
            </div>
          </div>
        </div>
        <div class="card cround">
          <Icon name="clock" class="ic xl" />
          <div class="grow">
            <div class="cround-h">{since ? `Counting since ${formatIsoDate(since)}` : 'First count'}</div>
            <div class="small muted">
              {since
                ? 'Items counted before this date show as not counted yet, so this recount shows its own progress. Their numbers stay as they are until you count them.'
                : 'An item is done once it has been counted at any time. Start a new count to recount the shop and see that recount’s progress.'}
            </div>
          </div>
          <button type="button" class="btn" onClick={() => setNewRound(true)}>
            {since ? 'Change date…' : 'Start a new count…'}
          </button>
          {since && (
            <button
              type="button"
              class="btn"
              onClick={() =>
                void setCountSince(db, '').then(
                  () => showToast('Progress now counts every item counted at any time.'),
                  (e: unknown) => showToast(e instanceof Error ? e.message : String(e)),
                )
              }
            >
              Count from the beginning
            </button>
          )}
        </div>
        {newRound && <NewRoundDialog since={since} onClose={() => setNewRound(false)} />}
        <div class="card chelp">
          <Icon name="phone" class="ic xl" />
          <div class="grow">
            <div class="chelp-h">{helpers.length ? `${plural(helpers.length, 'helper device')}` : 'Count with several devices'}</div>
            <div class="small muted">
              {helpers.length
                ? `${helpers.filter((h) => h.kits.length > 0).length} sent a count kit. Their counts come back here with Import counts.`
                : 'Other phones or tablets can count at the same time: give each its groups and send it a count kit.'}
            </div>
          </div>
          <div class="chelp-acts">
            <a class="btn" href={href.helpers}>
              Helper devices
            </a>
            <a class="btn" href={href.importCounts}>
              <Icon name="upload" />
              Import counts
            </a>
            {pendingCount > 0 && (
              <a class="btn pri" href={href.pending}>
                <span class="chip pend">{pendingCount}</span>
                Pending from helpers
              </a>
            )}
          </div>
        </div>
          </>
        )}
        {paused && (
          <div class="banner cpause" role="status">
            <Icon name="count" />
            <span class="grow">
              Paused in {paused.group.name} ({paused.mode === 'location' ? 'by location' : 'by category'}) at item {paused.at + 1} of {paused.group.items.length}.
            </span>
            <button type="button" class="btn onb" onClick={() => openWalk(paused.mode, paused.group, paused.at)}>
              Pick up there
            </button>
          </div>
        )}
        <div>
          <h2 class="h2 cq">How do you want to walk the shop?</h2>
          <div class="modes" role="radiogroup" aria-label="Count mode">
            {modes.map((m) => (
              <button
                key={m.k}
                type="button"
                role="radio"
                aria-checked={options.mode === m.k}
                class={options.mode === m.k ? 'mode on' : 'mode'}
                onClick={() => setOptions({ mode: m.k })}
              >
                <span class="mode-h">
                  <Icon name={m.icon} />
                  {m.title}
                </span>
                <span class="small muted">{m.desc}</span>
                {m.rec && <strong class="small">{m.rec}</strong>}
              </button>
            ))}
          </div>
        </div>
        <div class="togs">
          <Toggle on={options.askLocation} onClick={() => setOptions({ askLocation: !options.askLocation })}>
            Ask for a bin/shelf location while counting
          </Toggle>
          <Toggle on={options.skipZero} onClick={() => setOptions({ skipZero: !options.skipZero })}>
            Skip items with desired 0 ({zero})
          </Toggle>
        </div>
        {options.mode === 'scan' && (
          <div>
            <button
              type="button"
              class="btn pri lg"
              onClick={() =>
                setView({
                  kind: 'scan',
                  current: null,
                  history: [],
                  saved: new Set(),
                })
              }
            >
              <Icon name="scan" />
              Start scanning
            </button>
          </div>
        )}
        {options.mode === 'location' && (
          <div>
            {/* F29: scan the bin in front of you to count it. */}
            <button type="button" class="btn lg" onClick={() => setScanningLoc(true)}>
              <Icon name="scan" />
              Scan a location
            </button>
          </div>
        )}
        {scanningLoc && (
          <LocationScanDialog
            locations={snap.locations}
            notFound="report"
            title="Scan a location to count"
            onClose={() => setScanningLoc(false)}
            onPicked={(l) => {
              setScanningLoc(false);
              const g = groups.find((x) => nameKey(x.name) === nameKey(l.name));
              if (g) openWalk('location', g);
              else showToast(`${l.name} has no items to count.`);
            }}
          />
        )}
        <div class="card cgroups">
          <div class="cg-h">
            <h2 class="h2 grow">{options.mode === 'location' ? 'Locations' : 'Categories'}</h2>
            <span class="small muted">
              {options.mode === 'scan' ? 'Scanning tracks progress by category' : options.mode === 'location' ? 'In walk order (More › Locations)' : 'Tap Start or Continue'}
            </span>
          </div>
          {groups.length === 0 && <div class="cg-row muted">No items to count.</div>}
          {groups.map((g) => {
            const p = Math.round((100 * g.counted) / g.items.length);
            const mode = options.mode;
            const who = assigned.get(nameKey(g.name));
            return (
              <div key={g.name} class="cg-row">
                <div class="cg-n">
                  <strong>{g.name}</strong> <span class="small muted">{plural(g.items.length, 'item')}</span>
                  {who && !helper && <span class="small cg-help">Helper: {who.join(', ')}</span>}
                </div>
                <strong class="tnum">
                  {g.counted} / {g.items.length}
                </strong>
                <div class="bar cg-bar" aria-hidden="true">
                  <span style={{ width: `${p}%` }} />
                </div>
                {mode !== 'scan' && (
                  <button type="button" class={g.action === 'start' ? 'btn pri sm' : 'btn sm'} aria-label={`${ACTION[g.action]} ${g.name}`} onClick={() => openWalk(mode, g)}>
                    {ACTION[g.action]}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

/** The helper's start card (§18.3, §18.4): its groups, Add item not on the list, the send reminder. */
function HelperStart(props: { groups: readonly string[]; kind: 'category' | 'location'; items: number; unsent: number; allowNew: boolean }) {
  const many = props.groups.length !== 1;
  const what = props.kind === 'location' ? (many ? 'locations' : 'location') : many ? 'categories' : 'category';
  return (
    <>
      {props.unsent > 0 && (
        <div class="banner hremind" role="status">
          <Icon name="upload" />
          <span class="grow">{plural(props.unsent, 'change')} not sent yet. Send your counts to the shop tablet before you leave.</span>
          <a class="btn onb" href="#/send">
            Send
          </a>
        </div>
      )}
      <div class="card chelp hmine">
        <Icon name={props.kind === 'location' ? 'pin' : 'folder'} class="ic xl" />
        <div class="grow">
          <div class="chelp-h">
            Your {what}: {props.groups.join(', ')}
          </div>
          <div class="small muted">{plural(props.items, 'item')} to count. Anything else you find can still be counted with Scan; the shop tablet sees it was outside your groups.</div>
        </div>
        {props.allowNew && (
          <a class="btn" href="#/add">
            <Icon name="plus" />
            Add item not on the list
          </a>
        )}
      </div>
    </>
  );
}

const ACTION = {
  start: 'Start',
  continue: 'Continue',
  recount: 'Recount',
} as const;

/** Start a count round (F24): progress counts items counted on or after the date. Erases nothing. */
function NewRoundDialog(props: { since: string; onClose: () => void }) {
  const db = useDb();
  const today = localIsoDate();
  const [date, setDate] = useState(props.since || today);
  const [busy, setBusy] = useState(false);
  const ok = cleanSince(date) !== '' && date <= today;
  const submit = async (e: Event) => {
    e.preventDefault();
    if (!ok || busy) return;
    setBusy(true);
    try {
      await setCountSince(db, date);
      showToast(`Counting since ${formatIsoDate(date)}.`);
      props.onClose();
    } catch (err) {
      setBusy(false);
      showToast(err instanceof Error ? err.message : String(err));
    }
  };
  return (
    <Dialog label="Start a new count" onClose={() => !busy && props.onClose()}>
      <form class="dlg-form" onSubmit={(e) => void submit(e)}>
        <h2 class="h2">{props.since ? 'Change the count date' : 'Start a new count'}</h2>
        <p class="dlg-p">Progress will count items counted on or after this date. Nothing is erased: every on-hand number and count date stays as it is.</p>
        <div>
          <label class="lbl" for="round-date">
            Counting since
          </label>
          <input id="round-date" class="field" type="date" max={today} value={date} onInput={(e) => setDate((e.currentTarget as HTMLInputElement).value)} />
          {!ok && (
            <div class="err" role="alert">
              Choose a date, today or earlier.
            </div>
          )}
        </div>
        <DialogActions>
          <button type="button" class="btn lg" disabled={busy} onClick={props.onClose}>
            Cancel
          </button>
          <button type="submit" class="btn pri lg" disabled={!ok || busy}>
            {props.since ? 'Use this date' : 'Start new count'}
          </button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

// ── One item (10b, 10e) ──

interface ItemCountProps {
  item: Item;
  where: string;
  pos: string;
  pct: number;
  /** The keypad's starting value: what was saved for this item in this walk, else empty. */
  initial: string;
  askLocation: boolean;
  snap: InventorySnapshot;
  recent: string[];
  busy: boolean;
  onBack: (() => void) | null;
  onSkip: () => void;
  onSave: (value: number, location: string | undefined) => void;
  /** Show the item's photo (scan mode shows the camera instead, outside this component). */
  photo: boolean;
  /** Called with true while a count is typed and not saved. */
  onDirty?: (dirty: boolean) => void;
  saveLabel?: string;
}

function ItemCount(p: ItemCountProps) {
  const helper = useHelper();
  const outside = helper !== null && !inAssignment(p.item, helper.kit);
  const [entry, setEntry] = useState(p.initial);
  // undefined: the location stays as it is.
  const [loc, setLoc] = useState<string | undefined>(undefined);
  const photo = usePhoto(p.item.id, p.photo && p.item.hasPhoto);
  const value = entryValue(entry);
  const preview = previewStatus(p.item, entry);
  const vendor = preferredVendorOf(p.item);
  const meta = [p.item.subcategory ? `${p.item.category} › ${p.item.subcategory}` : p.item.category, vendor ? `${vendor.supplier} ${vendor.partNo}`.trim() : '']
    .filter(Boolean)
    .join(' · ');
  const dirty = entry !== p.initial || loc !== undefined;
  const onDirty = useRef(p.onDirty);
  onDirty.current = p.onDirty;
  useEffect(() => onDirty.current?.(dirty), [dirty]);
  useEffect(() => () => onDirty.current?.(false), []);

  return (
    <>
      <div class="wl">
        {p.photo &&
          (p.item.hasPhoto && photo ? (
            <img class="wphoto" src={photo.url} alt={p.item.name} />
          ) : (
            <div class="wphoto nophoto">
              <Icon name="photo" class="ic xl" />
              <span>{p.item.hasPhoto ? 'Loading photo…' : 'No photo'}</span>
            </div>
          ))}
        <div class="wl-t">
          <h2 class="h2 wname">{p.item.name}</h2>
          {outside && (
            <div class="small hout" role="note">
              <Icon name="info" />
              Not in your groups. Count it anyway if it’s here; the shop tablet will see it was outside your groups.
            </div>
          )}
          <div class="small muted">{meta}</div>
          <div>
            <span class="small muted">Desired</span> <strong>{p.item.desired}</strong> · <span class="small muted">spares</span> <strong>{p.item.spares}</strong> ·{' '}
            <span class="small muted">unit</span> <strong>{p.item.unit}</strong>
          </div>
          <div class="small muted">
            {p.item.lastCounted ? `Last counted ${formatIsoDate(countedDate(p.item.lastCounted))}${p.item.countedBy ? ` by ${p.item.countedBy}` : ''}: ${p.item.onHand} ${p.item.unit}` : `Not counted yet (on hand now: ${p.item.onHand})`}
          </div>
          {p.askLocation && <LocationPick item={p.item} loc={loc} onLoc={setLoc} snap={p.snap} recent={p.recent} />}
        </div>
      </div>
      <div class="wr">
        <div class="wr-pos small">
          <span>{p.where}</span>
          <span>{p.pos}</span>
        </div>
        <div class="bar" aria-hidden="true">
          <span style={{ width: `${p.pct}%` }} />
        </div>
        <div class="wq" id="wq">
          How many are in the shop right now?
        </div>
        <div class="disp">
          <div class={value === null ? 'val empty' : 'val'} role="status" aria-live="polite" aria-labelledby="wq">
            {value === null ? 'Type the count' : entry}
          </div>
          <div class="disp-r">
            <span class="muted">{p.item.unit}</span>
            {preview && (
              <span class="wpv">
                <StatusChip status={preview} prefix="After saving: " />
              </span>
            )}
          </div>
        </div>
        <Keypad entry={entry} desired={p.item.desired} onEntry={setEntry} disabled={p.busy} />
        <div class="wacts">
          {p.onBack && (
            <button type="button" class="btn" disabled={p.busy} onClick={p.onBack}>
              Back
            </button>
          )}
          <button type="button" class="btn" disabled={p.busy} onClick={p.onSkip}>
            Skip for now
          </button>
          <button type="button" class="btn pri lg wsave" disabled={value === null || p.busy} onClick={() => value !== null && p.onSave(value, loc)}>
            {p.saveLabel ?? 'Save & next'}
            <Icon name="chevRight" />
          </button>
        </div>
      </div>
    </>
  );
}

const ALL_LOC = '\u0000all';

/** Location quick picks (F25: recently used first), every location in walk order, and "New location…". */
function LocationPick(props: { item: Item; loc: string | undefined; onLoc: (l: string | undefined) => void; snap: InventorySnapshot; recent: string[] }) {
  const db = useDb();
  // A helper can't clear a location: a blank location in the counts file means "unchanged" (§18.4).
  const helper = useHelper();
  const [adding, setAdding] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const names = props.snap.locations.map((l) => l.name);
  const shown = props.loc ?? props.item.location;
  const quick = props.recent.filter((r) => names.includes(r)).slice(0, 5);
  if (props.item.location !== '' && names.includes(props.item.location) && !quick.includes(props.item.location)) quick.unshift(props.item.location);
  if (props.loc && !quick.includes(props.loc)) quick.unshift(props.loc);
  const check = adding === null || adding.trim() === '' ? null : checkName(adding, takenLocationNames(names), 'Location');
  const add = async () => {
    if (!check?.ok) return;
    try {
      const l = await addLocation(db, check.name);
      props.onLoc(l.name);
      setAdding(null);
      showToast(`Added location “${l.name}”.`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <div class="wloc">
      <div class="wloc-h">
        Location: {shown || 'not set'}
        {props.loc !== undefined && props.loc !== props.item.location && <span class="wloc-new"> (saved with the count)</span>}
      </div>
      <div class="locs">
        {quick.map((l) => (
          <button
            key={l}
            type="button"
            class={shown === l ? 'fchip on' : 'fchip'}
            aria-pressed={shown === l}
            onClick={() => props.onLoc(l === props.item.location ? undefined : l)}
          >
            {l}
          </button>
        ))}
        {names.length > quick.length && (
          <select
            class="field wloc-all"
            aria-label="All locations"
            value={ALL_LOC}
            onChange={(e) => {
              const v = (e.currentTarget as HTMLSelectElement).value;
              if (v !== ALL_LOC) props.onLoc(v === props.item.location ? undefined : v);
            }}
          >
            <option value={ALL_LOC}>All locations…</option>
            {names.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
            {props.item.location !== '' && !helper && <option value="">{NO_LOCATION}</option>}
          </select>
        )}
        {adding === null && (
          <button type="button" class="fchip" onClick={() => setAdding('')}>
            <Icon name="plus" />
            New location…
          </button>
        )}
        <button type="button" class="fchip" onClick={() => setScanning(true)}>
          <Icon name="scan" />
          Scan
        </button>
      </div>
      {scanning && (
        <LocationScanDialog
          locations={props.snap.locations}
          notFound="offer"
          onClose={() => setScanning(false)}
          onPicked={(l) => {
            setScanning(false);
            props.onLoc(l.name === props.item.location ? undefined : l.name);
          }}
        />
      )}
      {adding !== null && (
        <div class="wloc-add">
          <div class="inline-add">
            <input
              class={check && !check.ok ? 'field bad' : 'field'}
              aria-label="New location name"
              autoFocus
              autoComplete="off"
              placeholder="e.g. Bin F17"
              value={adding}
              onInput={(e) => setAdding((e.currentTarget as HTMLInputElement).value)}
              onKeyDown={(e) => e.key === 'Enter' && void add()}
            />
            <button type="button" class="btn" disabled={!check?.ok} onClick={() => void add()}>
              Add
            </button>
            <button type="button" class="btn" onClick={() => setAdding(null)}>
              Cancel
            </button>
          </div>
          {check && !check.ok && (
            <div class="small err" role="alert">
              {check.error}
            </div>
          )}
        </div>
      )}
      {names.length === 0 && adding === null && <div class="small muted">No locations yet. Add one here or in More › Locations.</div>}
    </div>
  );
}
// ── Group summary (10d) ──

function Summary(props: { walk: Walk; snap: InventorySnapshot; since: string; helper: boolean; next: CountGroup | null; onNext: (g: CountGroup) => void; onStart: () => void }) {
  const w = props.walk;
  const s = summarize(w.ids, props.snap.items, w.saved, w.skipped, props.since);
  return (
    <div class="cbody">
      <div class="done-h">
        <span class="done-ic">
          <Icon name="check" />
        </span>
        <div>
          <h2 class="h1">{w.group} counted</h2>
          <div class="small muted">
            {s.counted} of {plural(s.total, 'item')} in this {w.mode === 'location' ? 'location' : 'category'} counted so far
          </div>
        </div>
      </div>
      <div class={props.helper ? 'sumgrid three' : 'sumgrid'}>
        <div class="tile">
          <span class="k">Counted</span>
          <span class="v">
            {s.counted} / {s.total}
          </span>
        </div>
        <div class="tile">
          <span class="k">Short</span>
          <span class="v sum-short">
            <Icon name="short" />
            {s.short}
          </span>
        </div>
        <div class="tile">
          <span class="k">Skipped</span>
          <span class="v">{s.skipped}</span>
        </div>
        {!props.helper && (
          <div class="tile">
            <span class="k">Order list</span>
            <span class="v sum-tot">
              {formatCents(w.beforeCents)} → {formatCents(orderTotalCents(props.snap.items))}
            </span>
          </div>
        )}
      </div>
      <div class="card cgroups">
        <div class="cg-h">
          <h2 class="h2">Just counted</h2>
        </div>
        {s.justCounted.length === 0 && <div class="cg-row muted">Nothing was saved in this walk.</div>}
        {s.justCounted.map((i) => (
          <SummaryRow key={i.id} item={i} />
        ))}
      </div>
      <div class="wacts">
        {props.next ? (
          <button type="button" class="btn pri lg" onClick={() => props.onNext(props.next!)}>
            Next: {props.next.name} ({props.next.items.length})
          </button>
        ) : (
          <button type="button" class="btn pri lg" onClick={props.onStart}>
            Back to all groups
          </button>
        )}
        {props.helper ? (
          <a class="btn lg" href="#/send">
            <Icon name="upload" />
            Send my counts
          </a>
        ) : (
          <>
            <a class="btn lg" href={href.labels(w.ids)}>
              <Icon name="labels" />
              Print labels for {w.group}
            </a>
            <a class="btn lg" href={href.backup}>
              Back up now
            </a>
          </>
        )}
        {props.next && (
          <button type="button" class="btn lg" onClick={props.onStart}>
            Done for now
          </button>
        )}
      </div>
    </div>
  );
}

function SummaryRow({ item }: { item: Item }) {
  const thumb = useThumbnail(item.id, item.hasPhoto);
  const st = stockStatus(item.onHand, item.desired, item.spares);
  return (
    <div class="srow2" aria-label={`${item.name}: ${item.onHand} ${item.unit}, ${statusLabel(st)}`}>
      {thumb ? <img src={thumb} alt="" /> : <span class="srow2-ph nophoto" />}
      <span class="srow2-n">{item.name}</span>
      <span class="srow2-v">
        {item.onHand} {item.unit}
      </span>
      <StatusChip status={st} />
    </div>
  );
}

/** A helper attaches an unknown barcode to an item (§18.3; F21 without the PIN). */
function AttachDialog(props: { code: string; items: readonly Item[]; onClose: () => void; onAttached: (item: Item) => void }) {
  const db = useDb();
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const matches = useMemo(() => (q.trim() ? props.items.filter((i) => matchesQuery(i, q)).slice(0, 12) : []), [q, props.items]);
  const attach = async (item: Item) => {
    if (busy) return;
    setBusy(true);
    try {
      const saved = await setBarcode(db, item.id, props.code);
      showToast(`Barcode attached to “${saved.name}”.`);
      props.onAttached(saved);
    } catch (e) {
      setBusy(false);
      showToast(`Couldn't attach: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  return (
    <Dialog label="Attach barcode" onClose={() => !busy && props.onClose()}>
      <div class="dlg-form">
        <h2 class="h2">Attach {props.code} to…</h2>
        <input class="field" type="search" aria-label="Find the item" autoComplete="off" placeholder="Name, part # or supplier" value={q} onInput={(e) => setQ((e.currentTarget as HTMLInputElement).value)} />
        <div class="picks">
          {matches.map((i) => (
            <button key={i.id} type="button" class="pick" disabled={busy} onClick={() => void attach(i)}>
              <span class="pick-t">
                <strong>{i.name}</strong>
                <span class="small muted">
                  {i.category} · {i.barcode ? `replaces barcode ${i.barcode}` : 'no barcode yet'}
                </span>
              </span>
            </button>
          ))}
          {q.trim() !== '' && matches.length === 0 && <p class="muted m0">No items match. Try another word.</p>}
        </div>
        <DialogActions>
          <button type="button" class="btn lg" disabled={busy} onClick={props.onClose}>
            Cancel
          </button>
        </DialogActions>
      </div>
    </Dialog>
  );
}

// ── Scan as you go (10c) ──

function ScanCount(props: {
  snap: InventorySnapshot;
  item: Item | null;
  count: number;
  askLocation: boolean;
  recent: string[];
  busy: boolean;
  initial: string;
  onOpen: (id: string) => void;
  onBack: (() => void) | null;
  onSkip: () => void;
  onSave: (value: number, location: string | undefined) => void;
}) {
  const [camera, setCamera] = useState<CameraState>('starting');
  const [note, setNote] = useState<string | null>(null);
  const [picks, setPicks] = useState<Item[] | null>(null);
  const [typed, setTyped] = useState('');
  const helper = useHelper();
  // A helper's unknown code, waiting for Attach or Add (§18.3).
  const [unknown, setUnknown] = useState<string | null>(null);
  const [attaching, setAttaching] = useState<string | null>(null);
  const dirty = useRef(false);
  // The item just saved or skipped: its label is usually still in front of the camera, so the
  // camera ignores it until another item is saved or skipped. Typing its code still opens it.
  const done = useRef<string | null>(null);
  const blocked = camera === 'denied' || camera === 'nocamera' || camera === 'error';

  const open = (item: Item) => {
    if (props.item && item.id === props.item.id) return;
    if (dirty.current) {
      setNote(`Save or skip “${props.item?.name ?? ''}” first, then scan “${item.name}”.`);
      return;
    }
    setNote(null);
    setPicks(null);
    setUnknown(null);
    setTyped('');
    props.onOpen(item.id);
  };
  const find = (raw: string, typedByHand: boolean) => {
    const r = resolveScan(raw, props.snap.items);
    if (r.kind === 'empty') return;
    if (r.kind === 'item') return typedByHand || r.item.id !== done.current ? open(r.item) : undefined;
    if (r.kind === 'many') {
      setPicks(r.items);
      setNote(`${plural(r.items.length, 'item')} have barcode ${r.code}. Choose the one in your hand.`);
      return;
    }
    if (typedByHand) {
      const matches = props.snap.items.filter((i) => matchesQuery(i, raw)).slice(0, 8);
      if (matches.length === 1) return open(matches[0]!);
      if (matches.length > 1) {
        setPicks(matches);
        setNote(`${plural(matches.length, 'item')} match “${raw.trim()}”. Choose one.`);
        return;
      }
    }
    setPicks(null);
    if (helper && r.kind !== 'missing-label') {
      setNote(null);
      setUnknown(r.code);
      return;
    }
    setNote(
      r.kind === 'missing-label'
        ? `The label ${r.id} is for an item that isn’t on this ${helper ? 'device' : 'tablet'}.`
        : `No item has the code ${r.code}. To attach it to an item, use the Scan tab.`,
    );
  };

  const side = (
    <div class="wscan">
      {blocked ? (
        <div class="wcam-off" role="alert">
          <Icon name="camoff" class="ic xl" />
          <span>
            {camera === 'denied'
              ? 'The camera is blocked for this app (Chrome › Site settings › Camera). Type a code or a name below.'
              : 'The camera isn’t available. Type a code or a name below.'}
          </span>
        </div>
      ) : (
        <Scanner paused={false} onDetect={(c) => find(c, false)} onState={setCamera}>
          <div class="reticle" aria-hidden="true">
            <span class="a" />
            <span class="b" />
            <span class="c" />
            <span class="d" />
            <span class="line" />
          </div>
          <div class="wcam-t">{camera === 'starting' ? 'Starting the camera…' : 'Scanning…'}</div>
        </Scanner>
      )}
      <form
        class="inline-add"
        onSubmit={(e) => {
          e.preventDefault();
          find(typed, true);
        }}
      >
        <input
          class="field"
          aria-label="Code or name"
          autoComplete="off"
          placeholder="Item ID, barcode or name"
          value={typed}
          onInput={(e) => setTyped((e.currentTarget as HTMLInputElement).value)}
        />
        <button type="submit" class="btn" disabled={typed.trim() === ''}>
          Find
        </button>
      </form>
      {note && (
        <div class="small wnote" role="alert">
          {note}
        </div>
      )}
      {unknown !== null && (
        <div class="card hunk" role="alert">
          <strong>No item has the code <span class="mono">{unknown}</span></strong>
          <div class="hunk-acts">
            <button type="button" class="btn" onClick={() => setAttaching(unknown)}>
              Attach to an item…
            </button>
            {helper?.kit.allowNewItems && (
              <a class="btn" href={`#/add?${new URLSearchParams({ barcode: unknown })}`}>
                <Icon name="plus" />
                Add item not on the list
              </a>
            )}
          </div>
        </div>
      )}
      {attaching !== null && (
        <AttachDialog
          code={attaching}
          items={props.snap.items}
          onClose={() => setAttaching(null)}
          onAttached={(item) => {
            setAttaching(null);
            setUnknown(null);
            open(item);
          }}
        />
      )}
      {picks && (
        <div class="picks">
          {picks.map((i) => (
            <button key={i.id} type="button" class="pick" onClick={() => open(i)}>
              <span class="pick-t">
                <strong>{i.name}</strong>
                <span class="small muted">
                  {i.category} · {i.location || NO_LOCATION}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );

  // The camera sits outside the per-item part, so it keeps running from one item to the next.
  return (
    <div class="walk scanm">
      <div class="wcam">{side}</div>
      {props.item ? (
        <ItemCount
          key={props.item.id}
          item={props.item}
          photo={false}
          where="Scan as you go"
          pos={`Scan ${props.count + 1}`}
          pct={0}
          initial={props.initial}
          askLocation={props.askLocation}
          snap={props.snap}
          recent={props.recent}
          busy={props.busy}
          saveLabel="Save & scan next"
          onDirty={(d) => (dirty.current = d)}
          onBack={props.onBack}
          onSkip={() => {
            dirty.current = false;
            done.current = props.item!.id;
            props.onSkip();
          }}
          onSave={(v, l) => {
            dirty.current = false;
            done.current = props.item!.id;
            props.onSave(v, l);
          }}
        />
      ) : (
        <div class="wr wwait">
          <div class="wr-pos small">
            <span>Scan as you go</span>
            <span>{props.count > 0 ? `${plural(props.count, 'item')} so far` : ''}</span>
          </div>
          <div class="state">
            <div class="bigic">
              <Icon name="scan" />
            </div>
            <h2 class="h2">Scan the next item</h2>
            <p class="state-text muted">Point the camera at a QR label or a barcode; the keypad opens for that item. Items without a code: type the ID or name and tap Find.</p>
            {props.onBack && (
              <button type="button" class="btn" onClick={props.onBack}>
                Back to the last item
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
