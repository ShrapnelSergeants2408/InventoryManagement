// Backups with the Holiday setup (SPEC v3.0 §7, 0.1.4): displays.csv, season_tasks.csv,
// season_runs.csv and season_id in files.csv. A 0.1.3 backup, which has none of them, restores
// with empty lists; broken rows and links are refused.
import 'fake-indexeddb/auto';
import JSZip from 'jszip';
import { afterEach, describe, expect, it } from 'vitest';
import { buildBackup } from '../src/data/backup';
import { InventoryDb } from '../src/data/db';
import { addDisplay, addTask, startSetup } from '../src/data/holiday';
import { loadSnapshot, replaceAll } from '../src/data/inventory';
import { checkData, emptyData } from '../src/domain/integrity';
import { parseDisplays, parseRuns, parseTasks } from '../src/io/household-csv';
import { readRestoreFile } from '../src/io/restore';
import { dataset, household, item, season } from './helpers';

const dbs: InventoryDb[] = [];
afterEach(() => {
  for (const d of dbs.splice(0)) d.close();
});
const newDb = () => {
  const d = new InventoryDb(`hb-${Math.random()}`);
  dbs.push(d);
  return d;
};

describe('reading the Holiday setup files', () => {
  it('displays: order renumbered, name required', () => {
    const r = parseDisplays('id,name,order,notes\r\ndp-b,Porch,5,\r\ndp-a,Mantel,1,"left, then right"\r\ndp-c,,2,\r\n');
    expect(r.list.map((d) => [d.id, d.order, d.notes])).toEqual([
      ['dp-a', 0, 'left, then right'],
      ['dp-b', 1, ''],
    ]);
    expect(r.problems.map((p) => p.message)).toEqual(['display name is required']);
  });
  it('season tasks: phase required and checked, order within season and phase', () => {
    const r = parseTasks('id,season_id,phase,text,order\r\ntk-1,se-x,setup,Ladder,3\r\ntk-2,se-x,takedown,Tree,9\r\ntk-3,se-x,setup,Lights,1\r\ntk-4,se-x,later,Odd,0\r\ntk-5,se-x,,Blank,0\r\n');
    expect(r.list.map((t) => [t.id, t.phase, t.order])).toEqual([
      ['tk-3', 'setup', 0],
      ['tk-1', 'setup', 1],
      ['tk-2', 'takedown', 0],
    ]);
    expect(r.problems.map((p) => p.message)).toEqual(['phase "later" must be one of: setup, takedown', 'phase is required (setup or takedown)']);
  });
  it('season runs: ticked task ids, times, dates and phase', () => {
    const r = parseRuns(
      'id,season_id,year,setup_from,takedown_by,phase,done_task_ids,started_at,finished_at\r\nsr-1,se-x,2026,11-28,01-04,setting up,tk-1; tk-2;tk-1,2026-11-28T15:12:00.000Z,\r\nsr-2,se-x,,13-01,,soon,,yesterday,\r\n',
    );
    expect(r.list).toEqual([{ id: 'sr-1', seasonId: 'se-x', year: 2026, setupFrom: '11-28', takedownBy: '01-04', phase: 'setting up', doneTaskIds: ['tk-1', 'tk-2'], startedAt: Date.UTC(2026, 10, 28, 15, 12), finishedAt: null }]);
    expect(r.problems.map((p) => p.message)).toEqual(['year is required', 'setup from "13-01" must be a month and day (MM-DD)', 'phase "soon" must be one of: planned, setting up, up, taking down, done', 'started at "yesterday" isn\'t a date and time']);
  });
});

describe('links are checked as a whole (§3)', () => {
  const h = household();
  const base = () => ({ ...emptyData(), ...h, categories: dataset().categories });
  it('an item’s displays, a task’s season, a run’s ticked tasks, a photo’s season', () => {
    const problems = checkData({
      ...base(),
      displays: [{ id: 'dp-1', name: 'Mantel', order: 0, notes: '' }, { id: 'dp-2', name: 'mantel', order: 1, notes: '' }],
      items: [item({ id: 'it-1', displayId: 'dp-gone', outDisplayId: 'dp-1' })],
      seasonTasks: [
        { id: 'tk-1', seasonId: 'se-gone', phase: 'setup', text: 'x', order: 0 },
        { id: 'tk-2', seasonId: 'se-hall', phase: 'setup', text: 'y', order: 0 },
      ],
      seasonRuns: [
        { id: 'sr-1', seasonId: 'se-xmas', year: 2026, setupFrom: '', takedownBy: '', phase: 'up', doneTaskIds: ['tk-2'], startedAt: null, finishedAt: null },
        { id: 'sr-2', seasonId: 'se-xmas', year: 2026, setupFrom: '', takedownBy: '', phase: 'done', doneTaskIds: [], startedAt: null, finishedAt: null },
      ],
      photos: [{ id: 'ph-1', ownerType: 'display', ownerId: 'dp-1', kind: 'setup', seasonId: 'se-gone', caption: '', order: 0 }],
    });
    expect(problems).toEqual([
      'display "mantel" is listed twice',
      'season se-xmas has two runs for 2026',
      'item "Test item" usually goes on display dp-gone, which isn\'t there',
      'season task "x" is for season se-gone, which isn\'t there',
      'season run sr-1 ticks task tk-2, which isn\'t one of its season\'s tasks',
      'photo ph-1 is tagged with season se-gone, which isn\'t there',
    ]);
  });
});

describe('restoring', () => {
  it('a 0.1.3 backup (no Holiday setup files) restores with no displays, tasks or runs', async () => {
    const src = newDb();
    const h = household();
    await replaceAll(src, dataset({ ...h, items: [item({ id: 'it-1', binId: 'bn-xmas4' })] }));
    const mantel = await addDisplay(src, { name: 'Mantel' });
    await addTask(src, 'se-xmas', 'setup', 'Ladder');
    await startSetup(src, 'se-xmas', 2026);
    const zip = await JSZip.loadAsync(await buildBackup(src, 'full', new Date(2026, 10, 3)));
    for (const f of ['displays.csv', 'season_tasks.csv', 'season_runs.csv']) zip.remove(f);
    const bytes = await zip.generateAsync({ type: 'uint8array' });
    const dst = newDb();
    await replaceAll(dst, dataset({ seasons: [season()] }));
    const read = await readRestoreFile({ name: 'old.zip', bytes }, await loadSnapshot(dst));
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect([read.plan.data.displays, read.plan.data.seasonTasks, read.plan.data.seasonRuns]).toEqual([[], [], []]);
    expect(read.plan.data.items).toHaveLength(1);
    expect(mantel.name).toBe('Mantel');
  });
  it('a backup whose items name a display that isn’t in displays.csv is refused', async () => {
    const src = newDb();
    const h = household();
    await replaceAll(src, dataset({ ...h, items: [item({ id: 'it-1', binId: 'bn-xmas4' })] }));
    const d = await addDisplay(src, { name: 'Mantel' });
    await src.items.update('it-1', { displayId: d.id });
    const zip = await JSZip.loadAsync(await buildBackup(src, 'full', new Date(2026, 10, 3)));
    zip.file('displays.csv', 'id,name,order,notes\r\n');
    const read = await readRestoreFile({ name: 'x.zip', bytes: await zip.generateAsync({ type: 'uint8array' }) }, await loadSnapshot(src));
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.problems.map((p) => p.message)).toEqual([`item "Test item" usually goes on display ${d.id}, which isn't there`]);
  });
});
