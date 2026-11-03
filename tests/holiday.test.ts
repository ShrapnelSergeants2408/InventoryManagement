// The Holiday setup (SPEC v3.0 §3 Season run, §4, F25, F23): runs, the setup list, the season
// calendar with runs underway, and the .ics calendar file.
import { describe, expect, it } from 'vitest';
import { currentRun, nextStep, runYear, setupList } from '../src/domain/holiday';
import { CALENDAR_FILE_NAME, foldLine, icsText, seasonCalendarFile } from '../src/domain/ics';
import { seasonCalendar } from '../src/domain/seasons';
import type { Display, SeasonRun, SeasonTask } from '../src/domain/types';
import { area, bin, household, item, season, spot } from './helpers';

const day = (m: number, d: number, y = 2026) => new Date(y, m - 1, d, 15, 30);
const run = (over: Partial<SeasonRun> = {}): SeasonRun => ({ id: 'sr-1', seasonId: 'se-xmas', year: 2026, setupFrom: '', takedownBy: '', phase: 'setting up', doneTaskIds: [], startedAt: 1, finishedAt: null, ...over });
const xmas = season({ id: 'se-xmas', name: 'Christmas', setupFrom: '11-25', takedownBy: '01-06' });

describe('which run a season is on (§3: the year its setup starts)', () => {
  it('the window containing today, else the next one', () => {
    expect(runYear(xmas, [], day(11, 30))).toBe(2026);
    // Jan 2, 2027 is still in the window that started Nov 25, 2026.
    expect(runYear(xmas, [], day(1, 2, 2027))).toBe(2026);
    // Before the window: the coming one, so Start setup on Nov 20 is this year's run.
    expect(runYear(xmas, [], day(11, 20))).toBe(2026);
    // After takedown, the next year's.
    expect(runYear(xmas, [], day(2, 1, 2027))).toBe(2027);
  });
  it('a run still underway keeps its year after the window ends', () => {
    const late = run({ phase: 'up' });
    expect(runYear(xmas, [late], day(1, 10, 2027))).toBe(2026);
    expect(currentRun(xmas, [late], day(1, 10, 2027))).toBe(late);
    expect(currentRun(xmas, [run({ phase: 'done' })], day(2, 1, 2027))).toBeNull();
  });
  it('a season without dates runs in the calendar year', () => {
    expect(runYear(season({ id: 'se-x', setupFrom: '', takedownBy: '' }), [], day(5, 5))).toBe(2026);
  });
  it('the next step for each phase', () => {
    expect([null, run({ phase: 'planned' }), run(), run({ phase: 'up' }), run({ phase: 'taking down' }), run({ phase: 'done' })].map(nextStep)).toEqual([
      'start setup',
      'start setup',
      'setup list',
      'take down',
      'take down',
      'done',
    ]);
  });
});

describe('the setup list (F25)', () => {
  const h = household();
  const displays: Display[] = [
    { id: 'dp-porch', name: 'Front porch', order: 1, notes: '' },
    { id: 'dp-mantel', name: 'Mantel', order: 0, notes: '' },
  ];
  const seasonTasks: SeasonTask[] = [
    { id: 'tk-2', seasonId: 'se-xmas', phase: 'setup', text: 'Get the ladder', order: 1 },
    { id: 'tk-1', seasonId: 'se-xmas', phase: 'setup', text: 'Test the lights', order: 0 },
    { id: 'tk-3', seasonId: 'se-xmas', phase: 'takedown', text: 'Recycle the tree', order: 0 },
    { id: 'tk-4', seasonId: 'se-hall', phase: 'setup', text: 'Carve pumpkins', order: 0 },
  ];
  const bins = [
    ...h.bins,
    bin({ id: 'bn-xmas1', code: 'A-01', name: 'Christmas 1', spotId: 'sp-shelfA', seasonId: 'se-xmas', state: 'out' }),
    bin({ id: 'bn-xmas9', code: 'A-09', name: 'Christmas 9', spotId: '', seasonId: 'se-xmas' }),
    bin({ id: 'bn-hall', code: 'A-02', name: 'Halloween', spotId: 'sp-shelfA', seasonId: 'se-hall' }),
  ];
  const items = [
    // In a Christmas bin, no season of its own: follows its bin.
    item({ id: 'it-garland', name: 'Garland', binId: 'bn-xmas4', displayId: 'dp-mantel', status: 'out', outDisplayId: 'dp-mantel', outWhere: 'Mantel' }),
    item({ id: 'it-nativity', name: 'Nativity set', binId: 'bn-xmas4', displayId: 'dp-mantel' }),
    item({ id: 'it-wreath', name: 'Wreath', binId: 'bn-xmas1', displayId: 'dp-porch' }),
    // Its own season, on a spot.
    item({ id: 'it-tree', name: 'Tree stand', spotId: 'sp-peg', seasonId: 'se-xmas' }),
    // A display that was removed: "No display".
    item({ id: 'it-odd', name: 'Angel', seasonId: 'se-xmas', displayId: 'dp-gone' }),
    // Halloween, or no season: not on the list.
    item({ id: 'it-skull', name: 'Skull', binId: 'bn-hall', displayId: 'dp-porch' }),
    item({ id: 'it-plain', name: 'Plain', binId: 'bn-spare' }),
  ];
  const d = { ...h, bins, items, displays, seasonTasks };

  it('bins of the season in walk order (area, spot, code; no spot last), done when out', () => {
    const l = setupList(d, 'se-xmas', null);
    expect(l.bins.map((b) => [b.bin.code, b.where, b.done])).toEqual([
      ['A-01', 'Attic › Shelf A', true],
      ['A-04', 'Attic › Shelf B', false],
      ['A-09', 'No spot', false],
    ]);
  });
  it('items by display in walk order, then “No display”; done when out', () => {
    const l = setupList(d, 'se-xmas', null);
    expect(l.groups.map((g) => [g.display?.name ?? 'No display', g.items.map((i) => [i.item.name, i.home, i.done]), g.count])).toEqual([
      ['Mantel', [['Garland', 'A-04 Christmas 4', true], ['Nativity set', 'A-04 Christmas 4', false]], { done: 1, total: 2 }],
      ['Front porch', [['Wreath', 'A-01 Christmas 1', false]], { done: 0, total: 1 }],
      ['No display', [['Angel', 'No home yet', false], ['Tree stand', 'Pegboard', false]], { done: 0, total: 2 }],
    ]);
  });
  it('setup tasks of the season in order, ticked from the run; progress over all three', () => {
    const l = setupList(d, 'se-xmas', run({ doneTaskIds: ['tk-2', 'tk-3'] }));
    expect(l.tasks.map((t) => [t.task.text, t.done])).toEqual([
      ['Test the lights', false],
      ['Get the ladder', true],
    ]);
    expect(l.count).toEqual({ bins: { done: 1, total: 3 }, items: { done: 1, total: 5 }, tasks: { done: 1, total: 2 }, all: { done: 3, total: 10 } });
  });
  it('a season with nothing yet has an empty list', () => {
    const l = setupList({ ...d, areas: [area()], spots: [spot()] }, 'se-none', null);
    expect(l.count.all).toEqual({ done: 0, total: 0 });
    expect(l.groups).toEqual([]);
  });
});

describe('the Holiday home with runs (§4)', () => {
  const thanks = season({ id: 'se-thanks', name: 'Thanksgiving', order: 0, setupFrom: '11-01', takedownBy: '11-30' });
  const easter = season({ id: 'se-easter', name: 'Easter', order: 2, setupFrom: '03-20', takedownBy: '04-30' });
  it('a setup started before its window counts as on now, and leads', () => {
    const c = seasonCalendar([thanks, xmas, easter], day(11, 20), 3, [run({ year: 2026, phase: 'setting up' })]);
    expect(c.lead?.season.name).toBe('Christmas');
    expect(c.lead?.run?.phase).toBe('setting up');
    expect(c.alsoNow.map((n) => n.season.name)).toEqual(['Thanksgiving']);
  });
  it('a season that is up waits for its date: the nearest takedown leads', () => {
    const c = seasonCalendar([thanks, xmas], day(11, 27), 3, [run({ phase: 'up' })]);
    expect(c.lead?.season.name).toBe('Thanksgiving');
    expect(c.alsoNow[0]?.run?.phase).toBe('up');
  });
  it('a season still up after its takedown date stays on, overdue, and leads', () => {
    const c = seasonCalendar([xmas, easter], day(1, 10, 2027), 3, [run({ phase: 'up' })]);
    expect(c.lead?.season.name).toBe('Christmas');
    expect(c.lead!.daysLeft).toBeLessThan(0);
  });
  it('a finished run is just its window again', () => {
    expect(seasonCalendar([xmas], day(2, 1, 2027), 3, [run({ phase: 'done' })]).lead).toBeNull();
  });
});

describe('the season calendar file (F23)', () => {
  const ics = seasonCalendarFile(
    [xmas, season({ id: 'se-hall', name: 'Halloween, spooky', order: 1, setupFrom: '10-01', takedownBy: '11-05' }), season({ id: 'se-none', name: 'No dates', setupFrom: '', takedownBy: '' }), season({ id: 'se-leap', name: 'Leap', setupFrom: '02-29', takedownBy: '03-02' })],
    new Date(Date.UTC(2026, 10, 3, 18, 5, 9)),
  );
  const lines = ics.split('\r\n');
  it('is a calendar of yearly all-day events, CRLF line ends', () => {
    expect(lines[0]).toBe('BEGIN:VCALENDAR');
    expect(lines.at(-2)).toBe('END:VCALENDAR');
    expect(ics.endsWith('\r\n')).toBe(true);
    expect(ics.includes('\n') && !/[^\r]\n/.test(ics)).toBe(true);
    expect(lines.filter((l) => l === 'BEGIN:VEVENT')).toHaveLength(6);
    expect(lines.filter((l) => l === 'RRULE:FREQ=YEARLY')).toHaveLength(6);
    expect(CALENDAR_FILE_NAME).toBe('holiday-seasons.ics');
  });
  it('setup and takedown dates; a takedown before the setup date is in the next year', () => {
    expect(ics).toContain('UID:se-xmas-setup@hiebert-home-inventory\r\nDTSTAMP:20261103T180509Z\r\nDTSTART;VALUE=DATE:20261125\r\nDTEND;VALUE=DATE:20261126');
    expect(ics).toContain('DTSTART;VALUE=DATE:20270106\r\nDTEND;VALUE=DATE:20270107');
    expect(ics).toContain('SUMMARY:Christmas: set up');
    expect(ics).toContain('SUMMARY:Christmas: take down');
    // Escaped comma.
    expect(ics).toContain('SUMMARY:Halloween\\, spooky: set up');
  });
  it('seasons without dates are left out; Feb 29 becomes Feb 28 so it happens every year', () => {
    expect(ics).not.toContain('No dates');
    expect(ics).toContain('DTSTART;VALUE=DATE:20260228\r\nDTEND;VALUE=DATE:20260301');
  });
  it('each event has a 9 AM reminder', () => {
    expect(lines.filter((l) => l === 'TRIGGER;RELATED=START:PT9H')).toHaveLength(6);
  });
  it('text is escaped and long lines are folded at 75 octets without splitting a character', () => {
    expect(icsText('a;b,c\\d\ne')).toBe('a\\;b\\,c\\\\d\\ne');
    const long = 'DESCRIPTION:' + '🎄'.repeat(40);
    const folded = foldLine(long);
    const parts = folded.split('\r\n');
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(new TextEncoder().encode(p).length).toBeLessThanOrEqual(75);
    expect(parts.slice(1).every((p) => p.startsWith(' '))).toBe(true);
    expect(parts.map((p, i) => (i === 0 ? p : p.slice(1))).join('')).toBe(long);
  });
});
