/** Redis keys shared by the /api functions. */

/**
 * Namespace for every key. Production uses the default; setting LEDGER_KEY_PREFIX on another
 * environment (e.g. Vercel Preview, for testing) keeps its data, sessions and rate limits apart
 * even when it shares the same Redis database.
 */
export const KEY_PREFIX = process.env.LEDGER_KEY_PREFIX || 'ledger:';

/** The single-user task/project blob that src/lib/cloudStorage.ts reads and writes. */
export const STATE_KEY = `${KEY_PREFIX}state`;
/** Bumped on every state write, so concurrent uploads can't silently overwrite each other's merge. */
export const STATE_REV_KEY = `${KEY_PREFIX}state-rev`;
/** Hash of push subscriptions: sha256(endpoint) → subscription JSON. */
export const PUSH_SUBS_KEY = `${KEY_PREFIX}push-subs`;
/** Prefix for "this reminder was already pushed" markers (see api/reminders.ts). */
export const SENT_PREFIX = `${KEY_PREFIX}sent:`;
/** Prefix for hashed session tokens. */
export const SESSION_PREFIX = `${KEY_PREFIX}session:`;
/** Prefixes for the login rate limiters. */
export const LOGIN_IP_PREFIX = `${KEY_PREFIX}login-ip`;
export const LOGIN_ALL_PREFIX = `${KEY_PREFIX}login-all`;
