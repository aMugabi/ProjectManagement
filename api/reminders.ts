import { Receiver } from '@upstash/qstash';
import { timingSafeEqual } from 'node:crypto';
import { computeReminders, nowInZone } from '../src/shared/reminders.js';
import { normalizeState, type StoredState } from '../src/shared/state.js';
import { SENT_PREFIX, STATE_KEY } from './_lib/keys.js';
import { kv } from './_lib/session.js';
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
    return await new Receiver({ currentSigningKey, nextSigningKey }).verify({
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

  const stored = await kv.get<StoredState>(STATE_KEY);
  if (!stored) return Response.json({ due: 0, sent: 0 });

  const state = normalizeState(stored.state);
  const due = computeReminders(state, nowInZone(state.reminders.timezone));
  let sent = 0;
  for (const r of due) {
    // SET NX claims the reminder, so overlapping or repeated runs never push it twice.
    const claimed = await kv.set(SENT_PREFIX + r.key, 1, { nx: true, ex: SENT_TTL_SECONDS });
    if (claimed !== 'OK') continue;
    await sendPush({ title: r.title, body: r.body, tag: r.key, path: r.url });
    sent++;
  }
  return Response.json({ due: due.length, sent });
}
