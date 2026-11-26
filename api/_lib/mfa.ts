import { RECOVERY_USED_PREFIX, TOTP_USED_PREFIX } from './keys.js';
import { kv } from './session.js';
import { hashRecoveryCode, verifyTotp } from './totp.js';

/**
 * The second sign-in factor: a code from an authenticator app, or a one-time recovery code.
 * On when AUTH_TOTP_SECRET is set (from `npm run setup-mfa`); AUTH_RECOVERY_CODES holds the
 * recovery codes' hashes, comma-separated. Until Step 1a moves sign-in into the database, these
 * live in the deployment's environment variables, like AUTH_PASSWORD_HASH.
 */
export function mfaConfigured(): boolean {
  return Boolean(process.env.AUTH_TOTP_SECRET);
}

/** Long enough to outlive the ±1 step window (90 s) a code is accepted in. */
const USED_CODE_TTL_SECONDS = 120;

/** True if `code` is a valid, not-yet-used authenticator or recovery code. Each works once. */
export async function checkSecondFactor(code: unknown, nowMs = Date.now()): Promise<boolean> {
  const secret = process.env.AUTH_TOTP_SECRET;
  if (!secret || typeof code !== 'string') return false;
  const compact = code.replace(/\s/g, '');

  if (/^\d{6}$/.test(compact)) {
    const step = verifyTotp(secret, compact, nowMs);
    if (step === null) return false;
    // Claim the step, so a code seen over someone's shoulder can't be used again.
    return (await kv.set(TOTP_USED_PREFIX + step, 1, { nx: true, ex: USED_CODE_TTL_SECONDS })) === 'OK';
  }

  const hash = hashRecoveryCode(compact);
  const valid = (process.env.AUTH_RECOVERY_CODES ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  if (!valid.includes(hash)) return false;
  // Recovery codes never expire, but each signs in once.
  if ((await kv.set(RECOVERY_USED_PREFIX + hash, 1, { nx: true })) !== 'OK') return false;
  console.warn('A recovery code was used to sign in. Run `npm run setup-mfa` for new codes when few are left.');
  return true;
}
