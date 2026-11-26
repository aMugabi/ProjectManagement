import { expect, openSettings, savedState, seed, stored, task, test } from '../fixtures';
import { EMAIL, FakeCloud, MFA_CODE, PASSWORD, SESSION } from '../fakeCloud';

let cloud: FakeCloud;
test.beforeEach(async ({ context }) => {
  cloud = new FakeCloud();
  await cloud.install(context);
});

type Page = import('@playwright/test').Page;
const unlock = (page: Page) => page.getByRole('button', { name: 'Unlock' });
/** Every Ledger key left in this browser's storage (null while the page is reloading, so polls retry). */
const ledgerKeys = (page: Page) =>
  page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('ledger-'))).catch(() => null);

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

  test('without MFA set up, asks for the password only', async ({ page }) => {
    cloud.state = stored();
    await seed(page, null);
    await page.goto('dashboard');
    await expect(unlock(page)).toBeVisible();
    await expect(page.getByLabel('Authenticator code')).toHaveCount(0);
    await page.getByPlaceholder('Password').fill(PASSWORD);
    await unlock(page).click();
    await expect(unlock(page)).toHaveCount(0);
    expect(cloud.loginBodies).toEqual([{ password: PASSWORD }]);
  });

  test('with MFA, asks for a code and refuses a wrong one without saying which part was wrong', async ({ page }) => {
    cloud.mfa = true;
    cloud.state = stored({ tasks: [task('c', 'From the cloud', 1)] });
    await seed(page, null);
    await page.goto('tasks');
    const code = page.getByLabel('Authenticator code');
    await expect(code).toBeVisible();
    await page.getByPlaceholder('Password').fill(PASSWORD);
    await expect(unlock(page)).toBeDisabled(); // the code is required
    await code.fill('000000');
    await unlock(page).click();
    await expect(page.getByText('Incorrect password or code')).toBeVisible();
    await expect(code).toHaveValue('');

    await page.getByPlaceholder('Password').fill(PASSWORD);
    await code.fill(` ${MFA_CODE} `);
    await unlock(page).click();
    await expect(page.getByText('From the cloud')).toBeVisible();
    expect(cloud.loginBodies.at(-1)).toEqual({ password: PASSWORD, code: MFA_CODE });
  });

  test('signing in by email (the Postgres store) asks for email, password and code', async ({ page }) => {
    cloud.emailLogin = true;
    cloud.state = stored({ tasks: [task('c', 'From the cloud', 1)] });
    await seed(page, null);
    await page.goto('tasks');
    const email = page.getByLabel('Email');
    await expect(email).toBeVisible();
    await expect(email).toBeFocused();
    await page.getByPlaceholder('Password').fill(PASSWORD);
    await page.getByLabel('Authenticator code').fill(MFA_CODE);
    await expect(unlock(page)).toBeDisabled(); // the email is required
    await email.fill('someone@else.org');
    await unlock(page).click();
    await expect(page.getByText('Incorrect email, password or code')).toBeVisible();

    await email.fill(` ${EMAIL} `);
    await page.getByPlaceholder('Password').fill(PASSWORD);
    await page.getByLabel('Authenticator code').fill(MFA_CODE);
    await unlock(page).click();
    await expect(page.getByText('From the cloud')).toBeVisible();
    expect(cloud.loginBodies.at(-1)).toEqual({ email: EMAIL, password: PASSWORD, code: MFA_CODE });
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

  test('locks again when the server rejects the saved session, deleting the copy when the cloud has it all', async ({ page }) => {
    await seed(page, stored(), { 'ledger-session': 'expired-token' });
    await page.goto('dashboard');
    await expect(unlock(page)).toBeVisible();
    await expect.poll(() => ledgerKeys(page)).toEqual([]);
  });

  test('a rejected session keeps edits the cloud has not received yet', async ({ page }) => {
    await seed(page, stored({ tasks: [task('mine', 'Not uploaded yet', 1)] }), {
      'ledger-session': 'expired-token',
      'ledger-sync-pending': '1',
    });
    await page.goto('dashboard');
    await expect(unlock(page)).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('ledger-session'))).toBeNull();
    expect((await savedState(page)).state.tasks.map((t) => t.title)).toEqual(['Not uploaded yet']);
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
    // Nothing of Ledger's is left in this browser.
    await expect.poll(() => ledgerKeys(page)).toEqual([]);
  });

  test('Sign out uploads unsynced edits first', async ({ page }) => {
    cloud.state = stored();
    await seed(page, stored({ tasks: [task('mine', 'Made offline', 1, { updatedAt: 99 })] }), {
      'ledger-session': SESSION,
      'ledger-sync-pending': '1',
    });
    cloud.down = true; // the edit can't be uploaded at start-up
    await page.goto('dashboard');
    await openSettings(page);
    cloud.down = false;
    await page.getByRole('button', { name: 'This device' }).click();
    await expect(unlock(page)).toBeVisible();
    expect(cloud.state!.state.tasks.map((t) => t.title)).toEqual(['Made offline']);
    await expect.poll(() => ledgerKeys(page)).toEqual([]);
  });

  test('Sign out asks before deleting edits it cannot upload', async ({ page }) => {
    cloud.state = stored();
    await seed(page, stored({ tasks: [task('mine', 'Made offline', 1)] }), {
      'ledger-session': SESSION,
      'ledger-sync-pending': '1',
    });
    cloud.down = true;
    await page.goto('dashboard');
    await openSettings(page);
    await page.getByRole('button', { name: 'This device' }).click();
    await expect(page.getByText("Some changes on this device haven't reached the cloud yet")).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();
    expect((await savedState(page)).state.tasks.map((t) => t.title)).toEqual(['Made offline']);

    await page.getByRole('button', { name: 'This device' }).click();
    await page.getByRole('button', { name: 'Sign out anyway' }).click();
    await expect(unlock(page)).toBeVisible();
    await expect.poll(() => ledgerKeys(page)).toEqual([]);
  });

  test('Sign out on all devices ends every session', async ({ page }) => {
    cloud.state = stored();
    cloud.sessions.add('other-device');
    await seed(page, stored(), { 'ledger-session': SESSION });
    await page.goto('dashboard');
    await openSettings(page);
    cloud.subs.set('https://push.example/lost-phone', { endpoint: 'https://push.example/lost-phone', keys: { p256dh: 'k', auth: 'a' } });
    await page.getByRole('button', { name: 'All devices' }).click();
    await expect(unlock(page)).toBeVisible();
    expect(cloud.signOuts).toEqual(['all']);
    expect(cloud.sessions.size).toBe(0);
    expect(cloud.subs.size).toBe(0); // no device keeps receiving reminders
    await expect.poll(() => ledgerKeys(page)).toEqual([]);
  });

  test('the cloud build does not show the local-only label', async ({ page }) => {
    cloud.state = stored();
    await seed(page, stored(), { 'ledger-session': SESSION });
    await page.goto('dashboard');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByText('Local only · this browser')).toHaveCount(0);
  });
});
