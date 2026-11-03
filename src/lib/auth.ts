// Session handling for cloud builds. The password is sent once to /api/login over HTTPS, which
// checks it against a salted scrypt hash (rate-limited) and returns a random session token. Only
// that token is kept here — it expires, can be revoked from Settings, and isn't password-equivalent.
// Local-only builds (GitHub Pages, `npm run dev`) don't use any of this; see lib/cloud.ts.
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

export async function login(password: string): Promise<LoginResult> {
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
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

/** Called when any /api request answers 401: the session expired or was revoked elsewhere. */
export function handleUnauthorized() {
  if (authToken) setToken(null);
}

/** Signs out this device, or every device with `everywhere`. Local data stays in this browser. */
export async function signOut(everywhere = false): Promise<void> {
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
