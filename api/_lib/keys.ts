/** Redis keys shared by the /api functions. */

/** The single-user task/project blob that src/lib/cloudStorage.ts reads and writes. */
export const STATE_KEY = 'ledger:state';
/** Bumped on every state write, so concurrent uploads can't silently overwrite each other's merge. */
export const STATE_REV_KEY = 'ledger:state-rev';
/** Hash of push subscriptions: sha256(endpoint) → subscription JSON. */
export const PUSH_SUBS_KEY = 'ledger:push-subs';
/** Prefix for "this reminder was already pushed" markers (see api/reminders.ts). */
export const SENT_PREFIX = 'ledger:sent:';
