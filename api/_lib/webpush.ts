import { createHash } from 'node:crypto';
import webpush, { type PushSubscription } from 'web-push';
import { PUSH_SUBS_KEY } from './keys.js';
import { kv } from './session.js';

/** What public/push-sw.js expects in each push message. */
export interface PushPayload {
  title: string;
  body: string;
  /** Notification tag: a newer notification with the same tag replaces the older one. */
  tag: string;
  /** App-relative path opened when the notification is clicked. */
  path: string;
}

export function vapidPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY || null;
}

function configured(): boolean {
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return false;
  webpush.setVapidDetails(VAPID_SUBJECT || 'mailto:admin@example.com', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  return true;
}

export function subscriptionId(endpoint: string): string {
  return createHash('sha256').update(endpoint).digest('hex');
}

export function isSubscription(v: unknown): v is PushSubscription {
  const s = v as PushSubscription | null;
  return (
    typeof s?.endpoint === 'string' &&
    s.endpoint.startsWith('https://') &&
    typeof s.keys?.p256dh === 'string' &&
    typeof s.keys?.auth === 'string'
  );
}

export async function saveSubscription(sub: PushSubscription): Promise<void> {
  await kv.hset(PUSH_SUBS_KEY, { [subscriptionId(sub.endpoint)]: JSON.stringify(sub) });
}

export async function removeSubscription(endpoint: string): Promise<void> {
  await kv.hdel(PUSH_SUBS_KEY, subscriptionId(endpoint));
}

/**
 * Sends to every saved subscription (or only `onlyEndpoint`). Subscriptions the push service
 * reports as gone (404/410) are deleted. Returns how many deliveries were accepted.
 */
export async function sendPush(payload: PushPayload, onlyEndpoint?: string): Promise<number> {
  if (!configured()) return 0;
  const stored = (await kv.hgetall<Record<string, PushSubscription | string>>(PUSH_SUBS_KEY)) ?? {};
  const subs = Object.values(stored)
    .map((v) => (typeof v === 'string' ? (JSON.parse(v) as PushSubscription) : v))
    .filter((s) => isSubscription(s) && (!onlyEndpoint || s.endpoint === onlyEndpoint));

  const body = JSON.stringify(payload);
  const results = await Promise.allSettled(subs.map((s) => webpush.sendNotification(s, body, { TTL: 12 * 60 * 60 })));
  let accepted = 0;
  await Promise.all(
    results.map(async (r, i) => {
      if (r.status === 'fulfilled') {
        accepted++;
        return;
      }
      const status = (r.reason as { statusCode?: number })?.statusCode;
      if (status === 404 || status === 410) await removeSubscription(subs[i].endpoint);
      else console.error('Push delivery failed', status, (r.reason as Error)?.message);
    }),
  );
  return accepted;
}
