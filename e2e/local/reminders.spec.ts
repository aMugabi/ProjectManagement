import { drawer, expect, openSettings, openTaskLink, REMINDERS_ON, savedState, seed, stored, task, test } from '../fixtures';

const dueSoon = () => [task('late', 'Renew licence', -2), task('today', 'Pay rent', 0), task('soon', 'Book flights', 1)];
const toasts = (page: import('@playwright/test').Page) => page.getByRole('region', { name: 'Reminders' });

test.describe('reminders and notifications (local-only build)', () => {
  test('shows the daily digest and lead reminders as pop-ups', async ({ page }) => {
    await seed(page, stored({ tasks: dueSoon(), reminders: REMINDERS_ON }));
    await page.goto('dashboard');
    await expect(toasts(page)).toContainText('Ledger · 1 due today, 1 overdue');
    await expect(toasts(page)).toContainText('Today: Pay rent');
    await expect(toasts(page)).toContainText('Overdue: Renew licence');
    await expect(toasts(page)).toContainText('Due tomorrow: Book flights');
  });

  test('the bell counts and lists overdue, due today and coming up', async ({ page }) => {
    await seed(page, stored({ tasks: dueSoon(), reminders: REMINDERS_ON }));
    await page.goto('dashboard');
    await page.getByRole('button', { name: 'Reminders (3)' }).click();
    const panel = page.getByRole('dialog', { name: 'Reminders' });
    for (const text of ['Overdue', 'Renew licence', 'Due today', 'Pay rent', 'Coming up', 'Book flights']) {
      await expect(panel).toContainText(text);
    }
    await panel.getByRole('button', { name: /Book flights/ }).click();
    await expect(drawer(page).locator('textarea').first()).toHaveValue('Book flights');
  });

  test('"Open task" on a reminder opens that task', async ({ page }) => {
    await seed(page, stored({ tasks: dueSoon(), reminders: REMINDERS_ON }));
    await page.goto('dashboard');
    await toasts(page).getByRole('button', { name: 'Open task' }).click();
    await expect(drawer(page).locator('textarea').first()).toHaveValue('Book flights');
  });

  test('Dismiss is remembered across reloads; Snooze hides a reminder for an hour', async ({ page }) => {
    await seed(page, stored({ tasks: dueSoon(), reminders: REMINDERS_ON }));
    await page.goto('dashboard');
    const lead = toasts(page).locator('div').filter({ hasText: /^Reminder/ }).first();
    await lead.getByRole('button', { name: 'Dismiss' }).click();
    await toasts(page).getByRole('button', { name: 'Snooze 1h' }).click();
    await expect(toasts(page)).toHaveCount(0);

    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(toasts(page)).toHaveCount(0);

    // Make the snooze expire: the digest comes back, the dismissed reminder doesn't.
    await page.evaluate(() => {
      const log = JSON.parse(localStorage.getItem('ledger-reminders') ?? '{}');
      for (const entry of Object.values(log) as { snoozeUntil?: number }[]) {
        if (entry.snoozeUntil) entry.snoozeUntil = Date.now() - 1;
      }
      localStorage.setItem('ledger-reminders', JSON.stringify(log));
    });
    await page.reload();
    await expect(toasts(page)).toContainText('1 due today');
    await expect(toasts(page)).not.toContainText('Book flights');
  });

  test('nothing pops up before the digest time; reminders arrive once it passes', async ({ page }) => {
    const sevenAm = new Date();
    sevenAm.setHours(7, 58, 0, 0);
    await page.clock.install({ time: sevenAm });
    await seed(page, stored({ tasks: dueSoon(), reminders: { ...REMINDERS_ON, digestTime: '08:00' } }));
    await page.goto('dashboard');
    await expect(page.getByRole('button', { name: 'Reminders (3)' })).toBeVisible(); // the bell is always current
    await expect(toasts(page)).toHaveCount(0);

    await page.clock.runFor('03:00'); // 08:01 — the minute check picks it up
    await expect(toasts(page)).toContainText('1 due today, 1 overdue');
  });

  test('a per-task "Remind me" setting brings a lead reminder forward', async ({ page }) => {
    await seed(page, stored({ tasks: [task('trip', 'Renew passport', 3)], reminders: REMINDERS_ON }));
    await page.goto('dashboard');
    await expect(toasts(page)).toHaveCount(0); // default lead is 1 day; this is 3 days away

    await openTaskLink(page, 'trip');
    await drawer(page).locator('select').filter({ hasText: /^Default/ }).selectOption('3');
    await drawer(page).getByRole('button', { name: 'Close', exact: true }).click();
    await expect(toasts(page)).toContainText('Due in 3 days: Renew passport');
    expect((await savedState(page)).state.tasks[0].remindDaysBefore).toBe(3);
  });

  test('Settings changes to digest time and default reminder are saved', async ({ page }) => {
    await seed(page, stored({ reminders: { ...REMINDERS_ON, digestTime: '08:00' } }));
    await page.goto('dashboard');
    await openSettings(page);
    const dialog = page.getByRole('dialog', { name: 'Settings' });
    await dialog.locator('input[type="time"]').fill('18:30');
    await dialog.locator('select').selectOption('3');
    await dialog.getByRole('button', { name: 'Close settings' }).click();

    await page.reload();
    await openSettings(page);
    await expect(dialog.locator('input[type="time"]')).toHaveValue('18:30');
    await expect(dialog.locator('select')).toHaveValue('3');
    const { reminders } = (await savedState(page)).state;
    expect(reminders).toMatchObject({ digestTime: '18:30', defaultLeadDays: 3 });
    expect(reminders.timezone).not.toBe('UTC'); // picked up from the device
  });

  test('local-only Settings has no push controls and explains why', async ({ page }) => {
    await seed(page, stored());
    await page.goto('dashboard');
    await openSettings(page);
    const dialog = page.getByRole('dialog', { name: 'Settings' });
    await expect(dialog).toContainText('Use the cloud version to get push notifications');
    await expect(dialog.getByText('Push notifications', { exact: true })).toHaveCount(0);
    await expect(dialog.getByText('Sign out')).toHaveCount(0);
  });

  test('raises a system notification once while Ledger is in a background tab', async ({ page }) => {
    await page.addInitScript(() => {
      const shown: string[] = [];
      (window as unknown as { __shown: string[] }).__shown = shown;
      Object.defineProperty(document, 'visibilityState', { get: () => 'hidden' });
      class FakeNotification {
        static permission = 'granted';
        static requestPermission = async () => 'granted';
        onclick: (() => void) | null = null;
        constructor(title: string) {
          shown.push(title);
        }
      }
      Object.defineProperty(window, 'Notification', { value: FakeNotification, configurable: true });
      if ('ServiceWorkerRegistration' in window) {
        ServiceWorkerRegistration.prototype.showNotification = async (title: string) => {
          shown.push(title);
        };
      }
    });
    await seed(page, stored({ tasks: dueSoon(), reminders: REMINDERS_ON }));
    await page.goto('dashboard');
    await expect.poll(() => page.evaluate(() => (window as unknown as { __shown: string[] }).__shown)).toEqual([
      'Ledger · 1 due today, 1 overdue',
      'Due tomorrow: Book flights',
    ]);

    await page.reload();
    await page.waitForTimeout(1500);
    expect(await page.evaluate(() => (window as unknown as { __shown: string[] }).__shown)).toEqual([]);
  });
});
