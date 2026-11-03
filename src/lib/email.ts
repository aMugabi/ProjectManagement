import { getAuthToken, handleUnauthorized } from './auth';

/** Sends a test email to `to` through /api/email; resolves to null on success or the reason it failed. */
export async function sendTestEmail(to: string): Promise<string | null> {
  try {
    const res = await fetch('/api/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getAuthToken() ?? ''}` },
      body: JSON.stringify({ to }),
    });
    if (res.status === 401) handleUnauthorized();
    if (res.ok) return null;
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return body.error ?? `the server answered ${res.status}`;
  } catch {
    return "couldn't reach Ledger's server";
  }
}
