/**
 * Where Ledger keeps its data, behind one module (build plan decision 5): Postgres when
 * DATABASE_URL is set (build plan Step 1a), otherwise today's Upstash Redis store. The /api
 * functions call only this, so switching stores touches no handler.
 *
 * Every function that reads or writes someone's data takes their user id. Redis holds one user
 * (ONLY_USER); Postgres holds any number, each walled off by row-level security.
 */
import { createHash } from 'node:crypto';
import type { PushSubscription } from 'web-push';
import { STATE_VERSION, type StoredState } from '../../src/shared/state.js';
import * as pgAuth from './auth/pgAuth.js';
import { appPool, databaseConfigured, withUser } from './db/client.js';
import { rowsToDocument } from './db/mapping.js';
import { readRows } from './db/rows.js';
import { syncDocument as pgSync } from './db/sync.js';
import { mfaConfigured, mfaSwitchedOff } from './mfa.js';
import * as redis from './redisStore.js';
import { bearerToken, revokeAllSessions, revokeSession, sessionValid } from './session.js';

export const ONLY_USER = 'owner';

export function onPostgres(): boolean {
  return databaseConfigured();
}

export function subscriptionId(endpoint: string): string {
  return createHash('sha256').update(endpoint).digest('hex');
}

// ---- Health -----------------------------------------------------------------------------------

export interface StoreHealth {
  store: 'postgres' | 'redis';
  ok: boolean;
}

/**
 * Whether the store answers, reading no one's data. On Postgres the app's own role asks which
 * workspaces it can see with no user signed in: that proves the connection, the login, the
 * migrations (the app schema) and the workspace walls, and the answer must be none.
 */
export async function storeHealth(): Promise<StoreHealth> {
  const store = onPostgres() ? 'postgres' : 'redis';
  try {
    if (store === 'postgres') {
      const r = await appPool().query<{ n: number }>('select cardinality(app.workspace_ids()) as n');
      if (r.rows[0]?.n !== 0) throw new Error(`with no user the app role sees ${r.rows[0]?.n} workspaces`);
    } else if ((await redis.ping()) !== 'PONG') throw new Error('Redis did not answer PONG');
    return { store, ok: true };
  } catch (e) {
    // Logged here, never sent: driver errors can name hosts and roles.
    console.error('Health check: the store failed:', (e as Error).message);
    return { store, ok: false };
  }
}

// ---- Sign-in ----------------------------------------------------------------------------------

/** What the sign-in form must ask for. On Postgres: an email, and a code unless AUTH_MFA=off. */
export function loginOptions(): { mfa: boolean; email: boolean } {
  return onPostgres() ? { mfa: !mfaSwitchedOff(), email: true } : { mfa: mfaConfigured(), email: false };
}

export type SignInResult = redis.SignInResult;

export async function signIn(input: { email?: unknown; password: unknown; code: unknown; ip: string }): Promise<SignInResult> {
  if (!onPostgres()) return redis.signIn(input);
  const db = appPool();
  if (!(await pgAuth.loginAllowed(db, input.ip))) return 'rate-limited';
  const userId = await pgAuth.signIn(db, { email: input.email, password: input.password, code: input.code }, !mfaSwitchedOff());
  return userId ? { token: await pgAuth.createSession(db, userId) } : 'incorrect';
}

/** The signed-in user for this request (renewing the session), or null. */
export async function requestUser(req: any): Promise<string | null> {
  const token = bearerToken(req);
  if (!onPostgres()) return (await sessionValid(token)) ? ONLY_USER : null;
  return pgAuth.sessionUser(appPool(), token);
}

/** Answers 401 and returns null when the request has no valid session. */
export async function requireUser(req: any, res: any): Promise<string | null> {
  const user = await requestUser(req);
  if (!user) res.status(401).json({ error: 'unauthorized' });
  return user;
}

/** Ends this session, or (everywhere) every session of the user and every push subscription. */
export async function signOut(req: any, userId: string, everywhere: boolean): Promise<void> {
  const token = bearerToken(req);
  if (!onPostgres()) {
    if (everywhere) {
      await revokeAllSessions();
      await redis.removeAllPushSubscriptions();
    } else await revokeSession(token);
    return;
  }
  const db = appPool();
  if (!everywhere) return pgAuth.endSession(db, token);
  await pgAuth.endAllSessions(db, userId);
  await withUser(db, userId, (c) => c.query('delete from push_subscriptions where user_id = $1', [userId]));
}

// ---- The synced document ----------------------------------------------------------------------

/** The user's document, or null when they have none yet (a device then uploads its own). */
export async function readDocument(userId: string): Promise<StoredState | null> {
  if (!onPostgres()) return redis.readDocument();
  const rows = await withUser(appPool(), userId, (c) => readRows(c, userId));
  return rows.workspaces.length ? { state: rowsToDocument(rows), version: STATE_VERSION } : null;
}

/** Merges a device's upload (newest edit wins, item by item) and returns the result; null if it couldn't be saved (retry). */
export async function syncDocument(userId: string, incoming: StoredState): Promise<StoredState | null> {
  if (!onPostgres()) return redis.syncDocument(incoming);
  return { state: await withUser(appPool(), userId, (c) => pgSync(c, userId, incoming.state)), version: STATE_VERSION };
}

// ---- Push subscriptions -----------------------------------------------------------------------

export async function pushSubscriptions(userId: string): Promise<PushSubscription[]> {
  if (!onPostgres()) return redis.pushSubscriptions();
  const r = await withUser(appPool(), userId, (c) => c.query<{ subscription: PushSubscription }>('select subscription from push_subscriptions'));
  return r.rows.map((row) => row.subscription);
}

export async function savePushSubscription(userId: string, sub: PushSubscription): Promise<void> {
  const id = subscriptionId(sub.endpoint);
  if (!onPostgres()) return redis.savePushSubscription(id, sub);
  await withUser(appPool(), userId, (c) =>
    c.query(
      `insert into push_subscriptions (user_id, endpoint_hash, subscription) values ($1, $2, $3)
       on conflict (user_id, endpoint_hash) do update set subscription = excluded.subscription`,
      [userId, id, JSON.stringify(sub)],
    ),
  );
}

export async function removePushSubscription(userId: string, endpoint: string): Promise<void> {
  const id = subscriptionId(endpoint);
  if (!onPostgres()) return redis.removePushSubscription(id);
  await withUser(appPool(), userId, (c) => c.query('delete from push_subscriptions where endpoint_hash = $1', [id]));
}

// ---- Reminders (the 15-minute timer) ----------------------------------------------------------

/**
 * Everyone whose reminders the timer handles. One user after another: fine for a few users; with
 * many, the timer would need batching to stay within the function's time limit.
 */
export async function reminderUsers(): Promise<string[]> {
  if (!onPostgres()) return [ONLY_USER];
  return (await appPool().query<{ id: string }>('select id from users order by created_at')).rows.map((r) => r.id);
}

/** True only for the first run to claim this reminder for this user, so it is sent once; claims last ttlSeconds. */
export async function claimReminder(userId: string, key: string, ttlSeconds: number): Promise<boolean> {
  if (!onPostgres()) return redis.claimReminder(key, ttlSeconds);
  return withUser(appPool(), userId, async (c) => {
    await c.query('delete from reminders_sent where sent_at < now() - make_interval(secs => $1)', [ttlSeconds]);
    const r = await c.query('insert into reminders_sent (user_id, reminder_key) values ($1, $2) on conflict do nothing returning 1', [userId, key]);
    return r.rowCount === 1;
  });
}

export async function releaseReminder(userId: string, key: string): Promise<void> {
  if (!onPostgres()) return redis.releaseReminder(key);
  await withUser(appPool(), userId, (c) => c.query('delete from reminders_sent where reminder_key = $1', [key]));
}
