import type { PersistStorage, StorageValue } from 'zustand/middleware';
import { getAuthToken } from './auth';
import { CLOUD_ENABLED } from './cloud';
import { mergeStates } from '../shared/merge';
import { normalizeState, STATE_VERSION, type StoredState, type SyncedState } from '../shared/state';

/** Set while this browser has edits the cloud hasn't confirmed; survives reloads so offline edits get uploaded. */
const PENDING_KEY = 'ledger-sync-pending';

let syncTimer: ReturnType<typeof setTimeout> | undefined;
/** Counts local edits, so a finished upload only clears the pending flag if nothing changed meanwhile. */
let localEdits = 0;
/** True while applying the server's merged copy, so that write isn't uploaded straight back. */
let applying = false;
let applyRemote: ((state: SyncedState) => void) | null = null;

/** Registers how to apply a merged copy from the server (the store does this; avoids a circular import). */
export function onRemoteState(cb: (state: SyncedState) => void) {
  applyRemote = cb;
}

function readLocal(name: string): StoredState | null {
  try {
    const raw = localStorage.getItem(name);
    return raw ? (JSON.parse(raw) as StoredState) : null;
  } catch {
    return null;
  }
}

function writeLocal(name: string, value: unknown) {
  try {
    localStorage.setItem(name, JSON.stringify(value));
  } catch {
    // Storage full or unavailable — the in-memory store still has the change.
  }
}

function setPending(pending: boolean) {
  try {
    if (pending) localStorage.setItem(PENDING_KEY, '1');
    else localStorage.removeItem(PENDING_KEY);
  } catch {
    // ignore
  }
}

function isPending(): boolean {
  try {
    return localStorage.getItem(PENDING_KEY) === '1';
  } catch {
    return false;
  }
}

/** undefined = couldn't reach the cloud (keep working locally); null = the cloud has no copy yet. */
async function fetchRemote(token: string): Promise<StoredState | null | undefined> {
  try {
    const res = await fetch('/api/state', { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return undefined;
    return (await res.json()) as StoredState | null;
  } catch {
    return undefined;
  }
}

/** Uploads this browser's copy; the server merges it with the cloud copy and returns the result. */
async function push(name: string) {
  const token = getAuthToken();
  const local = readLocal(name);
  if (!token || !local) return;
  const sentEdits = localEdits;
  let merged: StoredState;
  try {
    const res = await fetch('/api/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(local),
    });
    if (!res.ok) return;
    merged = (await res.json()) as StoredState;
  } catch {
    // Offline or API unreachable — the pending flag stays set, so the next load, focus or edit retries.
    return;
  }
  if (localEdits === sentEdits) setPending(false);

  // Adopt other devices' changes. Merging with the *current* local copy keeps any edits made
  // while the upload was in flight (they carry newer stamps).
  const current = readLocal(name);
  const next = mergeStates(current?.state, merged.state, current?.state.activeWorkspaceId);
  if (JSON.stringify(next) === JSON.stringify(normalizeState(current?.state))) return;
  applying = true;
  try {
    if (applyRemote) applyRemote(next);
    else writeLocal(name, { state: next, version: STATE_VERSION });
  } finally {
    applying = false;
  }
}

function schedulePush(name: string, delay: number) {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => void push(name), delay);
}

/**
 * Writes to localStorage immediately (instant load, works offline/pre-login) and syncs with
 * /api/state when signed in to a cloud build. Sync merges task by task (see shared/merge.ts),
 * so offline edits and edits from other devices are both kept rather than one overwriting the other.
 */
export function createCloudStorage<S>(): PersistStorage<S> {
  return {
    getItem: async (name) => {
      const local = readLocal(name);
      const token = getAuthToken();
      if (!CLOUD_ENABLED || !token) return local as StorageValue<S> | null;

      const remote = await fetchRemote(token);
      if (remote === undefined) return local as StorageValue<S> | null;
      if (!remote || !local) {
        // Only one side has data: seed the cloud from this browser, or take the cloud's copy.
        if (local) schedulePush(name, 0);
        else if (remote) writeLocal(name, remote);
        return (local ?? remote) as StorageValue<S> | null;
      }

      const merged: StoredState = {
        state: mergeStates(local.state, remote.state, local.state.activeWorkspaceId),
        version: STATE_VERSION,
      };
      writeLocal(name, merged);
      if (isPending()) schedulePush(name, 0);
      return merged as unknown as StorageValue<S>;
    },

    setItem: (name, value) => {
      writeLocal(name, value);
      if (applying || !CLOUD_ENABLED || !getAuthToken()) return;
      localEdits++;
      setPending(true);
      schedulePush(name, 400);
    },

    removeItem: (name) => {
      localStorage.removeItem(name);
    },
  };
}
