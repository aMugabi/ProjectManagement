// Session handling for cloud builds. The password is sent once to /api/login over HTTPS, which
// checks it against a salted scrypt hash (rate-limited) and returns a random session token. Only
// that token is kept here — it expires, can be revoked from Settings, and isn't password-equivalent.
// Local-only builds (GitHub Pages, `npm run dev`) don't use any of this; see lib/cloud.ts.
import { clearDeviceData, hasUnsyncedEdits } from './deviceData';

const TOKEN_KEY = 'ledger-session';
/** Pre-session builds stored the password hash itself; remove it so it doesn't linger. */
const LEGACY_TOKEN_KEY = 'ledger-auth-token';

let authToken: string | null = null;
const listeners = new Set<() => void>();

/**
 * Subscribes to sign-in/out changes (for useSyncExternalStore). Reading state this way, rather than
 * listening for an event, means a 401 that arrives before the login gate mounts still locks the app.
 */
export function subscribeAuth(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

try {
  localStorage.removeItem(LEGACY_TOKEN_KEY);
  authToken = localStorage.getItem(TOKEN_KEY);
} catch {
  // localStorage unavailable (e.g. private browsing) — the app will just re-prompt.
}

/** The session token to send as a bearer token on every /api request. */
export function getAuthToken(): string | null {
  return authToken;
}

export function isUnlocked(): boolean {
  return authToken !== null;
}

function setToken(token: string | null) {
  authToken = token;
  for (const listener of listeners) listener();
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // ignore
  }
}

export type LoginResult = 'ok' | 'incorrect' | 'rate-limited' | 'unavailable';

/** What the sign-in form must ask for: a code (authenticator or recovery), and an email address. */
export interface LoginOptions {
  mfa: boolean;
  email: boolean;
}

/** The server's sign-in options; null when it can't be reached (the form then offers the code field anyway). */
export async function loginOptions(): Promise<LoginOptions | null> {
  try {
    const res = await fetch('/api/login');
    if (!res.ok) return null;
    const body = (await res.json()) as Partial<LoginOptions>;
    return { mfa: body.mfa === true, email: body.email === true };
  } catch {
    return null;
  }
}

export async function login(password: string, code?: string, email?: string): Promise<LoginResult> {
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...(email ? { email } : {}), password, ...(code ? { code } : {}) }),
    });
    if (res.status === 429) return 'rate-limited';
    if (res.status === 401) return 'incorrect';
    if (!res.ok) return 'unavailable';
    const { token } = (await res.json()) as { token: string };
    setToken(token);
    return 'ok';
  } catch {
    return 'unavailable';
  }
}

/**
 * Called when any /api request answers 401: the session expired or was revoked elsewhere (for
 * example "Sign out → All devices" after losing a phone). If everything here is already in the
 * cloud, this browser's copy is deleted, since it costs nothing; edits not yet uploaded are kept
 * until the next sign-in uploads them.
 */
export function handleUnauthorized() {
  if (!authToken) return;
  setToken(null);
  if (!hasUnsyncedEdits()) {
    clearDeviceData();
    window.location.reload();
  }
}

/**
 * Ends the session on the server: this device's, or every device's with `everywhere`. Use
 * lib/signOut.ts, which also uploads unsynced edits and clears this browser's copy.
 */
export async function endSession(everywhere = false): Promise<void> {
  const token = authToken;
  if (token) {
    try {
      await fetch(`/api/login${everywhere ? '?all=1' : ''}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {
      // Offline: the session will still expire on its own.
    }
  }
  setToken(null);
}
