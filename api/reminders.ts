import { Receiver } from '@upstash/qstash';
import { timingSafeEqual } from 'node:crypto';
import { digestEmail } from '../src/shared/digestEmail.js';
import { computeReminders, nowInZone, outsideText } from '../src/shared/reminders.js';
import { normalizeState } from '../src/shared/state.js';
import { emailConfigured, sendEmail } from './_lib/email.js';
import { claimReminder, readDocument, releaseReminder, reminderUsers } from './_lib/store.js';
import { sendPush } from './_lib/webpush.js';

/** Each reminder is pushed at most once; markers outlive the reminder's day. */
const SENT_TTL_SECONDS = 3 * 24 * 60 * 60;

/**
 * Called every 15 minutes by an Upstash QStash schedule (signed with the QStash signing keys).
 * Optionally also accepts `Authorization: Bearer $REMINDERS_SECRET`, for manual runs or another
 * scheduler. Uses the Web Request API so the raw body is available for signature checks.
 */
async function authorised(request: Request, rawBody: string): Promise<boolean> {
  const secret = process.env.REMINDERS_SECRET;
  const auth = request.headers.get('authorization') ?? '';
  if (secret && auth.startsWith('Bearer ')) {
    const a = Buffer.from(auth.slice(7));
    const b = Buffer.from(secret);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  const signature = request.headers.get('upstash-signature');
  const currentSigningKey = process.env.QSTASH_CURRENT_SIGNING_KEY;
  const nextSigningKey = process.env.QSTASH_NEXT_SIGNING_KEY;
  if (!signature || !currentSigningKey || !nextSigningKey) return false;
  try {
    // devMode pinned off: the library's dev mode would accept signatures from its public dev keys.
    return await new Receiver({ currentSigningKey, nextSigningKey, devMode: false }).verify({
      signature,
      body: rawBody,
      clockTolerance: 30,
    });
  } catch {
    return false;
  }
}

export async function POST(request: Request): Promise<Response> {
  const rawBody = await request.text();
  if (!(await authorised(request, rawBody))) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const origin = new URL(request.url).origin;
  let due = 0;
  let sent = 0;
  let emailed = 0;
  let emailFailed = false;
  let pushFailed = false;
  for (const userId of await reminderUsers()) {
    const stored = await readDocument(userId);
    if (!stored) continue;
    const state = normalizeState(stored.state);
    const now = nowInZone(state.reminders.timezone);
    const reminders = computeReminders(state, now);
    due += reminders.length;
    for (const r of reminders) {
      // Claimed first, so overlapping or repeated runs never push it twice.
      if (!(await claimReminder(userId, r.key, SENT_TTL_SECONDS))) continue;
      // The payload is encrypted to each device, but it is displayed on lock screens: private
      // notifications leave the names out.
      const { title, body } = outsideText(r, state.reminders.privateNotifications);
      try {
        const push = await sendPush({ title, body, tag: r.key, path: r.url }, userId);
        if (push.accepted > 0) sent++;
        else {
          // No device took it: none is registered yet, or every delivery failed. Given back, so
          // the next run tries again: a device turned on later still gets the day's digest.
          await releaseReminder(userId, r.key);
          if (push.failed > 0) pushFailed = true;
        }
      } catch (e) {
        // Given back, so the next run tries again: claimed and never sent, it would be lost for
        // days. A bad push setting (such as a malformed key) fails every push this way.
        await releaseReminder(userId, r.key);
        console.error('Push failed:', (e as Error).message);
        pushFailed = true;
      }
    }

    // The morning email digest (if turned on). Claimed like a push, but released if sending fails
    // so the next run retries instead of silently skipping the day.
    const email = emailConfigured() ? digestEmail(state, now, origin) : null;
    if (email && (await claimReminder(userId, email.key, SENT_TTL_SECONDS))) {
      try {
        await sendEmail(email);
        emailed++;
      } catch (e) {
        await releaseReminder(userId, email.key);
        console.error('Digest email failed:', (e as Error).message);
        emailFailed = true;
      }
    }
  }
  // A failed push or email answers 502 (after every user was tried), so the timer's run fails and
  // GitHub emails the owner instead of reminders just not arriving.
  const error = [pushFailed && 'push failed', emailFailed && 'digest email failed'].filter(Boolean).join('; ');
  if (error) return Response.json({ due, sent, emailed, error }, { status: 502 });
  return Response.json({ due, sent, emailed });
}
