// Calendar dates as stored (YYYY-MM-DD, the tablet's local day) and as shown, and count
// times (last_counted, §3): the device's local date and time with its UTC offset.

const p2 = (n: number) => String(n).padStart(2, '0');

/** Today's date on this tablet, YYYY-MM-DD. */
export function localIsoDate(d: Date = new Date()): string {
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}

/** 2026-10-24T18:42:07-05:00: local date and time with this device's UTC offset at that moment (§3; never UTC "Z"). */
export function localIsoDateTime(d: Date): string {
  const off = -d.getTimezoneOffset();
  const a = Math.abs(off);
  return `${localIsoDate(d)}T${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}${off < 0 ? '-' : '+'}${p2(Math.floor(a / 60))}:${p2(a % 60)}`;
}

/** The time a count is saved (count-in, adding an item): now, as a local date-time with offset. */
export const nowLocalIso = (): string => localIsoDateTime(new Date());

/** A date-only last_counted (v0.4–v0.7 files and databases) as midnight local time that day, with that day's offset (§7, §18.7). */
export function midnightLocalIso(date: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return localIsoDateTime(new Date(y, m - 1, d));
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const STAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?([+-](\d{2}):(\d{2})|Z)$/;

const realDate = (y: number, m: number, d: number) => {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
};

/** A stored last_counted: a date-time with its UTC offset, or a date only (older data). Not '' and not "Z". */
export function isCountStamp(s: string): boolean {
  const d = DATE_ONLY.exec(s);
  if (d) return realDate(Number(d[1]), Number(d[2]), Number(d[3]));
  const m = STAMP.exec(s);
  if (!m || m[7] === 'Z') return false;
  const [h, mi, sec, oh, om] = [m[4], m[5], m[6] ?? '0', m[8], m[9]].map(Number) as [number, number, number, number, number];
  return realDate(Number(m[1]), Number(m[2]), Number(m[3])) && h < 24 && mi < 60 && sec < 60 && oh <= 14 && om < 60;
}

/** ISO-like date-times as spreadsheets re-save them: a space for the T, fractions of a second, an offset without its colon, or no offset. */
const LOOSE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(Z|([+-])(\d{2}):?(\d{2}))?$/i;
/** A US spreadsheet date-time: 10/24/2026 18:42, 10/24/2026 6:42 PM. */
const US_TIME = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i;

/** A local wall-clock time on this device, as a stamp; null when a part is out of range. */
function localStamp(y: number, mo: number, d: number, h: number, mi: number, sec: number): string | null {
  if (!realDate(y, mo, d) || h > 23 || mi > 59 || sec > 59) return null;
  return localIsoDateTime(new Date(y, mo - 1, d, h, mi, sec));
}

/**
 * last_counted as read from a file (§7): '' stays blank; a date-time with an offset is kept as
 * written (it's the counting device's own local time), tidied to the stored form when a
 * spreadsheet re-saved it; a date only becomes local midnight; a UTC "Z" time becomes this
 * device's local time; a date-time without an offset (a spreadsheet's) is read as this
 * device's local time. null when it's none of these.
 */
export function readCountStamp(raw: string): string | null {
  const s = raw.trim();
  if (s === '') return '';
  if (DATE_ONLY.test(s)) return isCountStamp(s) ? midnightLocalIso(s) : null;
  if (isCountStamp(s)) return s;
  const m = LOOSE.exec(s);
  if (m) {
    const [y, mo, d, h, mi, sec] = [m[1], m[2], m[3], m[4], m[5], m[6] ?? '0'].map(Number) as [number, number, number, number, number, number];
    if (!realDate(y, mo, d) || h > 23 || mi > 59 || sec > 59) return null;
    if (m[7] === undefined) return localStamp(y, mo, d, h, mi, sec);
    if (m[7].toUpperCase() === 'Z') return localIsoDateTime(new Date(Date.UTC(y, mo - 1, d, h, mi, sec)));
    const tidy = `${m[1]}-${m[2]}-${m[3]}T${p2(h)}:${m[5]}:${p2(sec)}${m[8]}${m[9]}:${m[10]}`;
    return isCountStamp(tidy) ? tidy : null;
  }
  const u = US_TIME.exec(s);
  if (u) {
    let h = Number(u[4]);
    if (u[7]) {
      if (h < 1 || h > 12) return null;
      h = (h % 12) + (u[7].toUpperCase() === 'PM' ? 12 : 0);
    }
    return localStamp(Number(u[3]), Number(u[1]), Number(u[2]), h, Number(u[5]), Number(u[6] ?? '0'));
  }
  return null;
}

/**
 * The local date of a count (YYYY-MM-DD): the date as written, which is the counting device's
 * own calendar day. Count rounds compare it with "counting since" (F24). '' for blank.
 */
export const countedDate = (stamp: string): string => (isCountStamp(stamp) ? stamp.slice(0, 10) : '');

/** "Oct 17, 2026"; '' for a blank date. */
export function formatIsoDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const time = (d: Date) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

/** "today 12:31 PM", "yesterday 9:05 AM" or "Oct 10, 2026 3:35 PM" (restore comparison, F17). */
export function formatDateTime(at: Date, now: Date = new Date()): string {
  const day = localIsoDate(at);
  if (day === localIsoDate(now)) return `today ${time(at)}`;
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  if (day === localIsoDate(y)) return `yesterday ${time(at)}`;
  return `${formatIsoDate(day)} ${time(at)}`;
}

/** "40 KB", "5.6 MB" (backup sizes). */
export function formatBytes(n: number): string {
  if (n < 1000) return `${n} bytes`;
  if (n < 1_000_000) return `${Math.round(n / 1000)} KB`;
  return `${(n / 1_000_000).toFixed(1)} MB`;
}
