import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Time-based one-time codes (RFC 6238: HMAC-SHA1, 30-second steps, 6 digits), the kind every
 * authenticator app produces, and the one-time recovery codes that stand in for a lost phone.
 * scripts/setup-mfa.mjs makes the secret and the recovery codes; its output must verify here
 * (api/_lib/totp.test.ts checks both against each other and against the RFC's test vectors).
 */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_SECONDS = 30;

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[\s=-]/g, '');
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of clean) {
    const index = ALPHABET.indexOf(ch);
    if (index < 0) throw new Error('invalid base32 character');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((value >>> bits) & 0xff);
      value &= (1 << bits) - 1;
    }
  }
  return Buffer.from(out);
}

/** RFC 4226 HOTP: the code for one counter value. */
export function hotp(key: Buffer, counter: number, digits = 6): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const hash = createHmac('sha1', key).update(message).digest();
  const offset = hash[hash.length - 1] & 0x0f;
  const binary =
    ((hash[offset] & 0x7f) << 24) | (hash[offset + 1] << 16) | (hash[offset + 2] << 8) | hash[offset + 3];
  return String(binary % 10 ** digits).padStart(digits, '0');
}

export function timeStep(nowMs: number): number {
  return Math.floor(nowMs / 1000 / STEP_SECONDS);
}

/**
 * Checks a 6-digit code against the secret, allowing one step either side for clock drift.
 * Returns the matching time step (so the caller can refuse the same code twice), or null.
 */
export function verifyTotp(secretBase32: string, code: string, nowMs = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  let key: Buffer;
  try {
    key = base32Decode(secretBase32);
  } catch {
    return null;
  }
  if (key.length === 0) return null;
  const given = Buffer.from(code);
  const now = timeStep(nowMs);
  let match: number | null = null;
  // Check every step (no early exit), so timing doesn't reveal which one matched.
  for (const step of [now - 1, now, now + 1]) {
    if (timingSafeEqual(Buffer.from(hotp(key, step)), given)) match = step;
  }
  return match;
}

/** Recovery codes are compared without case, spaces or dashes: 'ABCD-efgh 23' = 'abcdefgh23'. */
export function normaliseRecoveryCode(code: string): string {
  return code.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** What AUTH_RECOVERY_CODES stores: SHA-256 hex of each normalised code (codes are random, so no salt is needed). */
export function hashRecoveryCode(code: string): string {
  return createHash('sha256').update(normaliseRecoveryCode(code)).digest('hex');
}
