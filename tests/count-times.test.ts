// last_counted as a local date-time with offset (SPEC §3, §7, §19 "last_counted as date-time";
// stage6-plan M16a). Tests run in America/Chicago (vite.config.ts): CST -06:00, CDT -05:00.
import 'fake-indexeddb/auto';
import Papa from 'papaparse';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { saveCount } from '../src/data/count';
import { InventoryDb, toItemRow } from '../src/data/db';
import { getItem } from '../src/data/inventory';
import { countGroups, firstToCount, isCounted, overallProgress, summarize } from '../src/domain/count';
import { countedDate, isCountStamp, localIsoDateTime, midnightLocalIso, nowLocalIso, readCountStamp } from '../src/domain/dates';
import { validateItem } from '../src/domain/validate';
import { INVENTORY_COLUMNS, parseInventoryCsv, serializeInventoryCsv } from '../src/io/inventory-csv';
import { item } from './helpers';

afterEach(() => vi.useRealTimers());

describe('writing a count time', () => {
  it('is the local date and time with the offset in force at that moment, never Z', () => {
    expect(localIsoDateTime(new Date(2026, 9, 24, 18, 42, 7))).toBe('2026-10-24T18:42:07-05:00');
    expect(localIsoDateTime(new Date(2026, 0, 5, 7, 3, 9))).toBe('2026-01-05T07:03:09-06:00');
    // Either side of the 2 a.m. changes.
    expect(localIsoDateTime(new Date(2026, 2, 8, 1, 59, 0))).toBe('2026-03-08T01:59:00-06:00');
    expect(localIsoDateTime(new Date(2026, 2, 8, 3, 0, 0))).toBe('2026-03-08T03:00:00-05:00');
    expect(localIsoDateTime(new Date(Date.UTC(2026, 10, 1, 6, 30)))).toBe('2026-11-01T01:30:00-05:00');
    expect(localIsoDateTime(new Date(Date.UTC(2026, 10, 1, 7, 30)))).toBe('2026-11-01T01:30:00-06:00');
  });

  it('nowLocalIso is now', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2026, 9, 24, 23, 42, 7)));
    expect(nowLocalIso()).toBe('2026-10-24T18:42:07-05:00');
  });

  it('a stamp names the same moment it was made from', () => {
    for (const ms of [Date.UTC(2026, 2, 8, 7, 59), Date.UTC(2026, 2, 8, 8, 0), Date.UTC(2026, 10, 1, 6, 30), Date.UTC(2026, 10, 1, 7, 30), Date.UTC(2026, 6, 4, 4, 59, 59)]) {
      expect(Date.parse(localIsoDateTime(new Date(ms)))).toBe(ms);
    }
  });

  it('midnight local, with that day’s offset', () => {
    expect(midnightLocalIso('2026-03-07')).toBe('2026-03-07T00:00:00-06:00');
    expect(midnightLocalIso('2026-03-08')).toBe('2026-03-08T00:00:00-06:00');
    expect(midnightLocalIso('2026-03-09')).toBe('2026-03-09T00:00:00-05:00');
    expect(midnightLocalIso('2026-11-01')).toBe('2026-11-01T00:00:00-05:00');
    expect(midnightLocalIso('2026-11-02')).toBe('2026-11-02T00:00:00-06:00');
  });
});

describe('reading a count time', () => {
  it.each([
    ['', ''],
    ['2026-10-24T18:42:07-05:00', '2026-10-24T18:42:07-05:00'],
    ['2026-10-24T18:42-05:00', '2026-10-24T18:42-05:00'],
    // A helper in another zone keeps its own local time.
    ['2026-10-24T19:42:00-04:00', '2026-10-24T19:42:00-04:00'],
    [' 2026-10-24T18:42:07+05:30 ', '2026-10-24T18:42:07+05:30'],
    ['2026-10-24', '2026-10-24T00:00:00-05:00'],
    ['2026-11-02', '2026-11-02T00:00:00-06:00'],
    ['2026-10-24T23:42:07Z', '2026-10-24T18:42:07-05:00'],
    ['2026-01-05T13:00:00Z', '2026-01-05T07:00:00-06:00'],
    // As spreadsheets re-save date-times (independent M16a review, finding 6): no offset is local time.
    ['2026-10-24T18:42', '2026-10-24T18:42:00-05:00'],
    ['2026-10-24 18:42', '2026-10-24T18:42:00-05:00'],
    ['2026-12-01 07:05:09', '2026-12-01T07:05:09-06:00'],
    ['10/24/2026 18:42', '2026-10-24T18:42:00-05:00'],
    ['10/24/2026 6:42 PM', '2026-10-24T18:42:00-05:00'],
    ['1/5/2026 12:15 am', '2026-01-05T00:15:00-06:00'],
    ['2026-10-24 18:42-05:00', '2026-10-24T18:42:00-05:00'],
    ['2026-10-24T18:42:07.123-05:00', '2026-10-24T18:42:07-05:00'],
    ['2026-10-24T18:42:07-0400', '2026-10-24T18:42:07-04:00'],
    ['2026-10-24 23:42:07z', '2026-10-24T18:42:07-05:00'],
  ])('%j → %j', (raw, want) => expect(readCountStamp(raw)).toBe(want));

  it.each(['2026-02-30', '2026-10-24T24:00-05:00', '2026-10-24T18:60-05:00', '2026-10-24T18:42-15:00', 'yesterday', '2026-02-30T10:00Z', '2026-10-24 24:00', '13/24/2026 18:42', '10/24/2026 13:00 PM', '10/24/2026 0:30 AM', '2/30/2026 10:00', '2026-10-24T18:42:07+0560'])(
    '%j is refused',
    (raw) => expect(readCountStamp(raw)).toBeNull(),
  );

  it('the stored form: a stamp with an offset or a date only, never Z or blank', () => {
    expect(isCountStamp('2026-10-24T18:42:07-05:00')).toBe(true);
    expect(isCountStamp('2026-10-24')).toBe(true);
    expect(isCountStamp('2026-10-24T18:42:07Z')).toBe(false);
    expect(isCountStamp('')).toBe(false);
    expect(validateItem(item({ lastCounted: '2026-10-24T18:42:07Z' }), null).map((e) => e.field)).toEqual(['lastCounted']);
    expect(validateItem(item({ lastCounted: '2026-10-24T18:42:07-05:00' }), null)).toEqual([]);
  });

  it('the local date of a count is the date as written', () => {
    expect(countedDate('2026-10-23T23:30:00-05:00')).toBe('2026-10-23');
    expect(countedDate('2026-10-24T00:10:00-05:00')).toBe('2026-10-24');
    expect(countedDate('2026-10-24')).toBe('2026-10-24');
    expect(countedDate('')).toBe('');
    expect(countedDate('nonsense')).toBe('');
  });
});

describe('count rounds with date-times (§19, F24)', () => {
  const since = '2026-10-24';
  const lateEvening = item({ id: 'late', category: 'A', lastCounted: '2026-10-23T23:30:00-05:00' });
  const justAfterMidnight = item({ id: 'mid', category: 'A', lastCounted: '2026-10-24T00:10:00-05:00' });
  const onTheDay = item({ id: 'day', category: 'A', lastCounted: '2026-10-24T18:42:07-05:00' });
  const later = item({ id: 'later', category: 'B', lastCounted: '2026-11-02T08:00:00-06:00' });
  const never = item({ id: 'never', category: 'B', lastCounted: '' });
  const all = [lateEvening, justAfterMidnight, onTheDay, later, never];

  it('the evening before “counting since” is not counted; that date is', () => {
    expect(isCounted(lateEvening, since)).toBe(false);
    expect(isCounted(justAfterMidnight, since)).toBe(true);
    expect(isCounted(onTheDay, since)).toBe(true);
    expect(isCounted(never, since)).toBe(false);
    // Blank "since" (the first count): any count.
    expect(isCounted(lateEvening, '')).toBe(true);
    expect(isCounted(never, '')).toBe(false);
  });

  it('a helper’s late-evening count in its own zone uses its own date', () => {
    // 00:30 in New York is still the 23rd in Chicago; the helper counted on the 24th, its date.
    expect(isCounted(item({ lastCounted: '2026-10-24T00:30:00-04:00' }), since)).toBe(true);
  });

  it('progress, groups, where to start and the summary give what the old dates gave', () => {
    const asDates = all.map((i) => ({ ...i, lastCounted: i.lastCounted.slice(0, 10) }));
    for (const s of ['', '2026-10-23', since, '2026-10-25', '2026-11-02', '2026-11-03']) {
      expect(overallProgress(all, s), s).toEqual(overallProgress(asDates, s));
      expect(countGroups(all, [], [], 'category', false, s).map((g) => [g.name, g.counted, g.action]), s).toEqual(
        countGroups(asDates, [], [], 'category', false, s).map((g) => [g.name, g.counted, g.action]),
      );
      expect(firstToCount(all, s), s).toBe(firstToCount(asDates, s));
      expect(summarize(all.map((i) => i.id), all, new Set(), new Set(), s).counted, s).toBe(summarize(asDates.map((i) => i.id), asDates, new Set(), new Set(), s).counted);
    }
    expect(overallProgress(all, since)).toEqual({ counted: 3, total: 5 });
  });
});

describe('inventory.csv in and out (§7)', () => {
  const header = INVENTORY_COLUMNS;
  const row = (over: Record<string, string>) =>
    header.map((c) => ({ id: 'a', name: 'A', category: 'Motors', unit: 'each', on_hand: '1', desired: '1', v1_supplier: 'REV', v1_pack_size: '1', ...over })[c] ?? '');
  const parse = (over: Record<string, string>) => parseInventoryCsv(Papa.unparse([header, row(over)], { newline: '\r\n' }));

  it('writes last_counted as stored and counted_by beside it', () => {
    const text = serializeInventoryCsv([item({ lastCounted: '2026-10-24T18:42:07-05:00', countedBy: 'Maya’s phone, "2"' })]);
    const [h, r] = Papa.parse<string[]>(text.replace(/^﻿/, ''), { skipEmptyLines: true }).data;
    expect(r![h!.indexOf('last_counted')]).toBe('2026-10-24T18:42:07-05:00');
    expect(r![h!.indexOf('counted_by')]).toBe('Maya’s phone, "2"');
    expect(h!.indexOf('counted_by')).toBe(h!.indexOf('last_counted') + 1);
  });

  it('round-trips date-times exactly, in any offset, with counted_by', () => {
    const items = [
      item({ id: 'a', lastCounted: '2026-10-24T18:42:07-05:00', countedBy: '' }),
      item({ id: 'b', lastCounted: '2026-03-08T03:00:00-05:00', countedBy: 'Tablet 2 · Alex & Jordan' }),
      item({ id: 'c', lastCounted: '2026-10-24T19:42:00-04:00', countedBy: 'Visitor' }),
      item({ id: 'd', lastCounted: '', countedBy: '' }),
    ];
    const back = parseInventoryCsv(serializeInventoryCsv(items));
    expect(back.problems).toEqual([]);
    expect(back.items).toEqual(items);
  });

  it('reads a date-only value (v0.4–v0.7 files) as local midnight that day', () => {
    expect(parse({ last_counted: '2026-10-24' }).items[0]!.lastCounted).toBe('2026-10-24T00:00:00-05:00');
    expect(parse({ last_counted: '2026-12-01' }).items[0]!.lastCounted).toBe('2026-12-01T00:00:00-06:00');
    expect(parse({ last_counted: '12/1/2026' }).items[0]!.lastCounted).toBe('2026-12-01T00:00:00-06:00');
    // A v0.8 file re-saved by a spreadsheet (independent M16a review, finding 6).
    expect(parse({ last_counted: '10/24/2026 18:42' }).items[0]!.lastCounted).toBe('2026-10-24T18:42:00-05:00');
    expect(parse({ last_counted: '2026-10-24 18:42:07.5-05:00' }).items[0]!.lastCounted).toBe('2026-10-24T18:42:07-05:00');
  });

  it('files without counted_by import it blank; a bad last_counted is a row problem', () => {
    const cols = header.filter((c) => c !== 'counted_by' && c !== 'last_counted');
    const r = parseInventoryCsv(Papa.unparse([cols, cols.map((c) => ({ id: 'a', name: 'A', category: 'M', unit: 'each', on_hand: '0', desired: '0', v1_supplier: 'REV', v1_pack_size: '1' })[c] ?? '')]));
    expect(r.problems).toEqual([]);
    expect(r.items[0]).toMatchObject({ lastCounted: '', countedBy: '' });
    const bad = parse({ last_counted: '2026-10-24T25:00-05:00' });
    expect(bad.items).toEqual([]);
    expect(bad.problems[0]!.message).toMatch(/last counted "2026-10-24T25:00-05:00" must be a date and time/);
  });
});

describe('saving a count on this tablet', () => {
  it('writes now as a local date-time and clears counted_by (blank = this tablet)', async () => {
    const db = new InventoryDb(`ct-${Math.random()}`);
    await db.items.put(toItemRow(item({ id: 'a', lastCounted: '2026-10-01T10:00:00-05:00', countedBy: 'Maya' }), 1));
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(Date.UTC(2026, 10, 2, 15, 4, 5)));
    await saveCount(db, 'a', 4);
    expect(await getItem(db, 'a')).toMatchObject({ onHand: 4, lastCounted: '2026-11-02T09:04:05-06:00', countedBy: '' });
    db.close();
  });
});
