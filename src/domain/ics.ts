// The season calendar file (SPEC v3.0 F23): each season's setup and takedown dates as yearly
// all-day events, for the iPhone's Calendar to remind about (in-app reminders are out of scope,
// §13). Pure, so it is unit-tested. RFC 5545: CRLF line ends, lines folded at 75 octets.
import { isMonthDay } from './seasons';
import type { Season } from './types';

const p2 = (n: number) => String(n).padStart(2, '0');

/** Escapes TEXT values (RFC 5545 §3.3.11). */
export const icsText = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** Folds a content line at 75 octets (UTF-8), continuing with a space, without splitting a character. */
export function foldLine(line: string): string {
  const enc = new TextEncoder();
  const out: string[] = [];
  let cur = '';
  let size = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (size + n > (out.length === 0 ? 75 : 74)) {
      out.push(cur);
      cur = '';
      size = 0;
    }
    cur += ch;
    size += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}

/** "YYYYMMDD" of a month-day in `year`. Feb 29 becomes Feb 28, so the yearly event happens every year. */
function dateValue(year: number, monthDay: string): string {
  const md = monthDay === '02-29' ? '02-28' : monthDay;
  return `${year}${md.replace('-', '')}`;
}

function nextDay(value: string): string {
  const d = new Date(Number(value.slice(0, 4)), Number(value.slice(4, 6)) - 1, Number(value.slice(6, 8)) + 1);
  return `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}`;
}

const stamp = (now: Date) =>
  `${now.getUTCFullYear()}${p2(now.getUTCMonth() + 1)}${p2(now.getUTCDate())}T${p2(now.getUTCHours())}${p2(now.getUTCMinutes())}${p2(now.getUTCSeconds())}Z`;

/**
 * The calendar: for every season with dates, "<Season>: set up" on its setup date and
 * "<Season>: take down" on its takedown date, all day, every year from `now`'s year, each with
 * a reminder at 9 AM that day. Uids are stable per season, so importing the file again updates
 * the events instead of adding copies (where Calendar honors that).
 */
export function seasonCalendarFile(seasons: readonly Season[], now: Date): string {
  const year = now.getFullYear();
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Hiebert Home Inventory//Holiday seasons//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Holiday seasons'];
  for (const s of [...seasons].sort((a, b) => a.order - b.order)) {
    if (!isMonthDay(s.setupFrom) || !isMonthDay(s.takedownBy)) continue;
    // A takedown date before the setup date falls in the next year (Christmas: Nov 25 → Jan 6).
    const takedownYear = s.takedownBy < s.setupFrom ? year + 1 : year;
    for (const [what, label, start] of [
      ['setup', 'set up', dateValue(year, s.setupFrom)],
      ['takedown', 'take down', dateValue(takedownYear, s.takedownBy)],
    ] as const) {
      lines.push(
        'BEGIN:VEVENT',
        `UID:${s.id}-${what}@hiebert-home-inventory`,
        `DTSTAMP:${stamp(now)}`,
        `DTSTART;VALUE=DATE:${start}`,
        `DTEND;VALUE=DATE:${nextDay(start)}`,
        'RRULE:FREQ=YEARLY',
        `SUMMARY:${icsText(`${s.name}: ${label}`)}`,
        `DESCRIPTION:${icsText(what === 'setup' ? `Setup for ${s.name} can start today. Open the Holiday part of the inventory for the setup list.` : `Take ${s.name} down by today.`)}`,
        'TRANSP:TRANSPARENT',
        'BEGIN:VALARM',
        'ACTION:DISPLAY',
        `DESCRIPTION:${icsText(`${s.name}: ${label}`)}`,
        'TRIGGER;RELATED=START:PT9H',
        'END:VALARM',
        'END:VEVENT',
      );
    }
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

export const CALENDAR_FILE_NAME = 'holiday-seasons.ics';
