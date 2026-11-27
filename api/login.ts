import { loginOptions, requireUser, signIn, signOut } from './_lib/store.js';

function clientIp(req: any): string {
  const forwarded = req.headers?.['x-forwarded-for'];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded ?? '').split(',')[0].trim();
  return first || req.socket?.remoteAddress || 'unknown';
}

/**
 * GET → { mfa, email } — what the sign-in form must ask for: a code (authenticator or recovery),
 *   and on Postgres an email address too.
 * POST { email?, password, code? } → { token } — a random session token, not the password or its
 *   hash. A wrong email, password or code all get the same answer, so none is confirmed alone.
 *   Rate-limited: 5 attempts per 15 minutes per IP address, 50 an hour overall.
 * DELETE → signs this session out; DELETE ?all=1 signs out every device and drops every push
 * subscription.
 */
export default async function handler(req: any, res: any) {
  if (req.method === 'GET') {
    res.status(200).json(loginOptions());
    return;
  }

  if (req.method === 'POST') {
    let body: unknown = req.body;
    try {
      if (typeof body === 'string') body = JSON.parse(body);
    } catch {
      body = null;
    }
    const { email, password, code } = (body ?? {}) as { email?: unknown; password?: unknown; code?: unknown };
    const result = await signIn({ email, password, code, ip: clientIp(req) });
    if (result === 'not-configured') {
      res.status(500).json({ error: 'AUTH_PASSWORD_HASH is not set' });
    } else if (result === 'rate-limited') {
      res.status(429).json({ error: 'too many attempts' });
    } else if (result === 'incorrect') {
      const options = loginOptions();
      const error = options.email
        ? options.mfa ? 'incorrect email, password or code' : 'incorrect email or password'
        : options.mfa ? 'incorrect password or code' : 'incorrect password';
      res.status(401).json({ error });
    } else {
      res.status(200).json({ token: result.token });
    }
    return;
  }

  if (req.method === 'DELETE') {
    const user = await requireUser(req, res);
    if (!user) return;
    const url = new URL(req.url ?? '/', 'http://localhost');
    await signOut(req, user, url.searchParams.get('all') === '1');
    res.status(200).json({ ok: true });
    return;
  }

  res.status(405).json({ error: 'method not allowed' });
}
