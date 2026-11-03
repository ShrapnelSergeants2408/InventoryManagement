// The Holiday setup's writes (SPEC v3.0 F22, F25, F5, §3): displays, season tasks, season runs,
// and putting items and bins out and back. Each runs in one transaction, so a failure leaves the
// phone unchanged. Everything here is Holiday only.
import { checkName, moveBy, renumber } from '../domain/lists';
import { ID_PREFIX, newId } from '../domain/ids';
import { tidyMonthDay } from '../domain/seasons';
import type { Display, Item, SeasonRun, SeasonTask, TaskPhase } from '../domain/types';
import { validateSeasonRun } from '../domain/validate';
import { type InventoryDb } from './db';
import { deletePhotosOf } from './photos';

function fail(message: string): never {
  throw new Error(message);
}

const touch = (db: InventoryDb, now: number) => db.settings.put({ key: 'lastChangeAt', value: now });

// ── Displays (F22) ──

async function orderedDisplays(db: InventoryDb): Promise<Display[]> {
  return (await db.displays.toArray()).sort((a, b) => a.order - b.order);
}

async function writeDisplayOrder(db: InventoryDb, list: readonly Display[]): Promise<void> {
  const changed = renumber(list).filter((d, i) => d !== list[i]);
  if (changed.length) await db.displays.bulkPut(changed);
}

export async function addDisplay(db: InventoryDb, v: { name: string; notes?: string }, now = Date.now()): Promise<Display> {
  return db.transaction('rw', db.displays, db.settings, async () => {
    const list = await orderedDisplays(db);
    const checked = checkName(v.name, list.map((d) => d.name), 'Display');
    if (!checked.ok) return fail(checked.error);
    const taken = new Set(list.map((d) => d.id));
    const display: Display = { id: newId(ID_PREFIX.display, (x) => taken.has(x)), name: checked.name, order: list.length, notes: (v.notes ?? '').trim() };
    await db.displays.add(display);
    await touch(db, now);
    return display;
  });
}

/** Renames a display or changes its notes. Items out on it show the new name. */
export async function updateDisplay(db: InventoryDb, id: string, v: { name: string; notes: string }, now = Date.now()): Promise<Display> {
  return db.transaction('rw', db.displays, db.items, db.settings, async () => {
    const list = await orderedDisplays(db);
    const display = list.find((d) => d.id === id) ?? fail('This display was removed meanwhile.');
    const checked = checkName(v.name, list.map((d) => d.name), 'Display', display.name);
    if (!checked.ok) return fail(checked.error);
    const next = { ...display, name: checked.name, notes: v.notes.trim() };
    await db.displays.put(next);
    if (next.name !== display.name) {
      const on = await db.items.filter((i) => i.outDisplayId === id).toArray();
      if (on.length) await db.items.bulkPut(on.map((i) => ({ ...i, outWhere: next.name, updatedAt: now })));
    }
    await touch(db, now);
    return next;
  });
}

export async function moveDisplay(db: InventoryDb, id: string, delta: number, now = Date.now()): Promise<void> {
  await db.transaction('rw', db.displays, db.settings, async () => {
    const list = await orderedDisplays(db);
    const at = list.findIndex((d) => d.id === id);
    if (at < 0) fail('This display was removed meanwhile.');
    await writeDisplayOrder(db, moveBy(list, at, delta));
    await touch(db, now);
  });
}

/**
 * Removes a display (after confirming when in use, F22) and its photos. Items that usually go
 * there lose their usual display; items out on it stay out, with its name kept as typed text.
 */
export async function removeDisplay(db: InventoryDb, id: string, now = Date.now()): Promise<{ usual: number; on: number }> {
  return db.transaction('rw', [db.displays, db.items, db.pictures, db.settings], async () => {
    const list = await orderedDisplays(db);
    if (!list.some((d) => d.id === id)) fail('This display was removed meanwhile.');
    const items = await db.items.filter((i) => i.displayId === id || i.outDisplayId === id).toArray();
    await db.items.bulkPut(items.map((i) => ({ ...i, displayId: i.displayId === id ? '' : i.displayId, outDisplayId: i.outDisplayId === id ? '' : i.outDisplayId, updatedAt: now })));
    await db.displays.delete(id);
    await deletePhotosOf(db, [id]);
    await writeDisplayOrder(db, list.filter((d) => d.id !== id));
    await touch(db, now);
    return { usual: items.filter((i) => i.displayId === id).length, on: items.filter((i) => i.outDisplayId === id).length };
  });
}

// ── Season tasks (F25, F6) ──

async function tasksOf(db: InventoryDb, seasonId: string, phase: TaskPhase): Promise<SeasonTask[]> {
  return (await db.seasonTasks.where('seasonId').equals(seasonId).toArray()).filter((t) => t.phase === phase).sort((a, b) => a.order - b.order);
}

export async function addTask(db: InventoryDb, seasonId: string, phase: TaskPhase, text: string, now = Date.now()): Promise<SeasonTask> {
  return db.transaction('rw', db.seasons, db.seasonTasks, db.settings, async () => {
    if (!(await db.seasons.get(seasonId))) fail('This season was removed meanwhile.');
    const t = text.trim();
    if (t === '') fail('Type what needs doing.');
    const list = await tasksOf(db, seasonId, phase);
    const taken = new Set((await db.seasonTasks.toCollection().primaryKeys()) as string[]);
    const task: SeasonTask = { id: newId(ID_PREFIX.task, (x) => taken.has(x)), seasonId, phase, text: t, order: list.length };
    await db.seasonTasks.add(task);
    await touch(db, now);
    return task;
  });
}

export async function updateTask(db: InventoryDb, id: string, text: string, now = Date.now()): Promise<void> {
  await db.transaction('rw', db.seasonTasks, db.settings, async () => {
    const t = text.trim();
    if (t === '') fail('Type what needs doing.');
    const n = await db.seasonTasks.update(id, { text: t });
    if (n === 0) fail('This task was removed meanwhile.');
    await touch(db, now);
  });
}

export async function moveTask(db: InventoryDb, id: string, delta: number, now = Date.now()): Promise<void> {
  await db.transaction('rw', db.seasonTasks, db.settings, async () => {
    const task = (await db.seasonTasks.get(id)) ?? fail('This task was removed meanwhile.');
    const list = await tasksOf(db, task.seasonId, task.phase);
    const moved = renumber(moveBy(list, list.findIndex((t) => t.id === id), delta));
    await db.seasonTasks.bulkPut(moved);
    await touch(db, now);
  });
}

/** Removes a task; runs that ticked it forget it. */
export async function removeTask(db: InventoryDb, id: string, now = Date.now()): Promise<void> {
  await db.transaction('rw', db.seasonTasks, db.seasonRuns, db.settings, async () => {
    const task = (await db.seasonTasks.get(id)) ?? fail('This task was removed meanwhile.');
    await db.seasonTasks.delete(id);
    await db.seasonTasks.bulkPut(renumber((await tasksOf(db, task.seasonId, task.phase)).filter((t) => t.id !== id)));
    const runs = (await db.seasonRuns.where('seasonId').equals(task.seasonId).toArray()).filter((r) => r.doneTaskIds.includes(id));
    if (runs.length) await db.seasonRuns.bulkPut(runs.map((r) => ({ ...r, doneTaskIds: r.doneTaskIds.filter((x) => x !== id) })));
    await touch(db, now);
  });
}

// ── Season runs (F25) ──

/**
 * Start setup (F25): this year's run of the season, created if it's not there, set to `setting
 * up`. A run already underway or done is returned as it is. `year` is the year its setup starts.
 */
export async function startSetup(db: InventoryDb, seasonId: string, year: number, now = Date.now()): Promise<SeasonRun> {
  return db.transaction('rw', db.seasons, db.seasonRuns, db.settings, async () => {
    if (!(await db.seasons.get(seasonId))) fail('This season was removed meanwhile.');
    const runs = await db.seasonRuns.where('seasonId').equals(seasonId).toArray();
    const existing = runs.find((r) => r.year === year);
    if (existing && existing.phase !== 'planned') return existing;
    const taken = new Set((await db.seasonRuns.toCollection().primaryKeys()) as string[]);
    const run: SeasonRun = existing
      ? { ...existing, phase: 'setting up', startedAt: now }
      : { id: newId(ID_PREFIX.run, (x) => taken.has(x)), seasonId, year, setupFrom: '', takedownBy: '', phase: 'setting up', doneTaskIds: [], startedAt: now, finishedAt: null };
    const errors = validateSeasonRun(run);
    if (errors.length) fail(errors.map((e) => e.message).join('; '));
    await db.seasonRuns.put(run);
    await touch(db, now);
    return run;
  });
}

async function runOrFail(db: InventoryDb, id: string): Promise<SeasonRun> {
  return (await db.seasonRuns.get(id)) ?? fail('This season’s run was removed meanwhile (a restore, or the season was removed).');
}

/** Ticks or unticks a season task in a run. Ticking twice is the same as once (§12.1: a set). */
export async function tickTask(db: InventoryDb, runId: string, taskId: string, done: boolean, now = Date.now()): Promise<void> {
  await db.transaction('rw', db.seasonRuns, db.seasonTasks, db.settings, async () => {
    const run = await runOrFail(db, runId);
    const task = (await db.seasonTasks.get(taskId)) ?? fail('This task was removed meanwhile.');
    if (task.seasonId !== run.seasonId) fail('That task belongs to another season.');
    const has = run.doneTaskIds.includes(taskId);
    if (has === done) return;
    await db.seasonRuns.put({ ...run, doneTaskIds: done ? [...run.doneTaskIds, taskId] : run.doneTaskIds.filter((x) => x !== taskId) });
    await touch(db, now);
  });
}

/** Finish setup (F25): the run is `up`. Anything unticked stays as it is. */
export async function finishSetup(db: InventoryDb, runId: string, now = Date.now()): Promise<void> {
  await setRunPhase(db, runId, 'up', 'setting up', now);
}

/** Reopens a finished setup (a mistaken Finish): back to `setting up`. */
export async function reopenSetup(db: InventoryDb, runId: string, now = Date.now()): Promise<void> {
  await setRunPhase(db, runId, 'setting up', 'up', now);
}

async function setRunPhase(db: InventoryDb, runId: string, to: SeasonRun['phase'], from: SeasonRun['phase'], now: number): Promise<void> {
  await db.transaction('rw', db.seasonRuns, db.settings, async () => {
    const run = await runOrFail(db, runId);
    if (run.phase === to) return;
    if (run.phase !== from) fail(`This season is ${run.phase}, not ${from}.`);
    await db.seasonRuns.put({ ...run, phase: to });
    await touch(db, now);
  });
}

/** Changes this year's dates for one run (§3: a run can move them for one year); blanks use the season's. */
export async function setRunDates(db: InventoryDb, runId: string, v: { setupFrom: string; takedownBy: string }, now = Date.now()): Promise<void> {
  await db.transaction('rw', db.seasonRuns, db.settings, async () => {
    const run = await runOrFail(db, runId);
    const next = { ...run, setupFrom: tidyMonthDay(v.setupFrom), takedownBy: tidyMonthDay(v.takedownBy) };
    const errors = validateSeasonRun(next);
    if (errors.length) fail(errors.map((e) => e.message).join('; '));
    await db.seasonRuns.put(next);
    await touch(db, now);
  });
}

// ── Out and back (F25, F5) ──

/** Where an item goes when it's put out: a display, or typed text ("Front yard"), or nowhere in particular. */
export type OutPlace = { displayId: string } | { where: string };

/** Sets bins `out` (taken out for the season) or back to `stored`. Returns how many changed. */
export async function setBinsState(db: InventoryDb, ids: readonly string[], state: 'out' | 'stored', now = Date.now()): Promise<number> {
  return db.transaction('rw', db.bins, db.settings, async () => {
    const rows = await db.bins.bulkGet([...new Set(ids)]);
    if (rows.some((r) => !r)) fail('A bin was deleted meanwhile. Nothing changed.');
    const changing = rows.filter((b) => b!.state !== state).map((b) => ({ ...b!, state }));
    if (changing.length) await db.bins.bulkPut(changing);
    await touch(db, now);
    return changing.length;
  });
}

/**
 * Puts items out (F25, F5): status `out`, `outSince` now, on the given place or, where none is
 * given for an item, on its usual display. Items already out move to the new place but keep
 * their `outSince`. Returns how many changed.
 */
export async function putOut(db: InventoryDb, items: readonly { id: string; to?: OutPlace }[], now = Date.now()): Promise<number> {
  return db.transaction('rw', db.items, db.displays, db.settings, async () => {
    const displays = new Map((await db.displays.toArray()).map((d) => [d.id, d]));
    const rows = await db.items.bulkGet(items.map((i) => i.id));
    if (rows.some((r) => !r)) fail('An item was deleted meanwhile. Nothing changed.');
    const changed = [];
    for (const [k, row] of rows.entries()) {
      const item = row!;
      if (item.part !== 'holiday') fail(`“${item.name}” is a Household item; only Holiday items are put out on displays.`);
      const to = items[k]!.to ?? { displayId: displays.has(item.displayId) ? item.displayId : '' };
      let outDisplayId = '';
      let outWhere = '';
      if ('displayId' in to && to.displayId) {
        const d = displays.get(to.displayId) ?? fail('That display was removed meanwhile.');
        outDisplayId = d.id;
        outWhere = d.name;
      } else if ('where' in to) outWhere = to.where.trim();
      const next: Item = { ...item, status: 'out', outDisplayId, outWhere, outSince: item.status === 'out' ? item.outSince : now, lentTo: '', lentOn: '' };
      if (next.status !== item.status || next.outDisplayId !== item.outDisplayId || next.outWhere !== item.outWhere) changed.push({ ...next, updatedAt: now });
    }
    if (changed.length) await db.items.bulkPut(changed);
    await touch(db, now);
    return changed.length;
  });
}

/** Back to `stored` in its home (an unticked setup line, Put back). Clears where it was out. Returns how many changed. */
export async function putBack(db: InventoryDb, ids: readonly string[], now = Date.now()): Promise<number> {
  return db.transaction('rw', db.items, db.settings, async () => {
    const rows = await db.items.bulkGet([...new Set(ids)]);
    if (rows.some((r) => !r)) fail('An item was deleted meanwhile. Nothing changed.');
    const changing = rows.filter((r) => r!.status === 'out').map((r) => ({ ...r!, status: 'stored' as const, outWhere: '', outDisplayId: '', outSince: null, updatedAt: now }));
    if (changing.length) await db.items.bulkPut(changing);
    await touch(db, now);
    return changing.length;
  });
}

/**
 * Unpack (F5): the chosen items of a bin go out (each on its place, else its usual display),
 * and the bin is set `out` too when `binOut`. One transaction, so a bin is never half unpacked.
 */
export async function unpackBin(db: InventoryDb, binId: string, items: readonly { id: string; to?: OutPlace }[], binOut: boolean, now = Date.now()): Promise<number> {
  return db.transaction('rw', db.bins, db.items, db.displays, db.settings, async () => {
    const bin = (await db.bins.get(binId)) ?? fail('This bin was deleted meanwhile.');
    for (const row of await db.items.bulkGet(items.map((i) => i.id))) if (row && row.binId !== binId) fail(`“${row.name}” isn't in ${bin.code} any more.`);
    const n = items.length ? await putOut(db, items, now) : 0;
    if (binOut && bin.state !== 'out') await db.bins.put({ ...bin, state: 'out' });
    await touch(db, now);
    return n;
  });
}
