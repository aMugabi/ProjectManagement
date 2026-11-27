/**
 * Sign-in on Postgres (build plan Step 1a): email and password, then an authenticator or recovery
 * code, which every user must have here (no factor, no sign-in: MFA can't quietly lapse). The
 * owner can switch the code off for everyone with AUTH_MFA=off (see mfa.ts); the keys stay stored.
 * Sessions are random tokens stored only as SHA-256, lasting 30 days from last use. Login
 * attempts are limited as before: 5 per 15 minutes per IP address, 50 an hour overall.
 * These tables have no row-level security (sign-in reads them before anyone is signed in), so
 * this module is the only code that touches them.
 */
import { createHash, randomBytes } from 'node:crypto';
import type { Queryable } from '../db/client.js';
import { verifyPassword } from '../password.js';
import { hashRecoveryCode, verifyTotp } from '../totp.js';
import { encryptionKey, open } from './secretBox.js';

export const SESSION_DAYS = 30;
export const LIMITS = { perIp: 5, perIpMinutes: 15, overall: 50, overallMinutes: 60 };

/** Checked when the email has no account, so the time taken doesn't reveal which emails exist. */
const NO_SUCH_HASH = `scrypt$${'00'.repeat(16)}$${'00'.repeat(64)}`;

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export async function createSession(db: Queryable, userId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await db.query('insert into sessions (token_hash, user_id, expires_at) values ($1, $2, now() + make_interval(days => $3))', [
    hashToken(token), userId, SESSION_DAYS,
  ]);
  return token;
}

/** The session's user, renewing it for another 30 days; null when missing or expired. */
export async function sessionUser(db: Queryable, token: string): Promise<string | null> {
  if (!token) return null;
  const r = await db.query<{ user_id: string }>(
    `update sessions set last_used_at = now(), expires_at = now() + make_interval(days => $2)
      where token_hash = $1 and expires_at > now() returning user_id`,
    [hashToken(token), SESSION_DAYS],
  );
  return r.rows[0]?.user_id ?? null;
}

export async function endSession(db: Queryable, token: string): Promise<void> {
  await db.query('delete from sessions where token_hash = $1', [hashToken(token)]);
}

export async function endAllSessions(db: Queryable, userId: string): Promise<void> {
  await db.query('delete from sessions where user_id = $1', [userId]);
}

/** Records this attempt; false when the address or everyone together has had too many recently. */
export async function loginAllowed(db: Queryable, ip: string): Promise<boolean> {
  await db.query("delete from login_attempts where at < now() - interval '1 day'");
  const r = await db.query<{ ip_n: number; all_n: number }>(
    `select (select count(*) from login_attempts where limit_key = $1 and at > now() - make_interval(mins => $2))::int ip_n,
            (select count(*) from login_attempts where limit_key = 'all' and at > now() - make_interval(mins => $3))::int all_n`,
    [`ip:${ip}`, LIMITS.perIpMinutes, LIMITS.overallMinutes],
  );
  await db.query("insert into login_attempts (limit_key) values ($1), ('all')", [`ip:${ip}`]);
  return r.rows[0].ip_n < LIMITS.perIp && r.rows[0].all_n < LIMITS.overall;
}

async function claim(db: Queryable, userId: string, codeKey: string): Promise<boolean> {
  const r = await db.query('insert into used_codes (user_id, code_key) values ($1, $2) on conflict do nothing returning 1', [userId, codeKey]);
  return r.rowCount === 1;
}

/** A valid, unused authenticator or recovery code for this user. Each works once. */
export async function secondFactorOk(db: Queryable, userId: string, code: unknown, nowMs = Date.now()): Promise<boolean> {
  const f = await db.query<{ totp_secret_encrypted: string; recovery_code_hashes: string[] }>(
    'select totp_secret_encrypted, recovery_code_hashes from mfa_factors where user_id = $1',
    [userId],
  );
  const factor = f.rows[0];
  if (!factor || typeof code !== 'string') return false;
  const compact = code.replace(/\s/g, '');
  if (/^\d{6}$/.test(compact)) {
    const secret = open(factor.totp_secret_encrypted, encryptionKey(), userId);
    const step = verifyTotp(secret, compact, nowMs);
    if (step === null) return false;
    await db.query("delete from used_codes where user_id = $1 and code_key like 'totp:%' and used_at < now() - interval '1 day'", [userId]);
    return claim(db, userId, `totp:${step}`);
  }
  const hash = hashRecoveryCode(compact);
  if (!factor.recovery_code_hashes.includes(hash) || !(await claim(db, userId, `recovery:${hash}`))) return false;
  console.warn('A recovery code was used to sign in.');
  return true;
}

/**
 * The user for this email, password and code, or null. A wrong email, password or code all get
 * the same answer, after the same password work.
 */
export async function signIn(
  db: Queryable,
  input: { email: unknown; password: unknown; code: unknown },
  secondFactor = true,
): Promise<string | null> {
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
  const password = typeof input.password === 'string' ? input.password : '';
  const r = await db.query<{ user_id: string; secret_hash: string | null }>(
    "select user_id, secret_hash from identities where provider = 'password' and subject = $1",
    [email],
  );
  const identity = r.rows[0];
  const passwordOk = verifyPassword(password, identity?.secret_hash ?? NO_SUCH_HASH);
  if (!identity || !password || !passwordOk) return null;
  if (!secondFactor) {
    console.warn('Signed in with a password only: the second factor is switched off (AUTH_MFA=off).');
    return identity.user_id;
  }
  return (await secondFactorOk(db, identity.user_id, input.code)) ? identity.user_id : null;
}
