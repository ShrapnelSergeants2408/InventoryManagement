// Holiday › Season (SPEC v3.0 §10, F23, H3 mockup 2): every season on now (§4), led by the one
// needing action soonest, each with its next step (Start setup, the setup list), then "Also now",
// "Coming up" and Add to Calendar. The takedown list arrives with H6.
import { useMemo } from 'preact/hooks';
import { indexPlaces, itemSeasonId } from '../../../domain/places';
import { currentRun, setupList } from '../../../domain/holiday';
import { seasonCalendar, shortDate, windowText, type SeasonNow } from '../../../domain/seasons';
import type { InventorySnapshot } from '../../../data/inventory';
import type { Season } from '../../../domain/types';
import { plural } from '../../components/common';
import { PartSwitch } from '../../components/PartSwitch';
import { useDb, usePartSnapshot, useNow } from '../../data-hooks';
import { Icon } from '../../icons';
import { href } from '../../shell/router';
import { BackupBanner } from '../../shell/BackupBanner';
import { showToast } from '../../shell/toast';
import { StorageError } from '../StorageError';
import { SeasonChip } from '../../components/chips';
import { addToCalendar } from '../holiday/calendar';
import { beginSetup, runText } from '../holiday/Season';

const LONG = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
const fail = (e: unknown) => showToast(e instanceof Error ? e.message : String(e));

function counts(snap: InventorySnapshot, s: Season): string {
  const ix = indexPlaces(snap);
  const bins = snap.bins.filter((b) => b.seasonId === s.id).length;
  const items = snap.items.filter((i) => itemSeasonId(i, ix) === s.id).length;
  return `${plural(bins, 'bin')}, ${plural(items, 'item')}`;
}

/** The headline for a season on now (§4): its run's phase when started, else setup today or its takedown date. */
function headline(n: SeasonNow, snap: InventorySnapshot, today: Date): string {
  const run = currentRun(n.season, snap.seasonRuns, today);
  if (run && run.phase !== 'planned') {
    if (run.phase === 'up' && n.daysLeft < 0) return `Up · take down was due ${shortDate(n.window.end)}`;
    return runText(n.season, run, setupList(snap, n.season.id, run).count.all, today);
  }
  if (n.startsToday) return 'Setup starts today';
  if (n.daysLeft === 0) return 'Take down today';
  return `Take down by ${shortDate(n.window.end)}`;
}

/** The season's next step as a button (§10): Start setup, or its setup list. */
function NextStep({ season, snap, today, big }: { season: Season; snap: InventorySnapshot; today: Date; big?: boolean }) {
  const db = useDb();
  const run = currentRun(season, snap.seasonRuns, today);
  const cls = big ? 'btn pri lg' : 'btn';
  if (run && run.phase === 'setting up')
    return (
      <a class={cls} href={href.setup(season.id)}>
        {big && <Icon name="lists" />}
        Setup list
      </a>
    );
  if (run && run.phase !== 'planned')
    return (
      <a class={big ? 'btn lg' : 'btn'} href={href.season(season.id)}>
        Open
      </a>
    );
  return (
    <button type="button" class={cls} onClick={() => void beginSetup(db, season, snap.seasonRuns, today).catch(fail)}>
      {big && <Icon name="arrowOut" />}
      Start setup
    </button>
  );
}

export function SeasonHomeScreen() {
  const { live, snap } = usePartSnapshot('holiday');
  // Re-read at least hourly, so a phone left open rolls over at midnight.
  const now = useNow(3_600_000);
  const today = new Date(now);
  const cal = useMemo(() => (snap ? seasonCalendar(snap.seasons, today, 3, snap.seasonRuns) : null), [snap, today.toDateString()]);

  const head = (
    <header class="phead top">
      <PartSwitch part="holiday" />
    </header>
  );
  if (live.state === 'error') {
    return (
      <>
        {head}
        <StorageError error={live.error} />
      </>
    );
  }
  if (!snap || !cal) {
    return (
      <>
        {head}
        <p class="fnote" aria-busy="true">
          Loading…
        </p>
      </>
    );
  }
  const lead = cal.lead;
  return (
    <>
      {head}
      <BackupBanner />
      <div class="hbody">
        <p class="hlbl">{LONG.format(today)}</p>
        {lead ? (
          <section class="hcard" aria-label={lead.season.name}>
            <span>
              <SeasonChip season={lead.season} />
            </span>
            <h2 class="hd">{headline(lead, snap, today)}</h2>
            <p class="m0 muted">
              {windowText(lead.season)} · {counts(snap, lead.season)}
            </p>
            <NextStep season={lead.season} snap={snap} today={today} big />
            <a class="btn" href={href.season(lead.season.id)}>
              {lead.season.name}: tasks, photos, bins
            </a>
          </section>
        ) : (
          <section class="hcard" aria-label="No season on now">
            <h2 class="hd">No season on now</h2>
            <p class="m0 muted">{cal.comingUp[0] ? `Next: ${cal.comingUp[0].season.name}, from ${shortDate(cal.comingUp[0].window.start)}.` : 'Add seasons and their dates in More › Seasons.'}</p>
          </section>
        )}
        {cal.alsoNow.length > 0 && (
          <section class="hcard" aria-label="Also now" style={{ gap: '4px', padding: '8px 16px' }}>
            <p class="hlbl" style={{ paddingTop: '8px' }}>
              Also now
            </p>
            {cal.alsoNow.map((n) => (
              <div class="hmini" key={n.season.id}>
                <span class={`dot c-${n.season.color}`} />
                <a class="t" href={href.season(n.season.id)} style={{ color: 'inherit', textDecoration: 'none' }}>
                  <strong>{n.season.name}</strong>
                  <span>{headline(n, snap, today)}</span>
                </a>
                <NextStep season={n.season} snap={snap} today={today} />
              </div>
            ))}
          </section>
        )}
        {cal.comingUp.length > 0 && (
          <section aria-label="Coming up">
            <p class="hlbl" style={{ paddingBottom: '4px' }}>
              Coming up
            </p>
            {cal.comingUp.map((c) => (
              <a class="hup" key={c.season.id} href={href.season(c.season.id)} style={{ color: 'inherit', textDecoration: 'none' }}>
                <span class={`dot c-${c.season.color}`} />
                <span class="grow" style={{ fontSize: '17px', fontWeight: 700 }}>
                  {c.season.name}
                </span>
                <span class="muted">{shortDate(c.window.start)}</span>
                <Icon name="chevRight" />
              </a>
            ))}
          </section>
        )}
        {snap.seasons.length > 0 && cal.lead === null && cal.comingUp.length === 0 && <p class="fnote">No season has dates yet. Add them in More › Seasons.</p>}
        {snap.seasons.some((s) => s.setupFrom) && (
          <button type="button" class="btn" onClick={() => void addToCalendar(snap.seasons)}>
            <Icon name="calendar" />
            Add the season dates to Calendar
          </button>
        )}
      </div>
    </>
  );
}
