import webpush, { type PushSubscription } from 'web-push';
import { pushSubscriptions, removePushSubscription } from './store.js';

/** What public/push-sw.js expects in each push message. */
export interface PushPayload {
  title: string;
  body: string;
  /** Notification tag: a newer notification with the same tag replaces the older one. */
  tag: string;
  /** App-relative path opened when the notification is clicked. */
  path: string;
}

/**
 * A VAPID key as web-push wants it: URL-safe base64 without padding. A key saved in the standard
 * alphabet or with a trailing '=' (as some generators print it) is the same bytes, but web-push
 * refuses it, and every push then fails.
 */
export function urlSafeKey(key: string): string {
  return key.trim().replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function vapidPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY ? urlSafeKey(process.env.VAPID_PUBLIC_KEY) : null;
}

function configured(): boolean {
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return false;
  webpush.setVapidDetails(VAPID_SUBJECT || 'mailto:admin@example.com', urlSafeKey(VAPID_PUBLIC_KEY), urlSafeKey(VAPID_PRIVATE_KEY));
  return true;
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

/** How a push went: deliveries the push services accepted, and ones that failed (not counting devices that are gone). */
export interface PushResult {
  accepted: number;
  failed: number;
}

/**
 * Sends to every one of the user's saved subscriptions (or only `onlyEndpoint`). Subscriptions the
 * push service reports as gone (404/410) are deleted, and don't count as failures.
 */
export async function sendPush(payload: PushPayload, userId: string, onlyEndpoint?: string): Promise<PushResult> {
  if (!configured()) return { accepted: 0, failed: 0 };
  const subs = (await pushSubscriptions(userId)).filter((s) => isSubscription(s) && (!onlyEndpoint || s.endpoint === onlyEndpoint));

  const body = JSON.stringify(payload);
  const results = await Promise.allSettled(subs.map((s) => webpush.sendNotification(s, body, { TTL: 12 * 60 * 60 })));
  let accepted = 0;
  let failed = 0;
  await Promise.all(
    results.map(async (r, i) => {
      if (r.status === 'fulfilled') {
        accepted++;
        return;
      }
      const status = (r.reason as { statusCode?: number })?.statusCode;
      if (status === 404 || status === 410) await removePushSubscription(userId, subs[i].endpoint);
      else {
        failed++;
        console.error('Push delivery failed', status, (r.reason as Error)?.message);
      }
    }),
  );
  return { accepted, failed };
}
