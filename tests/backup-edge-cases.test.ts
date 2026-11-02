import 'fake-indexeddb/auto';
import JSZip from 'jszip';
import { afterEach, describe, expect, it } from 'vitest';
import { buildBackup } from '../src/data/backup';
import { InventoryDb } from '../src/data/db';
import { loadSnapshot, replaceAll } from '../src/data/inventory';
import { SNOOZE_MS, backupDue, backupInFuture, showBackupBanner } from '../src/domain/backup-reminder';
import { readCsv } from '../src/io/csv';
import { readRestoreFile } from '../src/io/restore';
import { item } from './helpers';

// Backup and restore edge cases found by reviews of the FRC app this was forked from. Each
// test guards a fix that still applies to the household app.

const dbs: InventoryDb[] = [];
afterEach(() => {
  for (const d of dbs.splice(0)) d.close();
});
const newDb = () => {
  const d = new InventoryDb(`rv-${Math.random()}`);
  dbs.push(d);
  return d;
};
const EMPTY = { items: [], locations: [], categories: [] };

describe('backup edge cases', () => {
  it('round trip of odd ids / notes / names through full ZIP', async () => {
    const long = 'x'.repeat(50_000) + '\n' + '"q"';
    const items = [
      item({ id: 'a/b', name: '=HYPERLINK("http://e")', notes: 'tab\tinside\rlone CR\n+1 -2 @x', location: 'Shelf, "top"' }),
      item({ id: 'x y#é', name: 'Ünï 🎄', notes: long, barcode: '0001', quantity: 12 }),
      item({ id: 'p.png', name: 'n' }),
    ];
    const src = newDb();
    await replaceAll(src, {
      items,
      photos: new Map([
        ['a/b', new Blob([new Uint8Array([1, 2])], { type: 'image/jpeg' })],
        ['p.png', new Blob([new Uint8Array([3])], { type: 'image/png' })],
      ]),
      locations: [{ name: 'Shelf, "top"', notes: '', order: 0 }],
      categories: [],
    });
    const before = await loadSnapshot(src);
    const zip = await buildBackup(src, 'full', new Date());
    const dst = newDb();
    const read = await readRestoreFile({ name: 'z.zip', bytes: new Uint8Array(await zip.arrayBuffer()) }, await loadSnapshot(dst));
    if (!read.ok) throw new Error(JSON.stringify(read.problems));
    await replaceAll(dst, read.plan, 1);
    const after = await loadSnapshot(dst);
    expect(after.items).toEqual(before.items);
    expect(await dst.photos.count()).toBe(2);
  });

  it('blank lines before the header are skipped; data rows and header problems keep their real row numbers', async () => {
    const ok = await readRestoreFile({ name: 'x.csv', bytes: new TextEncoder().encode('\r\n\r\nid,name,category,quantity\r\na1,A,Lights,9') }, EMPTY);
    expect(ok.ok).toBe(true);
    const bad = await readRestoreFile({ name: 'x.csv', bytes: new TextEncoder().encode('\r\nname,category,quantity\r\nA,Lights,9') }, EMPTY);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.problems).toContainEqual(expect.objectContaining({ row: 2, message: 'missing column: id' }));
    const t = readCsv(' , \r\nid,id\r\n\r\nx,y', 't.csv');
    expect([t.headerRow, t.rows.map((r) => r.row), t.problems.map((p) => p.row)]).toEqual([2, [4], [2]]);
    expect(readCsv('id\r\nx', 't.csv').headerRow).toBe(1);
  });

  it('a Windows-1252 CSV inside a ZIP is read as Windows-1252, with a warning naming the file', async () => {
    const head = new TextEncoder().encode('id,name,category,quantity\r\nw1,Hook ');
    const bytes = new Uint8Array([...head, 0xd7, ...new TextEncoder().encode(',Decorations,1\r\n')]);
    const z = new JSZip();
    z.file('inventory.csv', bytes);
    z.file('locations.csv', new Uint8Array([...new TextEncoder().encode('name,notes,order\r\nCaf'), 0xe9, ...new TextEncoder().encode(' shelf,,0\r\n')]));
    const read = await readRestoreFile({ name: 'x.zip', bytes: await z.generateAsync({ type: 'uint8array' }) }, EMPTY);
    if (!read.ok) throw new Error(JSON.stringify(read.problems));
    expect(read.plan.items[0]!.name).toBe('Hook ×');
    expect(read.plan.locations.map((l) => l.name)).toContain('Café shelf');
    expect(read.plan.warnings.filter((w) => w.includes('UTF-8'))).toEqual([
      'inventory.csv isn’t UTF-8, so it was read as a Windows (Excel “CSV”) file. Check names with symbols like × or ¾.',
      'locations.csv isn’t UTF-8, so it was read as a Windows (Excel “CSV”) file. Check names with symbols like × or ¾.',
    ]);
  });

  it('a backup or a snooze dated in the future no longer keeps the reminder off', () => {
    const DAY = 86_400_000;
    const HOUR = 3_600_000;
    const now = Date.UTC(2026, 9, 18);
    const clock = { setupDoneAt: now - 400 * DAY, reminderDays: 7 };
    expect(backupDue({ ...clock, lastBackupAt: now + 365 * DAY }, now)).toBe(true);
    expect(backupInFuture(now + 365 * DAY, now)).toBe(true);
    // Up to an hour ahead is clock drift between devices, not a changed clock: a fresh backup.
    expect(backupDue({ ...clock, lastBackupAt: now + 30 * 60_000 }, now)).toBe(false);
    expect(backupInFuture(now + 30 * 60_000, now)).toBe(false);
    expect(backupInFuture(null, now)).toBe(false);
    const due = { ...clock, lastBackupAt: now - 10 * DAY };
    expect(showBackupBanner(due, now, now + 2 * HOUR)).toBe(true); // snoozed "in the future"
    expect(showBackupBanner(due, now, now + 60_000)).toBe(false); // a screen clock a minute behind
    expect(showBackupBanner(due, now, now - SNOOZE_MS + 1)).toBe(false);
    expect(showBackupBanner(due, now, now - SNOOZE_MS)).toBe(true);
  });
});

describe('backup reminder off (SPEC v2.0 F18)', () => {
  it('0 days turns the reminder off, even long after setup', () => {
    const now = Date.UTC(2026, 10, 2);
    expect(backupDue({ setupDoneAt: now - 400 * 86_400_000, lastBackupAt: null, reminderDays: 0 }, now)).toBe(false);
    expect(showBackupBanner({ setupDoneAt: now - 400 * 86_400_000, lastBackupAt: null, reminderDays: 0 }, now, null)).toBe(false);
  });
});
