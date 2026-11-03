/**
 * Push notifications for this device (cloud builds only): subscribes through the service worker
 * and registers the subscription with /api/push, so api/reminders.ts can notify while Ledger is closed.
 */
import { getAuthToken, handleUnauthorized } from './auth';
import { PUSH_ACTIVE_KEY, requestNotificationPermission } from './notifications';

export type PushStatus =
  | 'on'
  | 'off'
  | 'unsupported' // browser has no Push API, or no service worker (dev builds)
  | 'needs-install' // iPhone/iPad Safari: only installed (Home Screen) apps get push
  | 'blocked' // notification permission denied
  | 'not-configured'; // server has no VAPID keys yet

function setActive(on: boolean) {
  try {
    if (on) localStorage.setItem(PUSH_ACTIVE_KEY, '1');
    else localStorage.removeItem(PUSH_ACTIVE_KEY);
  } catch {
    // ignore
  }
}

function isIosBrowserTab(): boolean {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const standalone =
    window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone;
  return ios && !standalone;
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
  return (await navigator.serviceWorker.getRegistration()) ?? null;
}

async function api(method: string, query = '', body?: unknown): Promise<Response> {
  const res = await fetch(`/api/push${query}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getAuthToken() ?? ''}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401) handleUnauthorized();
  return res;
}

/** Decodes a base64url VAPID public key for pushManager.subscribe. */
function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

export async function pushStatus(): Promise<PushStatus> {
  if (isIosBrowserTab()) return 'needs-install';
  const reg = await registration();
  if (!reg) return 'unsupported';
  if (typeof Notification !== 'undefined' && Notification.permission === 'denied') return 'blocked';
  const sub = await reg.pushManager.getSubscription();
  setActive(Boolean(sub));
  return sub ? 'on' : 'off';
}

export async function enablePush(): Promise<PushStatus> {
  const reg = await registration();
  if (!reg) return 'unsupported';
  if ((await requestNotificationPermission()) !== 'granted') return 'blocked';

  const res = await api('GET');
  if (!res.ok) return 'off';
  const { publicKey } = (await res.json()) as { publicKey: string | null };
  if (!publicKey) return 'not-configured';

  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }));
  const saved = await api('POST', '', { subscription: sub.toJSON() });
  if (!saved.ok) return 'off';
  setActive(true);
  return 'on';
}

export async function disablePush(): Promise<PushStatus> {
  const sub = await (await registration())?.pushManager.getSubscription();
  if (sub) {
    await api('DELETE', '', { endpoint: sub.endpoint }).catch(() => undefined);
    await sub.unsubscribe();
  }
  setActive(false);
  return 'off';
}

/** Sends a test push to this device; resolves to whether the server delivered it. */
export async function sendTestPush(): Promise<boolean> {
  const sub = await (await registration())?.pushManager.getSubscription();
  if (!sub) return false;
  const res = await api('POST', '?test=1', { endpoint: sub.endpoint });
  return res.ok && ((await res.json()) as { sent: number }).sent > 0;
}

/**
 * On startup: re-register an existing subscription (in case the server lost it, or the browser
 * rotated it) and keep the local "push active" flag in step with reality.
 */
export async function refreshPushSubscription(): Promise<void> {
  if (!getAuthToken()) return;
  const sub = await (await registration())?.pushManager.getSubscription();
  setActive(Boolean(sub));
  if (sub) await api('POST', '', { subscription: sub.toJSON() }).catch(() => undefined);
}
