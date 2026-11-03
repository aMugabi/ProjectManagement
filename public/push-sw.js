// Imported into the generated service worker (see workbox.importScripts in vite.config.ts).
// Handles reminder notification clicks: focus an open Ledger window and send it to the task,
// or open a new window there.
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
