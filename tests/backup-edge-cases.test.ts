import 'fake-indexeddb/auto';
import JSZip from 'jszip';
import { afterEach, describe, expect, it } from 'vitest';
import { buildBackup } from '../src/data/backup';
import { InventoryDb } from '../src/data/db';
import { loadSnapshot, replaceAll } from '../src/data/inventory';
import { SNOOZE_MS, backupDue, backupInFuture, showBackupBanner } from '../src/domain/backup-reminder';
import { readCsv } from '../src/io/csv';
import { readRestoreFile } from '../src/io/restore';
import { area, dataset, item, spot } from './helpers';

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
const EMPTY = { categories: [], tags: [] };
const zipWith = async (files: Record<string, string | Uint8Array>) => {
  const z = new JSZip();
  for (const [n, c] of Object.entries(files)) z.file(n, c);
  return z.generateAsync({ type: 'uint8array' });
};

describe('backup edge cases', () => {
  it('round trip of odd ids / notes / names through a full ZIP', async () => {
    const long = 'x'.repeat(50_000) + '\n' + '"q"';
    const items = [
      item({ id: 'a/b', name: '=HYPERLINK("http://e")', notes: 'tab\tinside\rlone CR\n+1 -2 @x', spotId: 'sp-1' }),
      item({ id: 'x y#é', name: 'Ünï 🎄', notes: long, barcode: '0001', quantity: 12, tags: ['Kids’ room', 'a,b'] }),
      item({ id: 'p.png', name: 'n' }),
    ];
    const src = newDb();
    await replaceAll(
      src,
      dataset({
        areas: [area({ id: 'ar-1', name: 'Shelf, "top"' })],
        spots: [spot({ id: 'sp-1', areaId: 'ar-1', name: '=1+1' })],
        tags: [{ name: 'Kids’ room', order: 0 }, { name: 'a,b', order: 1 }],
        items,
        photos: [
          { id: 'ph-a', ownerType: 'item', ownerId: 'a/b', kind: 'photo', caption: 'cap,"q"', order: 0 },
          { id: 'ph-p', ownerType: 'item', ownerId: 'p.png', kind: 'photo', caption: '', order: 0 },
        ],
        images: new Map([
          ['ph-a', new Blob([new Uint8Array([1, 2])], { type: 'image/jpeg' })],
          ['ph-p', new Blob([new Uint8Array([3])], { type: 'image/png' })],
        ]),
      }),
    );
    const before = await loadSnapshot(src);
    const zip = await buildBackup(src, 'full', new Date());
    const dst = newDb();
    const read = await readRestoreFile({ name: 'z.zip', bytes: new Uint8Array(await zip.arrayBuffer()) }, await loadSnapshot(dst));
    if (!read.ok) throw new Error(JSON.stringify(read.problems));
    await replaceAll(dst, { ...read.plan.data, images: read.plan.images }, 1);
    const after = await loadSnapshot(dst);
    expect(after).toEqual(before);
    expect(await dst.pictures.count()).toBe(2);
  });

  it('blank lines before the header are skipped; data rows and header problems keep their real row numbers', async () => {
    const ok = await readRestoreFile({ name: 'x.zip', bytes: await zipWith({ 'items.csv': '\r\n\r\nid,name,category,quantity\r\na1,A,Lights,9' }) }, EMPTY);
    expect(ok.ok).toBe(true);
    const bad = await readRestoreFile({ name: 'x.zip', bytes: await zipWith({ 'items.csv': '\r\nname,category,quantity\r\nA,Lights,9' }) }, EMPTY);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.problems).toContainEqual(expect.objectContaining({ row: 2, message: 'missing column: id' }));
    const t = readCsv(' , \r\nid,id\r\n\r\nx,y', 't.csv');
    expect([t.headerRow, t.rows.map((r) => r.row), t.problems.map((p) => p.row)]).toEqual([2, [4], [2]]);
    expect(readCsv('id\r\nx', 't.csv').headerRow).toBe(1);
  });

  it('a Windows-1252 CSV inside a ZIP is read as Windows-1252, with a warning naming the file', async () => {
    const enc = (s: string) => new TextEncoder().encode(s);
    const items = new Uint8Array([...enc('id,name,category,quantity,spot_id\r\nw1,Hook '), 0xd7, ...enc(',Decorations,1,sp-1\r\n')]);
    const spots = new Uint8Array([...enc('id,area_id,name\r\nsp-1,ar-1,Caf'), 0xe9, ...enc(' shelf\r\n')]);
    const read = await readRestoreFile({ name: 'x.zip', bytes: await zipWith({ 'items.csv': items, 'spots.csv': spots, 'areas.csv': 'id,name,letter\r\nar-1,Kitchen,K\r\n' }) }, EMPTY);
    if (!read.ok) throw new Error(JSON.stringify(read.problems));
    expect(read.plan.data.items[0]!.name).toBe('Hook ×');
    expect(read.plan.data.spots.map((l) => l.name)).toEqual(['Café shelf']);
    expect(read.plan.warnings.filter((w) => w.includes('UTF-8'))).toEqual([
      'items.csv isn’t UTF-8, so it was read as a Windows (Excel “CSV”) file. Check names with symbols like × or ¾.',
      'spots.csv isn’t UTF-8, so it was read as a Windows (Excel “CSV”) file. Check names with symbols like × or ¾.',
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
