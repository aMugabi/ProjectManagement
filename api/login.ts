import { Ratelimit } from '@upstash/ratelimit';
import { isLegacyHash, verifyPassword } from './_lib/password.js';
import { bearerToken, createSession, kv, requireSession, revokeAllSessions, revokeSession } from './_lib/session.js';

// 5 attempts per 15 minutes per IP, plus a global cap so rotating IPs can't brute-force either.
const perIp = new Ratelimit({ redis: kv, limiter: Ratelimit.slidingWindow(5, '15 m'), prefix: 'ledger:login-ip' });
const global = new Ratelimit({ redis: kv, limiter: Ratelimit.slidingWindow(50, '1 h'), prefix: 'ledger:login-all' });

function clientIp(req: any): string {
  const forwarded = req.headers?.['x-forwarded-for'];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded ?? '').split(',')[0].trim();
  return first || req.socket?.remoteAddress || 'unknown';
}

/**
 * POST { password } → { token } — a random session token, not the password or its hash.
 * DELETE → signs this session out; DELETE ?all=1 signs out every device.
 */
export default async function handler(req: any, res: any) {
  if (req.method === 'POST') {
    const stored = process.env.AUTH_PASSWORD_HASH;
    if (!stored) {
      res.status(500).json({ error: 'AUTH_PASSWORD_HASH is not set' });
      return;
    }
    const [ip, all] = await Promise.all([perIp.limit(clientIp(req)), global.limit('all')]);
    if (!ip.success || !all.success) {
      res.status(429).json({ error: 'too many attempts' });
      return;
    }
    let body: unknown = req.body;
    try {
      if (typeof body === 'string') body = JSON.parse(body);
    } catch {
      body = null;
    }
    const password = (body as { password?: unknown } | null)?.password;
    if (typeof password !== 'string' || !password || !verifyPassword(password, stored)) {
      res.status(401).json({ error: 'incorrect password' });
      return;
    }
    if (isLegacyHash(stored)) {
      console.warn('AUTH_PASSWORD_HASH is a legacy SHA-256 hash; replace it with `npm run hash-password` output.');
    }
    res.status(200).json({ token: await createSession() });
    return;
  }

  if (req.method === 'DELETE') {
    if (!(await requireSession(req, res))) return;
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.searchParams.get('all') === '1') await revokeAllSessions();
    else await revokeSession(bearerToken(req));
    res.status(200).json({ ok: true });
    return;
  }

  res.status(405).json({ error: 'method not allowed' });
}
