import { describe, expect, it } from 'vitest';
import { centsToPlain, formatCents, parsePrice } from '../src/domain/money';

describe('prices as integer cents (spec-questions Q6)', () => {
  it.each([
    ['15.99', 1599],
    ['15.9', 1590],
    ['15', 1500],
    ['0', 0],
    ['$1,234.50', 123450],
    [' 8.5 ', 850],
  ])('parses %j → %i cents', (raw, cents) => {
    expect(parsePrice(raw)).toEqual({ ok: true, cents });
  });

  it('blank means no price', () => {
    expect(parsePrice('')).toEqual({ ok: true, cents: null });
    expect(parsePrice('  ')).toEqual({ ok: true, cents: null });
  });

  it.each(['1.999', '-5', 'abc', '1,23', '12.3.4'])('rejects %j', (raw) => {
    expect(parsePrice(raw).ok).toBe(false);
  });

  it('formats', () => {
    expect(centsToPlain(841366)).toBe('8413.66');
    expect(centsToPlain(5)).toBe('0.05');
    expect(formatCents(841366)).toBe('$8,413.66');
    expect(formatCents(0)).toBe('$0.00');
  });

  it('no floating-point drift when summing many prices', () => {
    const cents = Array.from({ length: 1000 }, () => parsePrice('0.10')).map((p) => (p.ok ? p.cents! : 0));
    expect(cents.reduce((a, b) => a + b, 0)).toBe(10000);
  });
});
