// Season dates (SPEC v3.0 §3 Season, §4 "Seasons on now", F23): each season's window runs from
// setupFrom to takedownBy every year ("MM-DD"), wrapping over New Year. Pure, so it is unit-tested.
import type { Season } from './types';

/** Default windows (§3), by default season name. Dan adjusts them in More › Seasons. */
export const DEFAULT_SEASON_DATES: Readonly<Record<string, { setupFrom: string; takedownBy: string }>> = {
  'Valentine’s': { setupFrom: '02-01', takedownBy: '02-20' },
  'St. Patrick’s': { setupFrom: '03-10', takedownBy: '03-20' },
  Easter: { setupFrom: '03-20', takedownBy: '04-30' },
  '4th of July': { setupFrom: '06-25', takedownBy: '07-10' },
  Fall: { setupFrom: '09-15', takedownBy: '11-30' },
  Halloween: { setupFrom: '10-01', takedownBy: '11-05' },
  Thanksgiving: { setupFrom: '11-01', takedownBy: '11-30' },
  Christmas: { setupFrom: '11-25', takedownBy: '01-06' },
  Winter: { setupFrom: '12-01', takedownBy: '02-28' },
  'New Year’s': { setupFrom: '12-28', takedownBy: '01-03' },
};

/** A season's default dates by name (ignoring the apostrophe style), or blanks. */
export function defaultDates(name: string): { setupFrom: string; takedownBy: string } {
  const key = (s: string) => s.toLowerCase().replace(/['’]/g, '');
  const hit = Object.entries(DEFAULT_SEASON_DATES).find(([n]) => key(n) === key(name));
  return hit ? { ...hit[1] } : { setupFrom: '', takedownBy: '' };
}

const DAYS_IN = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** "MM-DD" that exists in a leap year (02-29 is allowed). */
export function isMonthDay(s: string): boolean {
  const m = /^(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const mo = Number(m[1]);
  const d = Number(m[2]);
  return mo >= 1 && mo <= 12 && d >= 1 && d <= DAYS_IN[mo - 1]!;
}

/** Tidies a typed month-day: "11/25", "11-5" and "nov 25" are "11-25" / "11-05"; anything else comes back trimmed. */
export function tidyMonthDay(raw: string): string {
  const s = raw.trim().toLowerCase();
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  let m = /^(\d{1,2})\s*[-/.]\s*(\d{1,2})$/.exec(s);
  if (m) return `${m[1]!.padStart(2, '0')}-${m[2]!.padStart(2, '0')}`;
  m = /^([a-z]{3})[a-z]*\.?\s*(\d{1,2})$/.exec(s);
  if (m && months.includes(m[1]!)) return `${String(months.indexOf(m[1]!) + 1).padStart(2, '0')}-${m[2]!.padStart(2, '0')}`;
  return raw.trim();
}

/** A local calendar date at midnight. */
const day = (y: number, monthDay: string) => {
  const [mo, d] = monthDay.split('-').map(Number) as [number, number];
  // 02-29 in a common year falls on 03-01, which is what a person means by "end of February".
  return new Date(y, mo - 1, d);
};
const midnight = (t: Date) => new Date(t.getFullYear(), t.getMonth(), t.getDate());
const DAY_MS = 86_400_000;
const daysBetween = (a: Date, b: Date) => Math.round((midnight(b).getTime() - midnight(a).getTime()) / DAY_MS);

export interface Window {
  start: Date;
  end: Date;
}

/** The window that starts in `year` (its end may be in the next year). Null without both dates. */
export function windowStarting(s: Pick<Season, 'setupFrom' | 'takedownBy'>, year: number): Window | null {
  if (!isMonthDay(s.setupFrom) || !isMonthDay(s.takedownBy)) return null;
  const start = day(year, s.setupFrom);
  let end = day(year, s.takedownBy);
  if (end < start) end = day(year + 1, s.takedownBy);
  return { start, end };
}

/** The window containing `today` (this year's, or last year's that wraps into this year), or null. */
export function windowNow(s: Pick<Season, 'setupFrom' | 'takedownBy'>, today: Date): Window | null {
  const t = midnight(today);
  for (const y of [t.getFullYear() - 1, t.getFullYear()]) {
    const w = windowStarting(s, y);
    if (w && w.start <= t && t <= w.end) return w;
  }
  return null;
}

/** The next window starting after `today`. */
export function nextWindow(s: Pick<Season, 'setupFrom' | 'takedownBy'>, today: Date): Window | null {
  const t = midnight(today);
  for (const y of [t.getFullYear(), t.getFullYear() + 1]) {
    const w = windowStarting(s, y);
    if (w && w.start > t) return w;
  }
  return null;
}

export interface SeasonNow {
  season: Season;
  window: Window;
  /** Setup starts today. */
  startsToday: boolean;
  /** Days until takedownBy (0 = today). */
  daysLeft: number;
}

export interface SeasonCalendar {
  /** The season needing action soonest (§4), or null when none is on. */
  lead: SeasonNow | null;
  /** The other seasons on now, soonest action first. */
  alsoNow: SeasonNow[];
  /** The next seasons to start, nearest first (up to 3). */
  comingUp: { season: Season; window: Window }[];
}

/**
 * The Holiday home (§4, F23): every season whose window contains today, led by the one needing
 * action soonest: a setup starting today first, then the nearest takedown date. Season runs
 * (setup underway, H4) will move a season into the lead the same way.
 */
export function seasonCalendar(seasons: readonly Season[], today: Date, comingUp = 3): SeasonCalendar {
  const on: SeasonNow[] = [];
  for (const season of seasons) {
    const window = windowNow(season, today);
    if (!window) continue;
    on.push({ season, window, startsToday: daysBetween(window.start, today) === 0, daysLeft: daysBetween(today, window.end) });
  }
  on.sort((a, b) => Number(b.startsToday) - Number(a.startsToday) || a.daysLeft - b.daysLeft || a.season.order - b.season.order);
  const onIds = new Set(on.map((n) => n.season.id));
  const next = seasons
    .filter((s) => !onIds.has(s.id))
    .flatMap((season) => {
      const window = nextWindow(season, today);
      return window ? [{ season, window }] : [];
    })
    .sort((a, b) => a.window.start.getTime() - b.window.start.getTime() || a.season.order - b.season.order)
    .slice(0, comingUp);
  return { lead: on[0] ?? null, alsoNow: on.slice(1), comingUp: next };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Nov 25" for a date or a "MM-DD". */
export function shortDate(d: Date | string): string {
  if (typeof d === 'string') {
    if (!isMonthDay(d)) return '';
    const [mo, dd] = d.split('-').map(Number) as [number, number];
    return `${MONTHS[mo - 1]} ${dd}`;
  }
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

/** "Nov 25 – Jan 6", or '' when the season has no dates. */
export function windowText(s: Pick<Season, 'setupFrom' | 'takedownBy'>): string {
  if (!isMonthDay(s.setupFrom) || !isMonthDay(s.takedownBy)) return '';
  return `${shortDate(s.setupFrom)} – ${shortDate(s.takedownBy)}`;
}
