import { describe, expect, it } from 'vitest';
import { formatIsoDate, localIsoDate } from '../src/domain/dates';
import { normalizeUrl, safeHref } from '../src/domain/url';

describe('normalizeUrl (F11, F23)', () => {
  it('keeps http(s) links and blank', () => {
    expect(normalizeUrl(' https://www.revrobotics.com/rev-21-1653/ ', 'link')).toEqual({ ok: true, url: 'https://www.revrobotics.com/rev-21-1653/' });
    expect(normalizeUrl('HTTP://andymark.com', 'link')).toEqual({ ok: true, url: 'HTTP://andymark.com' });
    expect(normalizeUrl('', 'link')).toEqual({ ok: true, url: '' });
  });

  it('adds https:// to a bare web address, with or without a port', () => {
    expect(normalizeUrl('wcproducts.com/products/wcp-1011', 'link')).toEqual({ ok: true, url: 'https://wcproducts.com/products/wcp-1011' });
    expect(normalizeUrl('shop.example.com:8080/x', 'link')).toEqual({ ok: true, url: 'https://shop.example.com:8080/x' });
  });

  it('rejects other schemes, spaces and things that aren’t addresses', () => {
    for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'ftp://x.com', 'mailto:a@b.com']) {
      expect(normalizeUrl(bad, 'link')).toEqual({ ok: false, error: 'link must start with https://' });
    }
    expect(normalizeUrl('rev robotics', 'link').ok).toBe(false);
    expect(normalizeUrl('notaurl', 'link').ok).toBe(false);
  });

  it('safeHref only lets http(s) through', () => {
    expect(safeHref('https://x.com/a')).toBe('https://x.com/a');
    expect(safeHref('javascript:alert(1)')).toBeUndefined();
    expect(safeHref('')).toBeUndefined();
  });
});

describe('dates', () => {
  it('localIsoDate uses the tablet’s local day', () => {
    expect(localIsoDate(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });

  it('formatIsoDate shows "Oct 17, 2026"', () => {
    expect(formatIsoDate('2026-10-17')).toBe('Oct 17, 2026');
    expect(formatIsoDate('')).toBe('');
  });
});
