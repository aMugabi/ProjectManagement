// Client-side-only gate: keeps casual visitors off a public URL, not a real security
// boundary on its own. The real check happens server-side in api/state.ts, which
// compares this same password hash (sent as a bearer token) against the
// AUTH_PASSWORD_HASH environment variable before returning or accepting any task
// data — so the cloud copy isn't readable by anyone who just finds the URL.
const TOKEN_KEY = 'ledger-auth-token';

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

let authToken: string | null = null;
try {
  authToken = localStorage.getItem(TOKEN_KEY);
} catch {
  // localStorage unavailable (e.g. private browsing) — the app will just re-prompt.
}

/** The password hash to send as a bearer token on every /api/state request. */
export function getAuthToken(): string | null {
  return authToken;
}

export function isUnlocked(): boolean {
  return authToken !== null;
}

export async function checkPassword(password: string): Promise<boolean> {
  const hash = await sha256Hex(password);
  try {
    const res = await fetch('/api/state', { headers: { Authorization: `Bearer ${hash}` } });
    if (!res.ok) return false;
  } catch {
    // No cloud API reachable (e.g. `npm run dev` without `vercel dev`) — let local
    // development through unverified; nothing syncs until the real API answers.
    console.warn('Ledger: cloud API unreachable, skipping server-side password check.');
  }
  authToken = hash;
  try {
    localStorage.setItem(TOKEN_KEY, hash);
  } catch {
    // ignore
  }
  return true;
}
