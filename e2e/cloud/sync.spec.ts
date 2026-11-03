import { drawer, expect, openTaskLink, savedState, seed, stored, task, test } from '../fixtures';
import { FakeCloud, SESSION } from '../fakeCloud';

let cloud: FakeCloud;
test.beforeEach(async ({ context }) => {
  cloud = new FakeCloud();
  await cloud.install(context);
});

const signedIn = { 'ledger-session': SESSION };

test.describe('cloud build: sync (review item 2)', () => {
  test('uploads an edit with a fresh timestamp', async ({ page }) => {
    cloud.state = stored({ tasks: [task('a', 'Book venue', 3)] });
    await seed(page, stored({ tasks: [task('a', 'Book venue', 3)] }), signedIn);
    await openTaskLink(page, 'a');
    await drawer(page).getByRole('button', { name: 'High', exact: true }).click();
    await expect.poll(() => cloud.state?.state.tasks[0].priority).toBe('high');
    expect(cloud.state!.state.tasks[0].updatedAt).toBeGreaterThan(1);
  });

  test('brings in edits made on another device when the app comes back into view', async ({ page }) => {
    cloud.state = stored({ tasks: [task('a', 'Book venue', 3)] });
    await seed(page, stored({ tasks: [task('a', 'Book venue', 3)] }), signedIn);
    await page.goto('tasks');
    await expect(page.getByText('Book venue')).toBeVisible();

    cloud.state = stored({ tasks: [task('a', 'Book venue', 3), task('b', 'Added on my phone', 4, { updatedAt: Date.now() })] });
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect(page.getByText('Added on my phone')).toBeVisible();
  });

  test('keeps an edit made offline, even across a reload, and uploads it when back online', async ({ page }) => {
    cloud.state = stored({ tasks: [task('a', 'Draft budget', 3)] });
    await seed(page, stored({ tasks: [task('a', 'Draft budget', 3)] }), signedIn);
    await openTaskLink(page, 'a');

    cloud.down = true;
    await drawer(page).getByRole('button', { name: 'Low', exact: true }).click();
    await expect.poll(() => page.evaluate(() => localStorage.getItem('ledger-sync-pending'))).toBe('1');
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect((await savedState(page)).state.tasks[0].priority).toBe('low');
    expect(cloud.state.state.tasks[0].priority).toBe('med'); // the cloud still has the old copy

    cloud.down = false;
    await page.reload();
    await expect.poll(() => cloud.state?.state.tasks[0].priority).toBe('low');
    await expect.poll(() => page.evaluate(() => localStorage.getItem('ledger-sync-pending'))).toBeNull();
    expect((await savedState(page)).state.tasks[0].priority).toBe('low');
  });

  test('deleting a task removes it from the cloud copy and remembers the deletion', async ({ page }) => {
    page.on('dialog', (d) => d.accept());
    cloud.state = stored({ tasks: [task('a', 'Old idea', 3), task('b', 'Keep me', 4)] });
    await seed(page, stored({ tasks: [task('a', 'Old idea', 3), task('b', 'Keep me', 4)] }), signedIn);
    await openTaskLink(page, 'a');
    await drawer(page).getByRole('button', { name: 'Delete', exact: true }).click();
    await expect.poll(() => cloud.state?.state.tasks.map((t) => t.id)).toEqual(['b']);
    expect(Object.keys(cloud.state!.state.deleted)).toEqual(['task:default:a']);
  });

  test("a stale copy from another device can't bring a deleted task back", async ({ page }) => {
    cloud.state = stored({ tasks: [task('b', 'Keep me', 4)], deleted: { 'task:default:a': Date.now() } });
    // This browser still has the task from before it was deleted elsewhere.
    await seed(page, stored({ tasks: [task('a', 'Deleted elsewhere', 3), task('b', 'Keep me', 4)] }), signedIn);
    await page.goto('tasks');
    await expect(page.getByText('Keep me')).toBeVisible();
    await expect(page.getByText('Deleted elsewhere')).toHaveCount(0);
  });
});
