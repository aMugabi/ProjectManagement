import type { StoredState } from '../src/shared/state.js';
import { readDocument, requireUser, syncDocument } from './_lib/store.js';

function isStoredState(v: unknown): v is StoredState {
  const s = (v as StoredState | null)?.state;
  return typeof s === 'object' && s !== null && Array.isArray(s.tasks) && Array.isArray(s.projects);
}

/**
 * GET → the signed-in user's document (null when they have none yet).
 * POST { state, version } → merges this device's copy with the stored one (newest edit wins,
 *   item by item; see src/shared/merge.ts) and returns the result.
 */
export default async function handler(req: any, res: any) {
  const user = await requireUser(req, res);
  if (!user) return;

  if (req.method === 'GET') {
    res.status(200).json(await readDocument(user));
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
    const merged = await syncDocument(user, body);
    if (!merged) {
      res.status(409).json({ error: 'conflict, retry' });
      return;
    }
    res.status(200).json(merged);
    return;
  }

  res.status(405).json({ error: 'method not allowed' });
}
