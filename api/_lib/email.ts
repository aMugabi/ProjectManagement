/**
 * Sends email through Resend's HTTP API (https://resend.com/docs/api-reference/emails/send-email).
 * Needs RESEND_API_KEY. EMAIL_FROM sets the sender; until a domain is verified in Resend, the
 * default test sender can only deliver to the Resend account owner's own address.
 */
export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

const DEFAULT_FROM = 'Ledger <onboarding@resend.dev>';

export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

/** Throws with Resend's reason if the email isn't accepted. */
export async function sendEmail(email: OutgoingEmail): Promise<void> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM || DEFAULT_FROM,
      to: [email.to],
      subject: email.subject,
      text: email.text,
      html: email.html,
    }),
  });
  if (!res.ok) {
    let reason = `${res.status}`;
    try {
      const body = (await res.json()) as { message?: string };
      if (body.message) reason += `: ${body.message}`;
    } catch {
      // keep the status only
    }
    throw new Error(`the email service refused it (${reason})`);
  }
}
