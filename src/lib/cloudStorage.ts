import type { PersistStorage, StorageValue } from 'zustand/middleware';
import { getAuthToken } from './auth';

let syncTimer: ReturnType<typeof setTimeout> | undefined;

function readLocal<S>(name: string): StorageValue<S> | null {
  try {
    const raw = localStorage.getItem(name);
    return raw ? (JSON.parse(raw) as StorageValue<S>) : null;
  } catch {
    return null;
  }
}

/**
 * Writes to localStorage immediately (instant load, works offline/pre-login) and
 * mirrors the same payload to /api/state whenever an auth token is available, so
 * task data follows the user across devices instead of staying in one browser.
 */
export function createCloudStorage<S>(): PersistStorage<S> {
  return {
    getItem: async (name) => {
      const cached = readLocal<S>(name);
      const token = getAuthToken();
      if (!token) return cached;
      try {
        const res = await fetch('/api/state', { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) return cached;
        const remote = (await res.json()) as StorageValue<S> | null;
        if (!remote) return cached;
        localStorage.setItem(name, JSON.stringify(remote));
        return remote;
      } catch {
        return cached;
      }
    },

    setItem: (name, value) => {
      localStorage.setItem(name, JSON.stringify(value));
      const token = getAuthToken();
      if (!token) return;
      clearTimeout(syncTimer);
      syncTimer = setTimeout(() => {
        fetch('/api/state', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(value),
        }).catch(() => {
          // Offline or API unreachable — localStorage already has the change;
          // it'll sync next time setItem fires successfully.
        });
      }, 400);
    },

    removeItem: (name) => {
      localStorage.removeItem(name);
    },
  };
}
