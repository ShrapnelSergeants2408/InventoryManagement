import 'fake-indexeddb/auto';
import JSZip from 'jszip';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildBackup } from '../src/data/backup';
import { InventoryDb } from '../src/data/db';
import { replaceAll } from '../src/data/inventory';
import { MAX_TRIES, PIN_KEY, RECOVERY_KEY, WAIT_MS, checkRecoveryCode, hasPin, resetTries, savePin, savePinAndRecovery, tryPin, waitRemaining } from '../src/data/pin';
import { setSettings } from '../src/data/settings';
import { checkSettings } from '../src/domain/settings-limits';
import { TEAM_ID_ALPHABET } from '../src/domain/ids';
import { gate, setGateAsk } from '../src/security/gate';
import { formatRemaining, isUnlocked, lockNow, onLockChange, unlockFor, unlockRemaining } from '../src/security/lock';
import { formatRecoveryCode, hashSecret, newRecoveryCode, normalizeRecoveryCode, validPin, verifySecret } from '../src/security/pin';
import { item } from './helpers';

const dbs: InventoryDb[] = [];
afterEach(() => {
  for (const d of dbs.splice(0)) d.close();
  lockNow();
  resetTries();
  setGateAsk(null);
  vi.useRealTimers();
});
const newDb = () => {
  const d = new InventoryDb(`pin-${Math.random()}`);
  dbs.push(d);
  return d;
};

const MIN = 60_000;

describe('PIN format (§6: 4–6 digits only)', () => {
  it('accepts 4, 5 and 6 digits', () => {
    for (const p of ['0000', '2408', '12345', '000000']) expect(validPin(p), p).toBe(true);
  });
  it('rejects anything else', () => {
    for (const p of ['', '123', '1234567', '12a4', ' 1234', '1234 ', '12 34', '-123', '1.23', '١٢٣٤', '１２３４']) expect(validPin(p), JSON.stringify(p)).toBe(false);
  });
});

describe('hashing (D6: PBKDF2-SHA256, random salt)', () => {
  it('verifies the right secret and nothing else', async () => {
    const h = await hashSecret('2408');
    expect(h.alg).toBe('PBKDF2-SHA256');
    expect(h.iter).toBeGreaterThanOrEqual(100_000);
    expect(JSON.stringify(h)).not.toContain('2408');
    expect(await verifySecret('2408', h)).toBe(true);
    for (const wrong of ['2409', '24080', '240', '']) expect(await verifySecret(wrong, h), wrong).toBe(false);
  });
  it('uses a new salt every time, and the stored iteration count', async () => {
    const [a, b] = await Promise.all([hashSecret('2408', 1000), hashSecret('2408', 1000)]);
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
    expect(await verifySecret('2408', a)).toBe(true);
    expect(await verifySecret('2408', { ...a, iter: 1001 })).toBe(false);
  });
});

describe('recovery code (D6: 10 characters)', () => {
  it('is 10 characters from the look-alike-free alphabet, different each time', () => {
    const codes = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const c = newRecoveryCode();
      expect(c).toMatch(new RegExp(`^[${TEAM_ID_ALPHABET}]{10}$`));
      codes.add(c);
    }
    expect(codes.size).toBe(200);
  });
  it('is shown as two groups of five; capitals, spaces and the dash don’t matter when typed', () => {
    expect(formatRecoveryCode('K7QM4D2X9H')).toBe('K7QM4-D2X9H');
    expect(normalizeRecoveryCode(' k7qm4-d2x9h ')).toBe('K7QM4D2X9H');
    expect(normalizeRecoveryCode('K7QM4 D2X9H')).toBe('K7QM4D2X9H');
  });
});

describe('unlock timer (§6)', () => {
  beforeEach(() => vi.useFakeTimers({ now: Date.UTC(2026, 9, 18, 15, 0) }));

  it('expires at exactly the unlock length and tells listeners', () => {
    let changes = 0;
    const off = onLockChange(() => changes++);
    unlockFor(5 * MIN);
    expect(changes).toBe(1);
    expect(isUnlocked()).toBe(true);
    expect(formatRemaining(unlockRemaining())).toBe('5:00');
    vi.advanceTimersByTime(5 * MIN - 1);
    expect(isUnlocked()).toBe(true);
    expect(formatRemaining(unlockRemaining())).toBe('0:01');
    vi.advanceTimersByTime(1);
    expect(isUnlocked()).toBe(false);
    expect(unlockRemaining()).toBe(0);
    expect(changes).toBe(2);
    off();
  });

  it('the lock button locks immediately', () => {
    unlockFor(5 * MIN);
    vi.advanceTimersByTime(MIN);
    lockNow();
    expect(isUnlocked()).toBe(false);
    // The old timer doesn't fire into a later unlock.
    unlockFor(10 * MIN);
    vi.advanceTimersByTime(4 * MIN + 1);
    expect(isUnlocked()).toBe(true);
  });

  it('counts down as m:ss', () => {
    expect(formatRemaining(4 * MIN + 10_000)).toBe('4:10');
    expect(formatRemaining(9_001)).toBe('0:10');
    expect(formatRemaining(30 * MIN)).toBe('30:00');
  });
});

describe('gate', () => {
  it('asks while locked and goes ahead at once while unlocked', async () => {
    const asked: string[] = [];
    setGateAsk(async (r) => {
      asked.push(r);
      return false;
    });
    expect(await gate('Deleting an item needs the mentor PIN.')).toBe(false);
    unlockFor(5 * MIN);
    expect(await gate('Deleting an item needs the mentor PIN.')).toBe(true);
    expect(asked).toEqual(['Deleting an item needs the mentor PIN.']);
  });
  it('allows nothing when no PIN pad is registered', async () => {
    expect(await gate('x')).toBe(false);
  });
});

describe('PIN on the tablet', () => {
  it('first-launch setup saves the PIN and recovery code hashed', async () => {
    const db = newDb();
    expect(await hasPin(db)).toBe(false);
    await savePinAndRecovery(db, '2408', 'K7QM4D2X9H');
    expect(await hasPin(db)).toBe(true);
    const rows = JSON.stringify(await db.settings.bulkGet([PIN_KEY, RECOVERY_KEY]));
    expect(rows).not.toContain('2408');
    expect(rows).not.toContain('K7QM4D2X9H');
    await expect(savePinAndRecovery(db, '123', 'K7QM4D2X9H')).rejects.toThrow('4 to 6 digits');
  });

  it('a right PIN unlocks for the unlock-length setting', async () => {
    vi.useFakeTimers({ now: Date.UTC(2026, 9, 18, 15, 0), toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    const db = newDb();
    await savePinAndRecovery(db, '2408', 'K7QM4D2X9H');
    await setSettings(db, { unlockMinutes: 2 });
    expect(await tryPin(db, '2408')).toEqual({ ok: true });
    expect(unlockRemaining()).toBe(2 * MIN);
    vi.advanceTimersByTime(2 * MIN);
    expect(isUnlocked()).toBe(false);
  });

  it('counts wrong tries; the 5th starts a 30-second wait that even the right PIN can’t skip', async () => {
    const db = newDb();
    await savePinAndRecovery(db, '2408', 'K7QM4D2X9H');
    const t0 = Date.now();
    for (let i = 1; i < MAX_TRIES; i++) expect(await tryPin(db, '1111', t0)).toEqual({ ok: false, wrong: i, waitMs: 0 });
    expect(await tryPin(db, '1111', t0)).toEqual({ ok: false, wrong: 5, waitMs: WAIT_MS });
    expect(waitRemaining(t0 + 1000)).toBe(WAIT_MS - 1000);
    expect(await tryPin(db, '2408', t0 + WAIT_MS - 1)).toEqual({ ok: false, wrong: 5, waitMs: 1 });
    expect(isUnlocked()).toBe(false);
    expect(await tryPin(db, '2408', t0 + WAIT_MS)).toEqual({ ok: true });
    // A right PIN starts the count again.
    lockNow();
    expect(await tryPin(db, '1111', t0 + WAIT_MS)).toEqual({ ok: false, wrong: 1, waitMs: 0 });
  });

  it('a malformed PIN is never checked and isn’t counted', async () => {
    const db = newDb();
    await savePinAndRecovery(db, '2408', 'K7QM4D2X9H');
    expect(await tryPin(db, '24')).toEqual({ ok: false, wrong: 0, waitMs: 0 });
    expect(isUnlocked()).toBe(false);
  });

  it('change PIN keeps the recovery code', async () => {
    const db = newDb();
    await savePinAndRecovery(db, '2408', 'K7QM4D2X9H');
    await savePin(db, '135790');
    expect((await tryPin(db, '2408')).ok).toBe(false);
    expect((await tryPin(db, '135790')).ok).toBe(true);
    expect((await checkRecoveryCode(db, 'k7qm4-d2x9h')).ok).toBe(true);
  });

  it('the recovery code works once: setting the new PIN replaces it', async () => {
    const db = newDb();
    await savePinAndRecovery(db, '2408', 'K7QM4D2X9H');
    expect((await checkRecoveryCode(db, 'K7QM4-D2X9H')).ok).toBe(true);
    // Checking alone changes nothing (the flow can still be cancelled).
    expect((await tryPin(db, '2408')).ok).toBe(true);
    lockNow();
    await savePinAndRecovery(db, '9999', 'ABCDE23456');
    expect((await checkRecoveryCode(db, 'K7QM4D2X9H')).ok).toBe(false);
    expect((await checkRecoveryCode(db, 'abcde-23456')).ok).toBe(true);
    expect((await tryPin(db, '2408')).ok).toBe(false);
    expect((await tryPin(db, '9999')).ok).toBe(true);
  });

  it('wrong recovery codes count toward the same wait', async () => {
    const db = newDb();
    await savePinAndRecovery(db, '2408', 'K7QM4D2X9H');
    const t0 = Date.now();
    for (let i = 0; i < MAX_TRIES; i++) await checkRecoveryCode(db, 'WRONGCODE2', t0);
    expect(await checkRecoveryCode(db, 'K7QM4D2X9H', t0 + 1)).toEqual({ ok: false, wrong: 5, waitMs: WAIT_MS - 1 });
  });

  it('no PIN set: nothing unlocks', async () => {
    const db = newDb();
    expect((await tryPin(db, '2408')).ok).toBe(false);
    expect(isUnlocked()).toBe(false);
  });

  it('the PIN and recovery code are never in a backup (§7)', async () => {
    const db = newDb();
    await replaceAll(db, { items: [item({ id: 'st-0001' })], photos: new Map(), suppliers: [{ name: 'REV', website: '', notes: '' }, { name: 'other', website: '', notes: '' }], locations: [], categories: [] });
    await savePinAndRecovery(db, '2408', 'K7QM4D2X9H');
    const blob = await buildBackup(db, 'full', new Date());
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const text = (await Promise.all(Object.values(zip.files).map((f) => f.async('string')))).join('\n');
    for (const s of ['pinHash', 'recoveryHash', 'PBKDF2']) expect(text).not.toContain(s);
  });
});

describe('settings limits (§6, S9)', () => {
  it('accepts whole numbers in range', () => {
    expect(checkSettings({ reminderDays: '7', staleDays: '90', unlockMinutes: '5' })).toEqual({ ok: true, value: { reminderDays: 7, staleDays: 90, unlockMinutes: 5 } });
    expect(checkSettings({ reminderDays: ' 1 ', staleDays: '365', unlockMinutes: '30' }).ok).toBe(true);
  });
  it('names every bad field', () => {
    const r = checkSettings({ reminderDays: '0', staleDays: '7.5', unlockMinutes: '31' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(['reminderDays', 'staleDays', 'unlockMinutes']);
    for (const bad of ['', '-1', '1e1', 'abc', '61']) expect(checkSettings({ reminderDays: bad, staleDays: '90', unlockMinutes: '5' }).ok, bad).toBe(false);
    expect(checkSettings({ reminderDays: '7', staleDays: '6', unlockMinutes: '5' }).ok).toBe(false);
  });
});
