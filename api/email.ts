import { isEmail } from '../src/shared/digestEmail.js';
import { emailConfigured, sendEmail } from './_lib/email.js';
import { requireSession } from './_lib/session.js';

/**
 * POST { to } → sends a test email, so the address and the email service can be checked from
 * Settings. Session required (only the owner can trigger it).
 */
export default async function handler(req: any, res: any) {
  if (!(await requireSession(req, res))) return;
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }
  if (!emailConfigured()) {
    res.status(503).json({ error: "email isn't set up on the server yet (RESEND_API_KEY)" });
    return;
  }
  let body: unknown = req.body;
  try {
    if (typeof body === 'string') body = JSON.parse(body);
  } catch {
    body = null;
  }
  const to = (body as { to?: unknown } | null)?.to;
  if (typeof to !== 'string' || !isEmail(to)) {
    res.status(400).json({ error: 'enter a valid email address' });
    return;
  }
  try {
    await sendEmail({
      to: to.trim(),
      subject: 'Ledger test email',
      text: "Email reminders are working. You'll get one digest each morning at the time set in Ledger's Settings.",
      html:
        '<div style="font-family:system-ui,sans-serif;color:#1c1b19"><h2 style="font-size:18px">Email reminders are working</h2>' +
        "<p>You'll get one digest each morning at the time set in Ledger's Settings.</p></div>",
    });
    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(502).json({ error: (e as Error).message });
  }
}
