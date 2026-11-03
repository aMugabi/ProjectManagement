import { Redis } from '@upstash/redis';
import { timingSafeEqual } from 'node:crypto';
import { mergeStates } from '../src/shared/merge.js';
import { normalizeState, STATE_VERSION, type StoredState } from '../src/shared/state.js';

const kv = Redis.fromEnv();

// The single-user task/project blob that src/lib/cloudStorage.ts reads and writes.
const STATE_KEY = 'ledger:state';
// Bumped on every write, so concurrent uploads can't silently overwrite each other's merge.
const REV_KEY = 'ledger:state-rev';

// Compare-and-set: write only if nobody else wrote since we read.
const CAS_SCRIPT = `
if (redis.call('GET', KEYS[2]) or '0') == ARGV[1] then
  redis.call('SET', KEYS[1], ARGV[2])
  redis.call('INCR', KEYS[2])
  return 1
end
return 0`;

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

function isStoredState(v: unknown): v is StoredState {
  const s = (v as StoredState | null)?.state;
  return typeof s === 'object' && s !== null && Array.isArray(s.tasks) && Array.isArray(s.projects);
}

/** Merges the upload into the stored copy task by task (newest edit wins), retrying if another write lands first. */
async function mergeAndSave(incoming: StoredState): Promise<StoredState | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const [stored, rev] = await kv.mget<[StoredState | null, number | null]>(STATE_KEY, REV_KEY);
    const merged: StoredState = {
      state: stored
        ? mergeStates(stored.state, incoming.state, incoming.state.activeWorkspaceId)
        : normalizeState(incoming.state),
      version: STATE_VERSION,
    };
    const ok = await kv.eval(CAS_SCRIPT, [STATE_KEY, REV_KEY], [String(rev ?? 0), JSON.stringify(merged)]);
    if (ok === 1) return merged;
  }
  return null;
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
    let body: unknown = req.body;
    try {
      if (typeof body === 'string') body = JSON.parse(body);
    } catch {
      body = null;
    }
    if (!isStoredState(body)) {
      res.status(400).json({ error: 'invalid state' });
      return;
    }
    const merged = await mergeAndSave(body);
    if (!merged) {
      res.status(409).json({ error: 'conflict, retry' });
      return;
    }
    res.status(200).json(merged);
    return;
  }

  res.status(405).json({ error: 'method not allowed' });
}
