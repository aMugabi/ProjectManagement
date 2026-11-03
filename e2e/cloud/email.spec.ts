import { expect, openSettings, REMINDERS_ON, savedState, seed, stored, test } from '../fixtures';
import { FakeCloud, SESSION } from '../fakeCloud';

let cloud: FakeCloud;
test.beforeEach(async ({ context }) => {
  cloud = new FakeCloud();
  cloud.state = stored({ reminders: REMINDERS_ON });
  await cloud.install(context);
});

async function emailSettings(page: import('@playwright/test').Page) {
  await seed(page, stored({ reminders: REMINDERS_ON }), { 'ledger-session': SESSION });
  await page.goto('dashboard');
  await openSettings(page);
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await dialog.getByLabel('Email me the daily digest').check();
  return dialog;
}

test.describe('cloud build: email digest settings', () => {
  test('turning on the email digest saves the address and syncs it to the cloud', async ({ page }) => {
    const dialog = await emailSettings(page);
    const address = dialog.getByLabel('Digest email address');
    await address.fill('tech@phaneroo.org');
    await address.blur();
    await expect.poll(async () => (await savedState(page)).state.reminders).toMatchObject({ emailDigest: true, email: 'tech@phaneroo.org' });
    await expect.poll(() => cloud.state?.state.reminders.email).toBe('tech@phaneroo.org');
  });

  test('rejects an invalid address and keeps Send test disabled', async ({ page }) => {
    const dialog = await emailSettings(page);
    await dialog.getByLabel('Digest email address').fill('not-an-email');
    await expect(dialog).toContainText('Enter a valid email address');
    await expect(dialog.getByRole('button', { name: 'Send test email' })).toBeDisabled();
  });

  test('Send test email reports success', async ({ page }) => {
    const dialog = await emailSettings(page);
    await dialog.getByLabel('Digest email address').fill('tech@phaneroo.org');
    await dialog.getByRole('button', { name: 'Send test email' }).click();
    await expect(dialog).toContainText('Sent to tech@phaneroo.org');
    expect(cloud.testEmails).toEqual(['tech@phaneroo.org']);
  });

  test('Send test email shows why it failed', async ({ page }) => {
    cloud.emailError = "email isn't set up on the server yet (RESEND_API_KEY)";
    const dialog = await emailSettings(page);
    await dialog.getByLabel('Digest email address').fill('tech@phaneroo.org');
    await dialog.getByRole('button', { name: 'Send test email' }).click();
    await expect(dialog).toContainText("Couldn't send: email isn't set up on the server yet (RESEND_API_KEY)");
  });
});
