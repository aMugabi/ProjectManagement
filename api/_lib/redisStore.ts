/**
 * Today's store: everything in Upstash Redis, for one user (the password in AUTH_PASSWORD_HASH,
 * MFA from AUTH_TOTP_SECRET). Used by api/_lib/store.ts when DATABASE_URL isn't set; moved here
 * unchanged from the /api functions so that store.ts is the only thing they call.
 */
import { Ratelimit } from '@upstash/ratelimit';
import type { PushSubscription } from 'web-push';
import { mergeStates } from '../../src/shared/merge.js';
import { normalizeState, STATE_VERSION, type StoredState } from '../../src/shared/state.js';
import { LOGIN_ALL_PREFIX, LOGIN_IP_PREFIX, PUSH_SUBS_KEY, SENT_PREFIX, STATE_KEY, STATE_REV_KEY } from './keys.js';
import { checkSecondFactor, mfaConfigured } from './mfa.js';
import { isLegacyHash, verifyPassword } from './password.js';
import { createSession, kv } from './session.js';

// 5 attempts per 15 minutes per IP, plus a global cap so rotating IPs can't brute-force either.
// Made on first use, so modules that only read state don't build them.
let limiters: { perIp: Ratelimit; overall: Ratelimit } | null = null;
function loginLimiters() {
  limiters ??= {
    perIp: new Ratelimit({ redis: kv, limiter: Ratelimit.slidingWindow(5, '15 m'), prefix: LOGIN_IP_PREFIX }),
    overall: new Ratelimit({ redis: kv, limiter: Ratelimit.slidingWindow(50, '1 h'), prefix: LOGIN_ALL_PREFIX }),
  };
  return limiters;
}

export type SignInResult = { token: string } | 'incorrect' | 'rate-limited' | 'not-configured';

/** One user: the password, then (with MFA on) an authenticator or recovery code. */
export async function signIn(input: { password: unknown; code: unknown; ip: string }): Promise<SignInResult> {
  const stored = process.env.AUTH_PASSWORD_HASH;
  if (!stored) return 'not-configured';
  const { perIp, overall } = loginLimiters();
  const [ip, all] = await Promise.all([perIp.limit(input.ip), overall.limit('all')]);
  if (!ip.success || !all.success) return 'rate-limited';
  const password = input.password;
  const passwordOk = typeof password === 'string' && Boolean(password) && verifyPassword(password, stored);
  // The code is only checked (and so only used up) once the password is right.
  if (!passwordOk || (mfaConfigured() && !(await checkSecondFactor(input.code)))) return 'incorrect';
  if (isLegacyHash(stored)) {
    console.warn('AUTH_PASSWORD_HASH is a legacy SHA-256 hash; replace it with `npm run hash-password` output.');
  }
  return { token: await createSession() };
}

export async function readDocument(): Promise<StoredState | null> {
  return (await kv.get<StoredState>(STATE_KEY)) ?? null;
}

// Compare-and-set: write only if nobody else wrote since we read.
const CAS_SCRIPT = `
if (redis.call('GET', KEYS[2]) or '0') == ARGV[1] then
  redis.call('SET', KEYS[1], ARGV[2])
  redis.call('INCR', KEYS[2])
  return 1
end
return 0`;

/** Merges the upload into the stored copy task by task (newest edit wins), retrying if another write lands first; null after 3 tries. */
export async function syncDocument(incoming: StoredState): Promise<StoredState | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const [stored, rev] = await kv.mget<[StoredState | null, number | null]>(STATE_KEY, STATE_REV_KEY);
    const merged: StoredState = {
      state: stored ? mergeStates(stored.state, incoming.state, incoming.state.activeWorkspaceId) : normalizeState(incoming.state),
      version: STATE_VERSION,
    };
    const ok = await kv.eval(CAS_SCRIPT, [STATE_KEY, STATE_REV_KEY], [String(rev ?? 0), JSON.stringify(merged)]);
    if (ok === 1) return merged;
  }
  return null;
}

export async function pushSubscriptions(): Promise<PushSubscription[]> {
  const stored = (await kv.hgetall<Record<string, PushSubscription | string>>(PUSH_SUBS_KEY)) ?? {};
  return Object.values(stored).map((v) => (typeof v === 'string' ? (JSON.parse(v) as PushSubscription) : v));
}

export async function savePushSubscription(id: string, sub: PushSubscription): Promise<void> {
  await kv.hset(PUSH_SUBS_KEY, { [id]: JSON.stringify(sub) });
}

export async function removePushSubscription(id: string): Promise<void> {
  await kv.hdel(PUSH_SUBS_KEY, id);
}

export async function removeAllPushSubscriptions(): Promise<void> {
  await kv.del(PUSH_SUBS_KEY);
}

/** SET NX: true only for the first run to claim this reminder, so it is sent once. */
export async function claimReminder(key: string, ttlSeconds: number): Promise<boolean> {
  return (await kv.set(SENT_PREFIX + key, 1, { nx: true, ex: ttlSeconds })) === 'OK';
}

export async function releaseReminder(key: string): Promise<void> {
  await kv.del(SENT_PREFIX + key);
}
