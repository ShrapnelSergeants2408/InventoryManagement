// Count-in (F24): the start screen (mockup 10a), the helper's start card, and starting a new count
// round. Moved out of Count.tsx (review R9, M33).
import { useState } from 'preact/hooks';
import { setCountSince } from '../../../data/count';
import type { InventorySnapshot } from '../../../data/inventory';
import { loadCountPause, type CountOptions } from '../../../data/prefs';
import { cleanSince, orderTotalCents, type CountGroup, type CountMode } from '../../../domain/count';
import { formatIsoDate, localIsoDate } from '../../../domain/dates';
import { assignedHelpers, groupLabels } from '../../../domain/helpers';
import { formatCents } from '../../../domain/money';
import { nameKey, type Item } from '../../../domain/types';
import { Toggle, plural } from '../../components/common';
import { Dialog, DialogActions } from '../../components/Dialog';
import { LocationScanDialog } from '../../components/LocationScanDialog';
import { useDb, useHelpers, usePending } from '../../data-hooks';
import { Icon, type IconName } from '../../icons';
import { href } from '../../shell/router';
import { showToast } from '../../shell/toast';
import { pausedAt } from '../../../domain/count-walk';
import type { HelperSession } from '../../helper/session';

/** What the start screen needs from the Count screen. */
export interface CountStartProps {
  snap: InventorySnapshot;
  /** The items this device counts: everything, or a helper's assigned groups. */
  mine: readonly Item[];
  helper: HelperSession | null;
  options: CountOptions;
  setOptions: (patch: Partial<CountOptions>) => void;
  since: string;
  progress: { counted: number; total: number };
  everCounted: number;
  onOrder: ReadonlyMap<string, number>;
  groupsFor: (mode: CountMode) => CountGroup[];
  openWalk: (mode: 'category' | 'location', g: CountGroup, index?: number) => void;
  startScan: () => void;
}

/** The start screen (mockup 10a): the shop-tablet cards or the helper's, a paused walk, the mode and the groups. */
export function CountStart(props: CountStartProps) {
  const { snap, mine, helper, options, setOptions, since, progress, everCounted, onOrder, groupsFor, openWalk } = props;
  const db = useDb();
  const [newRound, setNewRound] = useState(false);
  const [scanningLoc, setScanningLoc] = useState(false);
  const liveHelpers = useHelpers();
  const livePending = usePending();
  const pendingCount = livePending.state === 'ready' ? livePending.value.length : 0;
  const helpers = liveHelpers.state === 'ready' ? liveHelpers.value : [];
  const groups = groupsFor(options.mode);
  // F24: each group shows the helper it's assigned to (scan mode tracks by category).
  const assigned = assignedHelpers(helpers, options.mode === 'location' ? 'location' : 'category');
  const paused = pausedAt(loadCountPause(), groupsFor);
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
    <div class="cbody">
      {helper ? (
        <HelperStart groups={groupLabels(helper.kit)} kind={helper.kit.kind} items={mine.length} unsent={helper.unsent} saved={helper.saved} allowNew={helper.kit.allowNewItems} />
      ) : (
        <>
      <div class="card ctotal">
        <Icon name="order" class="ic xl" />
        <div class="grow">
          <div class="ctotal-h">Order list right now: {formatCents(orderTotalCents(snap.items, onOrder))}</div>
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
            onClick={props.startScan}
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
                <strong>{g.name}</strong> <span class="small muted">{plural(g.items.length, 'item')}</span>{g.due > 0 && (
                  <>
                    {' '}
                    <span class="chip stale cg-due">{g.due} due for a recount</span>
                  </>
                )}
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
  );
}

/** The helper's start card (§18.3, §18.4): its groups, Add item not on the list, the send reminder. */
function HelperStart(props: { groups: readonly string[]; kind: 'category' | 'location'; items: number; unsent: number; saved: boolean; allowNew: boolean }) {
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
      {props.unsent === 0 && props.saved && (
        <div class="banner hremind" role="status">
          <Icon name="upload" />
          <span class="grow">Your counts file is saved in Downloads. The shop tablet doesn’t have it yet.</span>
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

