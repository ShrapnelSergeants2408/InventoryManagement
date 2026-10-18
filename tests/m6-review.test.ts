// Independent fresh-session review of M6 (docs/reviews/M6-independent.md): findings shown at
// the data layer. Each asserts the behaviour the review describes. F-A and F-D are fixed in the
// UI (the PIN pad recovers from a failed check; gated dialogs close on relock and Delete asks
// again), which scripts/m6-ui-check.mjs covers; F-B and F-C are left as they are (low).
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InventoryDb } from '../src/data/db';
import { MAX_TRIES, PIN_KEY, resetTries, savePinAndRecovery, tryPin, waitRemaining } from '../src/data/pin';
import { getSettings, setSettings } from '../src/data/settings';
import { gate, setGateAsk } from '../src/security/gate';
import { isUnlocked, lockNow, unlockFor } from '../src/security/lock';

const dbs: InventoryDb[] = [];
afterEach(() => {
  for (const d of dbs.splice(0)) d.close();
  lockNow();
  resetTries();
  setGateAsk(null);
  vi.useRealTimers();
});
const newDb = () => {
  const d = new InventoryDb(`m6r-${Math.random()}`);
  dbs.push(d);
  return d;
};
const DAY = 86_400_000;

describe('F-A: tryPin can reject; GateHost.submit has no try/finally, so the pad stays busy for good', () => {
  it('a stored hash that isSecretHash accepts but cannot be used makes tryPin reject (not resolve false)', async () => {
    const db = newDb();
    await savePinAndRecovery(db, '2408', 'K7QM4D2X9H');
    const row = await db.settings.get(PIN_KEY);
    await db.settings.put({ key: PIN_KEY, value: { ...(row!.value as object), iter: 0 } });
    await expect(tryPin(db, '2408')).rejects.toThrow();
  });
  it('a closed database makes tryPin reject', async () => {
    const db = newDb();
    await savePinAndRecovery(db, '2408', 'K7QM4D2X9H');
    db.close();
    await expect(tryPin(db, '2408')).rejects.toThrow();
  });
});

describe('F-B: settings limits are UI-only; the data layer stores anything', () => {
  it('setSettings accepts out-of-range values and getSettings returns them', async () => {
    const db = newDb();
    await setSettings(db, { unlockMinutes: 0, staleDays: -5, reminderDays: 1.5 });
    expect(await getSettings(db)).toMatchObject({ unlockMinutes: 0, staleDays: -5, reminderDays: 1.5 });
  });
  it('with unlockMinutes 0 a right PIN reports ok (GateHost answers true, the action goes ahead) yet nothing is unlocked', async () => {
    const db = newDb();
    await savePinAndRecovery(db, '2408', 'K7QM4D2X9H');
    await setSettings(db, { unlockMinutes: 0 });
    expect(await tryPin(db, '2408')).toEqual({ ok: true });
    expect(isUnlocked()).toBe(false);
  });
});

describe('F-C: the 5-wrong-tries wait', () => {
  it('lives in module memory: a reload (fresh module) forgets the wait and the count', async () => {
    const db = newDb();
    await savePinAndRecovery(db, '2408', 'K7QM4D2X9H');
    const t0 = Date.now();
    for (let i = 0; i < MAX_TRIES; i++) await tryPin(db, '1111', t0);
    expect(waitRemaining(t0)).toBe(30_000);
    vi.resetModules();
    const fresh = await import('../src/data/pin');
    expect(fresh.waitRemaining(t0)).toBe(0);
    expect((await fresh.tryPin(db, '2408', t0 + 1)).ok).toBe(true);
    fresh.resetTries();
    (await import('../src/security/lock')).lockNow();
  });
  it('the count never decays: 4 wrong tries on Monday + 1 on Friday = an immediate 30 s wait', async () => {
    const db = newDb();
    await savePinAndRecovery(db, '2408', 'K7QM4D2X9H');
    const mon = Date.now();
    for (let i = 0; i < 4; i++) await tryPin(db, '1111', mon);
    const fri = mon + 4 * DAY;
    expect(await tryPin(db, '1111', fri)).toEqual({ ok: false, wrong: 5, waitMs: 30_000 });
  });
  it('is wall-clock based: setting the clock back an hour during the wait makes it an hour longer', async () => {
    const db = newDb();
    await savePinAndRecovery(db, '2408', 'K7QM4D2X9H');
    const t0 = Date.now();
    for (let i = 0; i < MAX_TRIES; i++) await tryPin(db, '1111', t0);
    expect(waitRemaining(t0 - 3_600_000)).toBe(3_600_000 + 30_000);
  });
});

describe('F-D: the unlock is decided once, at gate() time', () => {
  it('gate() resolves true just before relock; nothing re-checks when the follow-up dialog submits', async () => {
    vi.useFakeTimers({ now: Date.UTC(2026, 9, 18, 15, 0) });
    setGateAsk(async () => false);
    unlockFor(1000);
    vi.advanceTimersByTime(999);
    const ok = await gate('Deleting an item needs the mentor PIN.'); // DeleteItem opens its confirm here
    vi.advanceTimersByTime(60 * 60_000); // the confirm sits open for an hour
    expect(ok).toBe(true);
    expect(isUnlocked()).toBe(false); // ...and "Delete item" in the confirm calls deleteItem() directly
  });
  it('sleep: wall clock passing without timers firing still locks (correct behaviour)', async () => {
    vi.useFakeTimers({ now: Date.UTC(2026, 9, 18, 15, 0) });
    unlockFor(5 * 60_000);
    vi.setSystemTime(Date.UTC(2026, 9, 18, 15, 6)); // timers suspended, clock moved on
    expect(isUnlocked()).toBe(false);
  });
});
