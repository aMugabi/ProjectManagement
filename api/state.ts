import { mergeStates } from '../src/shared/merge.js';
import { normalizeState, STATE_VERSION, type StoredState } from '../src/shared/state.js';
import { STATE_KEY, STATE_REV_KEY as REV_KEY } from './_lib/keys.js';
import { kv, requireSession } from './_lib/session.js';

// Compare-and-set: write only if nobody else wrote since we read.
const CAS_SCRIPT = `
if (redis.call('GET', KEYS[2]) or '0') == ARGV[1] then
  redis.call('SET', KEYS[1], ARGV[2])
  redis.call('INCR', KEYS[2])
  return 1
end
return 0`;

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
  if (!(await requireSession(req, res))) return;

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
