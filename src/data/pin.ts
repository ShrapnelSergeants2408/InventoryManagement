// The mentor PIN and recovery code on this tablet (§6, D6). Both are stored hashed in the
// settings table under keys that backups never include (§7). Wrong tries are counted in
// memory: every 5th wrong PIN or recovery code in a row starts a 30-second wait (accident
// prevention, not security).
import { unlockFor } from '../security/lock';
import { hashSecret, isSecretHash, normalizeRecoveryCode, validPin, verifySecret, type SecretHash } from '../security/pin';
import type { InventoryDb } from './db';
import { getSettings } from './settings';

export const PIN_KEY = 'pinHash';
export const RECOVERY_KEY = 'recoveryHash';
export const MAX_TRIES = 5;
export const WAIT_MS = 30_000;

let wrong = 0;
let waitUntil = 0;

export type CheckResult = { ok: true } | { ok: false; wrong: number; waitMs: number };

async function stored(db: InventoryDb, key: string): Promise<SecretHash | null> {
  const row = await db.settings.get(key);
  return row && isSecretHash(row.value) ? row.value : null;
}

export async function hasPin(db: InventoryDb): Promise<boolean> {
  return (await stored(db, PIN_KEY)) !== null;
}

/** First-launch setup and recovery: the PIN and a new recovery code, saved together. */
export async function savePinAndRecovery(db: InventoryDb, pin: string, recoveryCode: string): Promise<void> {
  if (!validPin(pin)) throw new Error('The PIN must be 4 to 6 digits');
  const [p, r] = await Promise.all([hashSecret(pin), hashSecret(normalizeRecoveryCode(recoveryCode))]);
  await db.settings.bulkPut([
    { key: PIN_KEY, value: p },
    { key: RECOVERY_KEY, value: r },
  ]);
}

/** Change PIN: the recovery code stays as it is. */
export async function savePin(db: InventoryDb, pin: string): Promise<void> {
  if (!validPin(pin)) throw new Error('The PIN must be 4 to 6 digits');
  await db.settings.put({ key: PIN_KEY, value: await hashSecret(pin) });
}

export const waitRemaining = (now = Date.now()): number => Math.max(0, waitUntil - now);
export const wrongTries = (): number => wrong;

/** For tests: forget wrong tries and any wait. */
export function resetTries(): void {
  wrong = 0;
  waitUntil = 0;
}

async function check(db: InventoryDb, key: string, secret: string, now: number): Promise<CheckResult> {
  if (now < waitUntil) return { ok: false, wrong, waitMs: waitUntil - now };
  const hash = await stored(db, key);
  if (hash && (await verifySecret(secret, hash))) {
    wrong = 0;
    return { ok: true };
  }
  wrong++;
  if (wrong % MAX_TRIES === 0) waitUntil = now + WAIT_MS;
  return { ok: false, wrong, waitMs: waitRemaining(now) };
}

/** Checks the PIN; when right, unlocks mentor tools for the unlock length (§6). */
export async function tryPin(db: InventoryDb, pin: string, now = Date.now()): Promise<CheckResult> {
  if (!validPin(pin)) return { ok: false, wrong, waitMs: waitRemaining(now) };
  const r = await check(db, PIN_KEY, pin, now);
  if (r.ok) await unlockForSetting(db);
  return r;
}

/** Checks the recovery code. Nothing changes until a new PIN and code are saved. */
export function checkRecoveryCode(db: InventoryDb, typed: string, now = Date.now()): Promise<CheckResult> {
  return check(db, RECOVERY_KEY, normalizeRecoveryCode(typed), now);
}

export async function unlockForSetting(db: InventoryDb): Promise<void> {
  const { unlockMinutes } = await getSettings(db);
  unlockFor(unlockMinutes * 60_000);
}
