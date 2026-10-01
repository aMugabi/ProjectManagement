import { Redis } from '@upstash/redis';
import { timingSafeEqual } from 'node:crypto';

const kv = Redis.fromEnv();

// The single-user task/project blob that src/lib/cloudStorage.ts reads and writes.
const STATE_KEY = 'ledger:state';

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

export default async function handler(req: any, res: any) {
  const expected = process.env.AUTH_PASSWORD_HASH;
  const auth = req.headers.authorization ?? '';
  const token = typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.slice(7) : '';

  if (!expected || !token || !safeEqual(token, expected)) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  if (req.method === 'GET') {
    const data = await kv.get(STATE_KEY);
    res.status(200).json(data ?? null);
    return;
  }

  if (req.method === 'POST') {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    await kv.set(STATE_KEY, body);
    res.status(200).json({ ok: true });
    return;
  }

  res.status(405).json({ error: 'method not allowed' });
}
