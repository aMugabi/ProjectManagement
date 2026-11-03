import type { Page } from '@playwright/test';
import { expect, openSettings, seed, stored, test } from '../fixtures';
import { FakeCloud, SESSION } from '../fakeCloud';

// Push needs a registered service worker; Playwright only routes service-worker traffic in Chromium.
test.skip(({ browserName }) => browserName !== 'chromium', 'Push UI is exercised in Chromium only');
test.use({ serviceWorkers: 'allow' });

let cloud: FakeCloud;
test.beforeEach(async ({ context }) => {
  cloud = new FakeCloud();
  cloud.state = stored();
  await cloud.install(context);
});

const ENDPOINT = 'https://push.example.test/device-1';

/**
 * Stands in for the browser's push service (headless browsers can't reach a real one). The fake
 * subscription survives reloads via localStorage, like a real one would.
 */
async function fakePushService(page: Page, permission: 'granted' | 'denied' = 'granted') {
  await page.addInitScript(
    ({ endpoint, permission }) => {
      const make = () => ({
        endpoint,
        toJSON: () => ({ endpoint, keys: { p256dh: 'BKeyForTests', auth: 'authsecret' } }),
        unsubscribe: async () => {
          localStorage.removeItem('__fake_push_sub');
          return true;
        },
      });
      PushManager.prototype.getSubscription = async () =>
        (localStorage.getItem('__fake_push_sub') ? make() : null) as unknown as PushSubscription;
      PushManager.prototype.subscribe = async (opts?: PushSubscriptionOptionsInit) => {
        (window as unknown as { __keyLength: number }).__keyLength = (opts?.applicationServerKey as Uint8Array).length;
        localStorage.setItem('__fake_push_sub', '1');
        return make() as unknown as PushSubscription;
      };
      Object.defineProperty(Notification, 'permission', { get: () => (permission === 'denied' ? 'denied' : 'default'), configurable: true });
      Notification.requestPermission = async () => permission;
    },
    { endpoint: ENDPOINT, permission },
  );
}

async function openPushRow(page: Page) {
  await seed(page, stored(), { 'ledger-session': SESSION });
  await page.goto('dashboard');
  await expect.poll(() => page.evaluate(async () => Boolean(await navigator.serviceWorker.getRegistration()))).toBe(true);
  await openSettings(page);
  return page.getByRole('dialog', { name: 'Settings' });
}

test.describe('cloud build: push notification settings', () => {
  test('Turn on subscribes this device with the server key and registers it', async ({ page }) => {
    await fakePushService(page);
    const dialog = await openPushRow(page);
    await expect(dialog).toContainText('Get reminders even when Ledger is closed');
    await dialog.getByRole('button', { name: 'Turn on' }).last().click();
    await expect(dialog).toContainText('On for this device — reminders arrive even when Ledger is closed');
    expect([...cloud.subs.keys()]).toEqual([ENDPOINT]);
    expect(await page.evaluate(() => (window as unknown as { __keyLength: number }).__keyLength)).toBe(65); // P-256 public key
    expect(await page.evaluate(() => localStorage.getItem('ledger-push-active'))).toBe('1');
  });

  test('Send test reports that the notification was sent', async ({ page }) => {
    await fakePushService(page);
    const dialog = await openPushRow(page);
    await dialog.getByRole('button', { name: 'Turn on' }).last().click();
    await dialog.getByRole('button', { name: 'Send test' }).click();
    await expect(dialog).toContainText('Sent — it should appear in a moment');
    expect(cloud.testPushes).toEqual([ENDPOINT]);
  });

  test('Turn off unsubscribes and removes the device from the server', async ({ page }) => {
    await fakePushService(page);
    const dialog = await openPushRow(page);
    await dialog.getByRole('button', { name: 'Turn on' }).last().click();
    await dialog.getByRole('button', { name: 'Turn off' }).click();
    await expect(dialog).toContainText('Get reminders even when Ledger is closed');
    expect(cloud.subs.size).toBe(0);
    expect(await page.evaluate(() => localStorage.getItem('ledger-push-active'))).toBeNull();
  });

  test('re-registers an existing subscription with the server on startup', async ({ page }) => {
    await fakePushService(page);
    await openPushRow(page); // first visit: installs the service worker
    // The device already has a subscription, but the server has lost it (e.g. data reset).
    await page.evaluate(() => localStorage.setItem('__fake_push_sub', '1'));
    cloud.subs.clear();
    await page.reload();
    await expect.poll(() => [...cloud.subs.keys()]).toEqual([ENDPOINT]);
  });

  test("explains when push isn't configured on the server", async ({ page }) => {
    cloud.publicKey = null;
    await fakePushService(page);
    const dialog = await openPushRow(page);
    await dialog.getByRole('button', { name: 'Turn on' }).last().click();
    await expect(dialog).toContainText("Push isn't set up on the server yet");
  });

  test('explains when notifications are blocked', async ({ page }) => {
    await fakePushService(page, 'denied');
    const dialog = await openPushRow(page);
    await expect(dialog).toContainText('Notifications are blocked for this site');
  });
});
