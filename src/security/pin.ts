// Mentor PIN and recovery code (§6, spec-questions D6): PBKDF2-SHA256 with a random salt
// (Web Crypto). The recovery code is 10 characters from the same look-alike-free alphabet
// as team ids (D1), shown as two groups of five and stored hashed like the PIN.
import { TEAM_ID_ALPHABET } from '../domain/ids';

export const PIN_PATTERN = /^\d{4,6}$/;
export const RECOVERY_LENGTH = 10;
/** Enough to make a stolen hash slow to guess; small enough to check in well under a second on the tablet. */
export const PBKDF2_ITERATIONS = 100_000;

export interface SecretHash {
  alg: 'PBKDF2-SHA256';
  iter: number;
  /** base64 */
  salt: string;
  /** base64 */
  hash: string;
}

export const validPin = (pin: string): boolean => PIN_PATTERN.test(pin);

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (s: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function derive(secret: string, salt: Uint8Array<ArrayBuffer>, iter: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, key, 256);
  return new Uint8Array(bits);
}

export async function hashSecret(secret: string, iter = PBKDF2_ITERATIONS): Promise<SecretHash> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { alg: 'PBKDF2-SHA256', iter, salt: b64(salt), hash: b64(await derive(secret, salt, iter)) };
}

export async function verifySecret(secret: string, stored: SecretHash): Promise<boolean> {
  const got = await derive(secret, unb64(stored.salt), stored.iter);
  const want = unb64(stored.hash);
  if (got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got[i]! ^ want[i]!;
  return diff === 0;
}

export function isSecretHash(v: unknown): v is SecretHash {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return o.alg === 'PBKDF2-SHA256' && typeof o.iter === 'number' && typeof o.salt === 'string' && typeof o.hash === 'string';
}

/** A new recovery code, unformatted (10 characters). */
export function newRecoveryCode(): string {
  // Rejection sampling keeps every character equally likely.
  const limit = 256 - (256 % TEAM_ID_ALPHABET.length);
  let s = '';
  while (s.length < RECOVERY_LENGTH) {
    for (const b of crypto.getRandomValues(new Uint8Array(16))) {
      if (b < limit && s.length < RECOVERY_LENGTH) s += TEAM_ID_ALPHABET[b % TEAM_ID_ALPHABET.length];
    }
  }
  return s;
}

/** "K7QM4D2X9H" → "K7QM4-D2X9H" */
export const formatRecoveryCode = (code: string): string => `${code.slice(0, 5)}-${code.slice(5)}`;

/** What the mentor typed, as hashed: capitals, without spaces or dashes. */
export const normalizeRecoveryCode = (typed: string): string => typed.toUpperCase().replace(/[\s-]/g, '');
