import { emailConfigured } from './_lib/email.js';
import { mfaSwitchedOff } from './_lib/mfa.js';
import { storeHealth } from './_lib/store.js';
import { pushKeys } from './_lib/webpush.js';

/**
 * GET /api/health: whether this deployment can serve, for a monitor or a check after a deploy.
 * Public and read-only: it reads no one's data and gives no error details (those go to the log),
 * only which store is in use, whether each part works, and whether the sign-in code is switched
 * off. 200 when the store answers and the push keys are usable (or not set up); 503 otherwise.
 *
 * Each call wakes the database: on a plan that sleeps when idle, poll it every 30 minutes or less
 * often, not every minute.
 */
export async function GET(): Promise<Response> {
  const store = await storeHealth();
  const push = pushKeys();
  const ok = store.ok && push !== 'invalid';
  return Response.json(
    { ok, store: store.store, database: store.ok ? 'ok' : 'failing', push, email: emailConfigured() ? 'on' : 'off', mfa: mfaSwitchedOff() ? 'off' : 'on' },
    { status: ok ? 200 : 503, headers: { 'Cache-Control': 'no-store' } },
  );
}
