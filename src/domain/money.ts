// Prices are stored and summed as integer cents so totals are exact (spec-questions Q6).

export type PriceParse =
  | { ok: true; cents: number | null }
  | { ok: false; error: string };

/**
 * Parses a price as typed or found in a CSV. Blank → no price (null).
 * Accepts an optional leading "$" and thousands commas (spreadsheet formatting);
 * rejects negatives and more than 2 decimal places.
 */
export function parsePrice(raw: string): PriceParse {
  const s = raw.trim().replace(/^\$/, '').replace(/,(?=\d{3}(\D|$))/g, '');
  if (s === '') return { ok: true, cents: null };
  const m = /^(\d+)(?:\.(\d{0,2}))?$/.exec(s);
  if (!m) {
    if (/^\d*\.\d{3,}$/.test(s)) return { ok: false, error: `price "${raw.trim()}" has more than 2 decimal places` };
    return { ok: false, error: `price "${raw.trim()}" is not a dollar amount` };
  }
  const dollars = Number(m[1]);
  const frac = (m[2] ?? '').padEnd(2, '0');
  return { ok: true, cents: dollars * 100 + Number(frac) };
}

/** "8413.66" — plain form for CSV files. */
export function centsToPlain(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** "$8,413.66" — display form. */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100).toLocaleString('en-US');
  return `${sign}$${dollars}.${String(abs % 100).padStart(2, '0')}`;
}
