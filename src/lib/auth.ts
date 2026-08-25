// Client-side-only gate: keeps casual visitors off a public URL, not a real security boundary.
// The password itself is never stored — only its SHA-256 hash, computed once by whoever set it.
const PASSWORD_HASH = '90dfe6dc3163d3bb0562e8b1eb2a9ec3f145c77b69fb215b1b08e06beb651185';
const UNLOCK_KEY = 'ledger-unlocked';

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function checkPassword(input: string): Promise<boolean> {
  return (await sha256Hex(input)) === PASSWORD_HASH;
}

export function isUnlocked(): boolean {
  return localStorage.getItem(UNLOCK_KEY) === 'true';
}

export function markUnlocked(): void {
  localStorage.setItem(UNLOCK_KEY, 'true');
}
