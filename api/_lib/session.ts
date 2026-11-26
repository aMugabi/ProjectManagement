import { Redis } from '@upstash/redis';
import { createHash, randomBytes } from 'node:crypto';
import { SESSION_PREFIX } from './keys.js';

export const kv = Redis.fromEnv();

/** Sessions last 30 days and renew on every use. Only a hash of the token is stored. */
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

function sessionKey(token: string): string {
  return SESSION_PREFIX + createHash('sha256').update(token).digest('hex');
}

export function bearerToken(req: any): string {
  const auth = req.headers?.authorization ?? '';
  return typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.slice(7) : '';
}

export async function createSession(): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await kv.set(sessionKey(token), 1, { ex: SESSION_TTL_SECONDS });
  return token;
}

/** Whether the token is a live session, renewing it if so. */
export async function sessionValid(token: string): Promise<boolean> {
  // EXPIRE returns 1 only when the key exists, so this checks and renews in one call.
  return Boolean(token) && (await kv.expire(sessionKey(token), SESSION_TTL_SECONDS)) === 1;
}

export async function revokeSession(token: string): Promise<void> {
  await kv.del(sessionKey(token));
}

export async function revokeAllSessions(): Promise<void> {
  let cursor: string | number = 0;
  do {
    const [next, keys]: [string | number, string[]] = await kv.scan(cursor, { match: `${SESSION_PREFIX}*`, count: 100 });
    if (keys.length) await kv.del(...keys);
    cursor = next;
  } while (String(cursor) !== '0');
}
