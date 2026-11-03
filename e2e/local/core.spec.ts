import { DEFAULT_WS, drawer, expect, HOME, openSidebar, openTaskLink, savedState, seed, stored, task, test } from '../fixtures';

test.describe('local-only build: core task tracking', () => {
  test('opens straight into the app with no password gate and says data is local', async ({ page }) => {
    await seed(page, null);
    await page.goto('dashboard');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Unlock' })).toHaveCount(0);
    await openSidebar(page);
    await expect(page.getByText('Local only · this browser')).toBeVisible();
  });

  test('creates a project and a task, and keeps them after a reload', async ({ page }) => {
    await seed(page, null);
    await page.goto('dashboard');
    await openSidebar(page);
    await page.getByRole('button', { name: 'Add project' }).click();
    await page.getByPlaceholder('Project name').fill('Garden');
    await page.getByPlaceholder('Project name').press('Enter');

    await page.goto('tasks');
    await page.keyboard.press('n');
    await page.getByPlaceholder('What needs doing?').fill('Plant tulips');
    await page.getByRole('button', { name: 'Add task' }).click();
    await expect(page.getByText('Plant tulips', { exact: true })).toBeVisible();

    await page.reload();
    await expect(page.getByText('Plant tulips', { exact: true })).toBeVisible();
    const { state } = await savedState(page);
    expect(state.projects.map((p) => p.name)).toEqual(['Garden']);
    expect(state.tasks[0]).toMatchObject({ title: 'Plant tulips', project: 'garden' });
    expect(state.tasks[0].updatedAt).toBeGreaterThan(1);
  });

  test('edits priority and repeat in the drawer; completing a weekly task rolls it to next week', async ({ page }) => {
    await seed(page, stored({ tasks: [task('a', 'Water plants', 0, { subs: [{ text: 'Front', done: true }] })] }));
    await openTaskLink(page, 'a');
    await drawer(page).getByRole('button', { name: 'High', exact: true }).click();
    await drawer(page).locator('select').filter({ hasText: 'Does not repeat' }).selectOption('weekly');
    await drawer(page).getByRole('button', { name: 'Complete & repeat' }).click();

    const t = (await savedState(page)).state.tasks[0];
    const expected = new Date();
    expected.setDate(expected.getDate() + 7);
    expect(t).toMatchObject({ priority: 'high', recurring: 'weekly', status: 'todo' });
    expect(t.dueDate).toBe(expected.toLocaleDateString('en-CA'));
    expect(t.subs[0].done).toBe(false);
  });

  test('deleting a task unblocks the tasks that depended on it (review item 1)', async ({ page }) => {
    page.on('dialog', (d) => d.accept());
    await seed(page, stored({ tasks: [task('c', 'Pack bags', 5, { deps: ['d'] }), task('d', 'Buy suitcase', 3)] }));
    await page.goto('tasks');
    await expect(page.getByText('Blocked').first()).toBeVisible();

    await openTaskLink(page, 'd');
    await drawer(page).getByRole('button', { name: 'Delete', exact: true }).click();
    await openTaskLink(page, 'c');
    await expect(page.getByText(/Blocked · waiting/)).toHaveCount(0);

    const { state } = await savedState(page);
    expect(state.tasks.find((t) => t.id === 'c')?.deps).toEqual([]);
    expect(Object.keys(state.deleted)).toEqual(['task:default:d']);
  });

  test('never offers a dependency that would create a loop (review item 4)', async ({ page }) => {
    await seed(page, stored({ tasks: [task('a', 'Alpha', 1, { deps: ['b'] }), task('b', 'Bravo', 2, { deps: ['c'] }), task('c', 'Charlie', 3), task('d', 'Delta', 4)] }));
    await openTaskLink(page, 'c');
    const options = await drawer(page).locator('select').filter({ hasText: '+ Add dependency' }).locator('option').allTextContents();
    expect(options).toEqual(['+ Add dependency', 'Delta']);
  });

  test('a dependency on a missing task can be seen and removed', async ({ page }) => {
    await seed(page, stored({ tasks: [task('a', 'Orphaned task', 1, { deps: ['ghost'] })] }));
    await openTaskLink(page, 'a');
    await expect(page.getByText('Blocked · waiting on a missing task')).toBeVisible();
    await page.getByRole('button', { name: 'Remove dependency on "Missing task"' }).click();
    await expect(page.getByText(/Blocked · waiting/)).toHaveCount(0);
  });

  test('upgrades data saved by the previous version (v2, no timestamps)', async ({ page }) => {
    const legacy = {
      state: {
        tasks: [{ ...task('a', 'Old task', 2), updatedAt: undefined }],
        projects: [{ id: 'home', name: 'Home', color: '#b4674a' }],
        workspaces: [{ id: 'default', name: 'My Workspace' }],
        activeWorkspaceId: 'default',
        workspaceData: {},
      },
      version: 2,
    };
    await seed(page, legacy);
    await page.goto('tasks');
    await expect(page.getByText('Old task')).toBeVisible();
    // The upgrade is written back on the first save; trigger one.
    await openTaskLink(page, 'a');
    await drawer(page).getByRole('button', { name: 'Low', exact: true }).click();
    const saved = await savedState(page);
    expect(saved.version).toBe(3);
    expect(saved.state.reminders.digestTime).toBe('08:00');
    expect(saved.state.projects[0].updatedAt).toBe(0);
  });

  test('keeps workspaces separate and switches between them', async ({ page }) => {
    await seed(
      page,
      stored({
        tasks: [task('h', 'Home chore', 1)],
        workspaces: [DEFAULT_WS, { id: 'work', name: 'Work', updatedAt: 1 }],
        workspaceData: { work: { projects: [{ ...HOME, id: 'ops', name: 'Ops' }], tasks: [task('w', 'Ship report', 1, { project: 'ops' })] } },
      }),
    );
    await page.goto('tasks');
    await expect(page.getByText('Home chore', { exact: true })).toBeVisible();
    await expect(page.getByText('Ship report', { exact: true })).toHaveCount(0);
    await openSidebar(page);
    await page.getByRole('button', { name: /My Workspace/ }).click();
    await page.getByRole('button', { name: 'Work', exact: true }).click();
    await expect(page.getByText('Ship report', { exact: true })).toBeVisible();
    await expect(page.getByText('Home chore', { exact: true })).toHaveCount(0);
  });

  test('list, board and timeline views render the tasks', async ({ page }) => {
    await seed(page, stored({ tasks: [task('a', 'Write intro', 1), task('b', 'Edit draft', 2, { status: 'doing' })] }));
    await page.goto('tasks');
    await expect(page.getByText('Write intro', { exact: true })).toBeVisible();
    await page.goto('tasks?view=board');
    await expect(page.getByText('In progress').first()).toBeVisible();
    await expect(page.getByText('Edit draft', { exact: true })).toBeVisible();
    await page.goto('timeline');
    await expect(page.getByText('Write intro', { exact: true })).toBeVisible();
  });
});
