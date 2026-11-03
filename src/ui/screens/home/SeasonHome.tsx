// Holiday › Season (SPEC v3.0 §10, F23, H3 mockup 2): every season on now (§4), led by the one
// needing action soonest, then "Also now" and "Coming up". The setup and takedown lists (Start
// setup, Take down) arrive with H4 and H6; until then each season opens its bins and items.
import { useMemo } from 'preact/hooks';
import { saveBrowseBy, saveFilters, loadFilters } from '../../../data/prefs';
import { indexPlaces, itemSeasonId } from '../../../domain/places';
import { seasonCalendar, shortDate, windowText, type SeasonNow } from '../../../domain/seasons';
import type { InventorySnapshot } from '../../../data/inventory';
import type { Season } from '../../../domain/types';
import { plural } from '../../components/common';
import { PartSwitch } from '../../components/PartSwitch';
import { usePartSnapshot, useNow } from '../../data-hooks';
import { href } from '../../shell/router';
import { BackupBanner } from '../../shell/BackupBanner';
import { StorageError } from '../StorageError';
import { SeasonChip } from '../../components/chips';

const LONG = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

/** Opens Browse by season, filtered to one season. */
function openSeason(seasonId: string) {
  saveBrowseBy('holiday', 'season');
  saveFilters('holiday', { ...loadFilters('holiday'), season: seasonId });
  location.hash = href.tab('holiday', 'browse');
}

function counts(snap: InventorySnapshot, s: Season): string {
  const ix = indexPlaces(snap);
  const bins = snap.bins.filter((b) => b.seasonId === s.id).length;
  const items = snap.items.filter((i) => itemSeasonId(i, ix) === s.id).length;
  return `${plural(bins, 'bin')}, ${plural(items, 'item')}`;
}

/** The headline for a season on now (§4): setup today, else its takedown date. */
function headline(n: SeasonNow): string {
  if (n.startsToday) return 'Setup starts today';
  if (n.daysLeft === 0) return 'Take down today';
  return `Take down by ${shortDate(n.window.end)}`;
}

export function SeasonHomeScreen() {
  const { live, snap } = usePartSnapshot('holiday');
  // Re-read at least hourly, so a phone left open rolls over at midnight.
  const now = useNow(3_600_000);
  const today = new Date(now);
  const cal = useMemo(() => (snap ? seasonCalendar(snap.seasons, today) : null), [snap, today.toDateString()]);

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
            <h2 class="hd">{headline(lead)}</h2>
            <p class="m0 muted">
              {windowText(lead.season)} · {counts(snap, lead.season)}
            </p>
            <button type="button" class="btn pri lg" onClick={() => openSeason(lead.season.id)}>
              Open {lead.season.name}
            </button>
            <p class="small muted m0">The setup and takedown lists come in the next update.</p>
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
                <div class="t">
                  <strong>{n.season.name}</strong>
                  <span>{headline(n)}</span>
                </div>
                <button type="button" class="btn" onClick={() => openSeason(n.season.id)}>
                  Open
                </button>
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
              <div class="hup" key={c.season.id}>
                <span class={`dot c-${c.season.color}`} />
                <span class="grow" style={{ fontSize: '17px', fontWeight: 700 }}>
                  {c.season.name}
                </span>
                <span class="muted">{shortDate(c.window.start)}</span>
              </div>
            ))}
          </section>
        )}
        {snap.seasons.length > 0 && cal.lead === null && cal.comingUp.length === 0 && <p class="fnote">No season has dates yet. Add them in More › Seasons.</p>}
      </div>
    </>
  );
}
