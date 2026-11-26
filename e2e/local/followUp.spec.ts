import { drawer, expect, iso, openSidebar, openTaskLink, savedState, seed, stored, task, test } from '../fixtures';

test.describe('local-only build: waiting on, chasing and snoozing (Step 2)', () => {
  test('sets who an item waits on and when to chase them, from its details', async ({ page }) => {
    await seed(page, stored({ tasks: [task('a', 'Settlement file', 5)] }));
    await openTaskLink(page, 'a');
    const d = drawer(page);
    await expect(d.getByLabel('Chase on')).toHaveCount(0); // nothing to chase until it waits on someone
    await d.getByLabel('Waiting on').fill('Telco IT');
    await d.getByRole('button', { name: 'Chase tomorrow' }).click();
    await expect.poll(async () => (await savedState(page)).state.tasks[0]).toMatchObject({ waitingOn: 'Telco IT', chaseOn: iso(1) });
    await d.getByLabel('Waiting on').fill('');
    await expect.poll(async () => (await savedState(page)).state.tasks[0].chaseOn).toBeUndefined(); // no one left to chase
  });

  test('moves a due date to tomorrow in one click', async ({ page }) => {
    await seed(page, stored({ tasks: [task('a', 'Pay rent', 0)] }));
    await openTaskLink(page, 'a');
    await drawer(page).getByRole('button', { name: 'Move to tomorrow' }).click();
    await expect.poll(async () => (await savedState(page)).state.tasks[0].dueDate).toBe(iso(1));
  });

  test('a snoozed item leaves the dashboard until its date, and can be woken', async ({ page }) => {
    await seed(page, stored({ tasks: [task('a', 'Pay rent', 0), task('b', 'Call bank', 0)] }));
    await page.goto('dashboard');
    await expect(page.getByText('Pay rent', { exact: true })).toBeVisible();
    await openTaskLink(page, 'a');
    await drawer(page).getByRole('button', { name: 'Snooze until next week' }).click();
    await expect(drawer(page)).toContainText('Until');
    const until = (await savedState(page)).state.tasks.find((t) => t.id === 'a')!.snoozedUntil!;
    expect(until > iso(0) && until <= iso(7)).toBe(true);
    await drawer(page).getByRole('button', { name: 'Close', exact: true }).click();
    await expect(page.getByText('Pay rent', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Call bank', { exact: true })).toBeVisible();
    await expect(page.getByText('2 open · 0 overdue · 1 snoozed')).toBeVisible();

    await openTaskLink(page, 'a');
    await drawer(page).getByRole('button', { name: 'Wake now' }).click();
    await expect.poll(async () => (await savedState(page)).state.tasks.find((t) => t.id === 'a')!.snoozedUntil).toBeUndefined();
  });

  test('the Waiting-on view groups by who, and Chased and Got it follow up', async ({ page }) => {
    await seed(
      page,
      stored({
        tasks: [
          task('a', 'Settlement file', 5, { waitingOn: 'Telco IT', chaseOn: iso(-1) }),
          task('b', 'Card limits', 5, { waitingOn: 'telco it ' }),
          task('c', 'Loan form', 5, { waitingOn: 'Bank ops', chaseOn: iso(4) }),
          task('d', 'Not waiting', 5),
          task('e', 'Finished', 5, { waitingOn: 'Bank ops', status: 'done' }),
        ],
      }),
    );
    await page.goto('dashboard');
    await openSidebar(page);
    await page.getByRole('button', { name: /^⧖ Waiting on 3$/ }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Waiting on');
    const groups = page.getByRole('region', { name: /^Waiting on / });
    await expect(groups).toHaveCount(2);
    await expect(groups.first()).toHaveAccessibleName('Waiting on Telco IT'); // a chase is due there, so it comes first
    await expect(groups.first()).toContainText('Chase 1d late');
    await expect(groups.first()).toContainText('No chase date');
    await expect(groups.nth(1)).toContainText('Chase in 4d');
    await expect(page.getByText('Not waiting')).toHaveCount(0);
    await expect(page.getByText('Finished')).toHaveCount(0);

    await page.getByRole('button', { name: 'Chased about "Settlement file"' }).click();
    await expect.poll(async () => (await savedState(page)).state.tasks.find((t) => t.id === 'a')!.chaseOn).toBe(iso(3));
    await page.getByRole('button', { name: 'Stop waiting on Bank ops for "Loan form"' }).click();
    await expect(page.getByRole('region', { name: 'Waiting on Bank ops' })).toHaveCount(0);
    const c = (await savedState(page)).state.tasks.find((t) => t.id === 'c')!;
    expect([c.waitingOn, c.chaseOn]).toEqual([undefined, undefined]);
  });
});
