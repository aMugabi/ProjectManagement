/** System notifications on this device (the Notification API), shared by in-app reminders and push. */
import { outsideText, type Reminder } from '../shared/reminders';

/** Set by lib/push.ts while this device has a push subscription; push then delivers system notifications. */
export const PUSH_ACTIVE_KEY = 'ledger-push-active';

export type PermissionState = NotificationPermission | 'unsupported';

export function notificationPermission(): PermissionState {
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
}

export async function requestNotificationPermission(): Promise<PermissionState> {
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.requestPermission();
}

export function isPushActive(): boolean {
  try {
    return localStorage.getItem(PUSH_ACTIVE_KEY) === '1';
  } catch {
    return false;
  }
}

/** Absolute URL for an app-relative path such as 'dashboard?task=…', honouring the deploy's base path. */
export function appUrl(path: string): string {
  return new URL(import.meta.env.BASE_URL + path, window.location.origin).href;
}

/**
 * Shows a reminder as a system notification; clicks are handled by public/push-sw.js. With
 * private notifications on, it shows counts only (it can appear on a lock screen).
 */
export async function showSystemNotification(r: Reminder, privateNotifications: boolean): Promise<void> {
  if (notificationPermission() !== 'granted') return;
  const { title, body } = outsideText(r, privateNotifications);
  const options: NotificationOptions = { body, tag: r.key, icon: appUrl('pwa-192x192.png'), data: { path: r.url } };
  const reg = await navigator.serviceWorker?.getRegistration();
  if (reg) {
    await reg.showNotification(title, options);
    return;
  }
  // No service worker (dev builds): a page notification works on desktop browsers.
  const n = new Notification(title, options);
  n.onclick = () => {
    window.focus();
    window.location.href = appUrl(r.url);
  };
}
