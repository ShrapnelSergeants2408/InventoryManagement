// The count report and spot-check list (SPEC §18.5, v0.20).
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { InventoryDb, toHelperRow, toItemRow } from '../src/data/db';
import { applyImport, getImportUndo } from '../src/data/import-counts';
import type { Helper } from '../src/domain/helpers';
import { noChoices, type CountFields, type CountsFile } from '../src/domain/import-counts';
import { reportRows, spotCheck, spotFlags } from '../src/domain/import-report';
import { APP_VERSION } from '../src/io/backup';
import { importReportFileName, serializeImportReport } from '../src/io/import-report-csv';
import { item } from './helpers';

const f = (onHand: number, countedBy = 'Maya', lastCounted = '2026-11-12T10:00:00-06:00'): CountFields => ({ onHand, lastCounted, countedBy, location: '', barcode: '' });

describe('spotFlags', () => {
  it('zero where there was stock', () => {
    expect(spotFlags(4, 0, false)).toEqual(['zero']);
    expect(spotFlags(0, 0, false)).toEqual([]);
  });
  it('a big change is half the old count AND 5 units', () => {
    expect(spotFlags(10, 15, false)).toEqual(['big']); // +5 = 50%
    expect(spotFlags(10, 14, false)).toEqual([]); // +4: under 5 units
    expect(spotFlags(100, 104, false)).toEqual([]); // under 50%
    expect(spotFlags(100, 140, false)).toEqual([]); // 40 units but only 40%
    expect(spotFlags(100, 40, false)).toEqual(['big']); // down 60 units, 60%
  });
  it('from none, a count of 5 or more is a big change; 4 is not', () => {
    expect(spotFlags(0, 5, false)).toEqual(['big']);
    expect(spotFlags(0, 4, false)).toEqual([]);
  });
  it('a drop to zero is "zero", not also "big"', () => {
    expect(spotFlags(20, 0, false)).toEqual(['zero']);
  });
  it('outside the helper’s groups is its own flag and can combine', () => {
    expect(spotFlags(2, 3, true)).toEqual(['outside']);
    expect(spotFlags(2, 30, true)).toEqual(['big', 'outside']);
  });
});

describe('reportRows', () => {
  const before: Array<[string, CountFields]> = [['B', f(10, '')], ['A', f(4, '')], ['C', f(5, '')]];
  const after: Array<[string, CountFields]> = [['B', f(0)], ['A', f(5)], ['C', f(20)]];
  it('one row per changed item, in item id order, with flags', () => {
    const rows = reportRows(before, after, ['A']);
    expect(rows.map((r) => [r.itemId, r.before.onHand, r.after.onHand, r.flags])).toEqual([
      ['A', 4, 5, ['outside']],
      ['B', 10, 0, ['zero']],
      ['C', 5, 20, ['big']],
    ]);
    expect(spotCheck(rows).map((r) => r.itemId)).toEqual(['A', 'B', 'C']);
  });
  it('an item with nothing unusual is not in the spot-check list', () => {
    expect(spotCheck(reportRows([['A', f(4, '')]], [['A', f(5)]], []))).toEqual([]);
  });
});

describe('the count report CSV', () => {
  it('has a note row, a header, and a row per item with before, after, change and flags', () => {
    const rows = reportRows([['A', f(4, '')], ['B', f(10, '')]], [['A', f(5)], ['B', f(0)]], []);
    const csv = serializeImportReport(rows, [item({ id: 'A', name: '=cmd', category: 'Motors' }), item({ id: 'B', name: 'Wire', category: 'Electrical' })], 'Count report: test');
    const lines = csv.replace(/^﻿/, '').trim().split(/\r?\n/);
    expect(lines[0]).toBe('Count report: test');
    expect(lines[1]).toBe('Item id,Item,Category,Location,Before,After,Change,Counted by,Counted at,Spot-check');
    expect(lines[2]).toBe("A,'=cmd,Motors,,4,5,+1,Maya,2026-11-12T10:00:00-06:00,");
    expect(lines[3]).toBe('B,Wire,Electrical,,10,0,-10,Maya,2026-11-12T10:00:00-06:00,Counted zero (there was stock)');
  });
  it('is named by the import time', () => {
    expect(importReportFileName(new Date(2026, 10, 12, 14, 5).getTime())).toBe('count-report-2026-11-12-1405.csv');
  });
});

describe('applyImport keeps what the report needs', () => {
  let n = 0;
  const open: Dexie[] = [];
  afterEach(async () => {
    for (const db of open.splice(0)) {
      db.close();
      await Dexie.delete(db.name);
    }
  });
  const helper: Helper = { id: 'hp-MAYA1', name: 'Maya', kind: 'category', groups: ['Electrical'], allowNewItems: true, kits: [{ id: 'kit-ONE00001', createdAt: '2026-11-12T09:00:00-06:00' }], lastImportAt: null, created: 1 };

  it('stores the after-values and the items counted outside the helper’s groups', async () => {
    const db = new InventoryDb(`m25-report-${++n}`);
    open.push(db);
    await db.items.bulkAdd([item({ id: 'A', category: 'Electrical', onHand: 4 }), item({ id: 'B', category: 'Motors', onHand: 10 })].map((i) => toItemRow(i, 1)));
    await db.helpers.add(toHelperRow(helper));
    const file: CountsFile = {
      fileName: 'c.zip',
      meta: { kitId: 'kit-ONE00001', helperId: 'hp-MAYA1', helperName: 'Maya', createdAt: '2026-11-12T10:30:00-06:00', sequence: 1, appVersion: APP_VERSION, deviceId: 'dev-ONE01' },
      counts: [
        { itemId: 'A', onHand: 5, countedAt: '2026-11-12T10:00:00-06:00', location: '', barcode: '', outside: false },
        { itemId: 'B', onHand: 0, countedAt: '2026-11-12T10:05:00-06:00', location: '', barcode: '', outside: true },
      ],
      newItems: [],
      newLocations: [],
      photos: new Map(),
    };
    await applyImport(db, [file], noChoices(), 5000);
    const undo = (await getImportUndo(db))!;
    expect(undo.after!.map(([id, a]) => [id, a.onHand]).sort()).toEqual([['A', 5], ['B', 0]]);
    expect(undo.outside).toEqual(['B']);
    const rows = reportRows(undo.items, undo.after!, undo.outside!);
    expect(rows.map((r) => [r.itemId, r.flags])).toEqual([['A', []], ['B', ['zero', 'outside']]]);
  });
});
