// Season dates and "Seasons on now" (SPEC v3.0 §3 Season, §4, F23).
import { describe, expect, it } from 'vitest';
import { DEFAULT_SEASONS } from '../src/domain/places';
import { defaultDates, isMonthDay, nextWindow, seasonCalendar, shortDate, tidyMonthDay, windowNow, windowText } from '../src/domain/seasons';
import type { Season } from '../src/domain/types';
import { season } from './helpers';

/** The default seasons with their default dates, as a fresh phone has them. */
const defaults: Season[] = DEFAULT_SEASONS.map((s, order) => season({ id: `se-${order}`, name: s.name, color: s.color, order, ...defaultDates(s.name) }));
const day = (m: number, d: number, y = 2026) => new Date(y, m - 1, d, 15, 30);
const names = (l: readonly { season: Season }[]) => l.map((x) => x.season.name);

describe('month-day dates', () => {
  it('MM-DD that exists (Feb 29 allowed)', () => {
    expect(['11-25', '01-06', '02-29', '12-31'].every(isMonthDay)).toBe(true);
    expect(['13-01', '02-30', '1-6', '', '11/25', '04-31'].some(isMonthDay)).toBe(false);
  });
  it('typed dates are tidied: 11/25, 1-6, Nov 25, november 5', () => {
    expect(['11/25', '1-6', 'Nov 25', 'november 5', ' 12.28 '].map(tidyMonthDay)).toEqual(['11-25', '01-06', '11-25', '11-05', '12-28']);
    expect(tidyMonthDay('soon')).toBe('soon');
  });
  it('every default season has its default dates (§3)', () => {
    expect(defaults.map((s) => [s.name, s.setupFrom, s.takedownBy])).toEqual([
      ['Valentine’s', '02-01', '02-20'],
      ['St. Patrick’s', '03-10', '03-20'],
      ['Easter', '03-20', '04-30'],
      ['4th of July', '06-25', '07-10'],
      ['Fall', '09-15', '11-30'],
      ['Halloween', '10-01', '11-05'],
      ['Thanksgiving', '11-01', '11-30'],
      ['Christmas', '11-25', '01-06'],
      ['Winter', '12-01', '02-28'],
      ['New Year’s', '12-28', '01-03'],
    ]);
    expect(defaultDates("Valentine's")).toEqual({ setupFrom: '02-01', takedownBy: '02-20' });
    expect(defaultDates('Grandma visits')).toEqual({ setupFrom: '', takedownBy: '' });
  });
  it('short text', () => {
    expect(windowText(season({ setupFrom: '11-25', takedownBy: '01-06' }))).toBe('Nov 25 – Jan 6');
    expect(windowText(season({ setupFrom: '', takedownBy: '' }))).toBe('');
    expect(shortDate(day(12, 1))).toBe('Dec 1');
  });
});

describe('windows wrap over New Year', () => {
  const xmas = season({ setupFrom: '11-25', takedownBy: '01-06' });
  it('Christmas is on from Nov 25 to Jan 6, both days included', () => {
    expect(windowNow(xmas, day(11, 24))).toBeNull();
    expect(windowNow(xmas, day(11, 25))).toEqual({ start: new Date(2026, 10, 25), end: new Date(2027, 0, 6) });
    expect(windowNow(xmas, day(1, 6, 2027))).toEqual({ start: new Date(2026, 10, 25), end: new Date(2027, 0, 6) });
    expect(windowNow(xmas, day(1, 7, 2027))).toBeNull();
  });
  it('the next window starts after today', () => {
    expect(nextWindow(xmas, day(11, 3))!.start).toEqual(new Date(2026, 10, 25));
    expect(nextWindow(xmas, day(12, 1))!.start).toEqual(new Date(2027, 10, 25));
    expect(nextWindow(season({ setupFrom: '', takedownBy: '' }), day(1, 1))).toBeNull();
  });
});

describe('the Holiday home (§4, H3 mockup 2)', () => {
  it('Nov 25: Christmas leads (setup starts today); Thanksgiving and Fall also now; then Winter, New Year’s, Valentine’s', () => {
    const c = seasonCalendar(defaults, day(11, 25));
    expect(c.lead!.season.name).toBe('Christmas');
    expect(c.lead!.startsToday).toBe(true);
    expect(names(c.alsoNow)).toEqual(['Fall', 'Thanksgiving']);
    expect(c.alsoNow.map((n) => n.daysLeft)).toEqual([5, 5]);
    expect(names(c.comingUp)).toEqual(['Winter', 'New Year’s', 'Valentine’s']);
  });
  it('Nov 3 (today): nothing starts today, so the nearest takedown leads (Halloween, Nov 5)', () => {
    const c = seasonCalendar(defaults, day(11, 3));
    expect(c.lead!.season.name).toBe('Halloween');
    expect(c.lead!.daysLeft).toBe(2);
    expect(names(c.alsoNow)).toEqual(['Fall', 'Thanksgiving']);
    expect(names(c.comingUp)).toEqual(['Christmas', 'Winter', 'New Year’s']);
  });
  it('Jan 2: Christmas, New Year’s and Winter are on (wrapping windows)', () => {
    const c = seasonCalendar(defaults, day(1, 2, 2027));
    expect(c.lead!.season.name).toBe('New Year’s');
    expect(names(c.alsoNow)).toEqual(['Christmas', 'Winter']);
    expect(names(c.comingUp)[0]).toBe('Valentine’s');
  });
  it('a quiet day: no lead, the next three coming up; seasons without dates are left out', () => {
    const c = seasonCalendar([...defaults, season({ id: 'se-x', name: 'No dates', setupFrom: '', takedownBy: '' })], day(5, 15));
    expect(c.lead).toBeNull();
    expect(c.alsoNow).toEqual([]);
    expect(names(c.comingUp)).toEqual(['4th of July', 'Fall', 'Halloween']);
  });
});
