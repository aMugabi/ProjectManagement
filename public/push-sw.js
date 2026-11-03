// Imported into the generated service worker (see workbox.importScripts in vite.config.ts).

// Push messages from api/reminders.ts and api/push.ts: { title, body, tag, path }.
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Ledger', {
      body: data.body || '',
      tag: data.tag,
      icon: new URL('pwa-192x192.png', self.registration.scope).href,
      badge: new URL('pwa-192x192.png', self.registration.scope).href,
      data: { path: data.path || '' },
    }),
  );
});

// Notification clicks (push and in-app reminders): focus an open Ledger window and send it to
// the task, or open a new window there.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const path = event.notification.data?.path ?? '';
  const url = new URL(path, self.registration.scope).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const existing = windows.find((c) => c.url.startsWith(self.registration.scope));
      if (existing) {
        await existing.focus();
        existing.postMessage({ type: 'ledger:open', path });
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});
