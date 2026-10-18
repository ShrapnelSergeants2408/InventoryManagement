// Product-page and supplier links (F11, F23). Only http(s) links are stored or opened, so an
// imported "javascript:" value can never run when tapped.

export type UrlParse = { ok: true; url: string } | { ok: false; error: string };

/** Blank stays blank; "www.revrobotics.com/…" gets https:// in front; other schemes are rejected. */
export function normalizeUrl(raw: string, label: string): UrlParse {
  const s = raw.trim();
  if (s === '') return { ok: true, url: '' };
  if (/\s/.test(s)) return { ok: false, error: `${label} can't contain spaces` };
  if (/^https?:\/\/[^/]+/i.test(s)) return { ok: true, url: s };
  // A scheme is letters before the first ":" with no dot, e.g. "javascript:" (not "rev.com:8080").
  if (/^[a-z][a-z0-9+-]*:/i.test(s)) return { ok: false, error: `${label} must start with https://` };
  if (/^[^/.:]+(\.[^/.:]+)+(:\d+)?(\/.*)?$/.test(s)) return { ok: true, url: `https://${s}` };
  return { ok: false, error: `${label} “${s}” doesn't look like a web address` };
}

/** The link to put in an href, or undefined when it isn't http(s). */
export function safeHref(url: string): string | undefined {
  return /^https?:\/\/[^/]+/i.test(url.trim()) ? url.trim() : undefined;
}
