// Calendar dates as stored (YYYY-MM-DD, the tablet's local day) and as shown.

/** Today's date on this tablet, YYYY-MM-DD. */
export function localIsoDate(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

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
