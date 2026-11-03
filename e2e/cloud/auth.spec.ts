import { expect, openSettings, seed, stored, task, test } from '../fixtures';
import { FakeCloud, PASSWORD, SESSION } from '../fakeCloud';

let cloud: FakeCloud;
test.beforeEach(async ({ context }) => {
  cloud = new FakeCloud();
  await cloud.install(context);
});

const unlock = (page: import('@playwright/test').Page) => page.getByRole('button', { name: 'Unlock' });

test.describe('cloud build: sign-in and sessions', () => {
  test('shows the sign-in screen and rejects a wrong password', async ({ page }) => {
    await seed(page, null);
    await page.goto('dashboard');
    await expect(unlock(page)).toBeVisible();
    await page.getByPlaceholder('Password').fill('nope');
    await unlock(page).click();
    await expect(page.getByText('Incorrect password')).toBeVisible();
    await expect(page.getByPlaceholder('Password')).toHaveValue('');
  });

  test('explains when there have been too many attempts', async ({ page }) => {
    cloud.loginAttempts = 5;
    await seed(page, null);
    await page.goto('dashboard');
    await page.getByPlaceholder('Password').fill(PASSWORD);
    await unlock(page).click();
    await expect(page.getByText('Too many attempts — try again in a few minutes')).toBeVisible();
  });

  test("explains when the server can't be reached", async ({ page }) => {
    cloud.broken = true;
    await seed(page, null);
    await page.goto('dashboard');
    await page.getByPlaceholder('Password').fill(PASSWORD);
    await unlock(page).click();
    await expect(page.getByText("Can't reach Ledger's server — check your connection")).toBeVisible();
  });

  test("signs in and merges the cloud copy with this browser's data", async ({ page }) => {
    cloud.state = stored({ tasks: [task('cloud', 'From the cloud', 1, { updatedAt: 50 })] });
    await seed(page, stored({ tasks: [task('local', 'From this browser', 2, { updatedAt: 60 })] }));
    await page.goto('tasks');
    await page.getByPlaceholder('Password').fill(PASSWORD);
    await unlock(page).click();
    await expect(page.getByText('From the cloud')).toBeVisible();
    await expect(page.getByText('From this browser')).toBeVisible();
    // The session token, never the password or its hash, is what the browser keeps.
    const kept = await page.evaluate(() => ({ session: localStorage.getItem('ledger-session'), legacy: localStorage.getItem('ledger-auth-token') }));
    expect(kept.session).toMatch(/^session-/);
    expect(kept.legacy).toBeNull();
  });

  test('locks again when the server rejects the saved session', async ({ page }) => {
    await seed(page, stored(), { 'ledger-session': 'expired-token' });
    await page.goto('dashboard');
    await expect(unlock(page)).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('ledger-session'))).toBeNull();
  });

  test('Sign out (this device) ends the session and returns to the sign-in screen', async ({ page }) => {
    cloud.state = stored();
    await seed(page, stored(), { 'ledger-session': SESSION });
    await page.goto('dashboard');
    await openSettings(page);
    await page.getByRole('button', { name: 'This device' }).click();
    await expect(unlock(page)).toBeVisible();
    expect(cloud.signOuts).toEqual(['this']);
    expect(cloud.sessions.has(SESSION)).toBe(false);
  });

  test('Sign out on all devices ends every session', async ({ page }) => {
    cloud.state = stored();
    cloud.sessions.add('other-device');
    await seed(page, stored(), { 'ledger-session': SESSION });
    await page.goto('dashboard');
    await openSettings(page);
    await page.getByRole('button', { name: 'All devices' }).click();
    await expect(unlock(page)).toBeVisible();
    expect(cloud.signOuts).toEqual(['all']);
    expect(cloud.sessions.size).toBe(0);
  });

  test('the cloud build does not show the local-only label', async ({ page }) => {
    cloud.state = stored();
    await seed(page, stored(), { 'ledger-session': SESSION });
    await page.goto('dashboard');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByText('Local only · this browser')).toHaveCount(0);
  });
});
