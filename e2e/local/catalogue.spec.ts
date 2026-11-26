import { drawer, expect, HOME, openSidebar, openTaskLink, savedState, seed, stored, task, test } from '../fixtures';

const LOANS = { ...HOME, id: 'loans', name: 'Loans', color: '#7b6a94' };
const TELCO = { ...HOME, id: 'telco', name: 'Telco', color: '#4f7a86' };

test.describe('local-only build: products, partners and item types (Step 1b)', () => {
  test('adds a product and a partner from the sidebar', async ({ page }) => {
    await seed(page, stored());
    await page.goto('dashboard');
    await openSidebar(page);
    await page.getByRole('button', { name: 'Add product' }).click();
    await page.getByPlaceholder('Product name').fill('Mobile loans');
    await page.getByPlaceholder('Product name').press('Enter');
    await page.getByRole('button', { name: 'Add partner' }).click();
    await page.getByPlaceholder('Partner name').fill('Telco');
    await page.getByPlaceholder('Partner name').press('Enter');
    await expect.poll(async () => (await savedState(page)).state.products.map((p) => p.name)).toEqual(['Mobile loans']);
    expect((await savedState(page)).state.partners.map((p) => p.name)).toEqual(['Telco']);
  });

  test('creates a risk for a product with a partner, making their pair', async ({ page }) => {
    await seed(page, stored({ products: [LOANS], partners: [TELCO] }));
    await page.goto('tasks');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible(); // the app is listening for "n"
    await page.keyboard.press('n');
    await page.getByPlaceholder('What needs doing?').fill('Telco outage');
    await page.getByLabel('Type', { exact: true }).selectOption('risk');
    await page.getByLabel('Belongs to').selectOption('product:loans');
    await page.getByLabel('With partner').selectOption('telco');
    await page.getByRole('button', { name: 'Add risk' }).click();
    await expect(page.getByText('Telco outage', { exact: true })).toBeVisible();
    await expect(page.getByText('Loans · Telco')).toBeVisible(); // the list groups it under the pair
    const { state } = await savedState(page);
    expect(state.tasks[0]).toMatchObject({ title: 'Telco outage', type: 'risk', status: 'open', project: '', product: 'loans', partner: 'telco' });
    expect(state.pairs.map((p) => p.id)).toEqual(['loans+telco']);
  });

  test("shows a risk's own labels, statuses and fields, and closes it", async ({ page }) => {
    await seed(page, stored({ products: [LOANS], tasks: [task('r', 'Telco outage', 3, { project: '', type: 'risk', status: 'open', product: 'loans' })] }));
    await openTaskLink(page, 'r');
    const d = drawer(page);
    await expect(d.getByText('Severity', { exact: true })).toBeVisible();
    await expect(d.getByText('Review by', { exact: true })).toBeVisible();
    await expect(d.getByLabel('Status').locator('option')).toHaveText(['Open', 'Mitigating', 'Closed']);
    await d.getByLabel('Likelihood').selectOption('high');
    await d.getByLabel('Mitigation').fill('Second line');
    await expect.poll(async () => (await savedState(page)).state.tasks[0].details).toEqual({ likelihood: 'high', mitigation: 'Second line' });
    await d.getByRole('button', { name: 'Close risk' }).click();
    await expect.poll(async () => (await savedState(page)).state.tasks[0].status).toBe('closed');
    await d.getByRole('button', { name: 'Reopen risk' }).click();
    await expect.poll(async () => (await savedState(page)).state.tasks[0].status).toBe('open');
  });

  test('changing the type keeps only the fields the new type has', async ({ page }) => {
    await seed(page, stored({ tasks: [task('i', 'Late settlement', 3, { type: 'issue', status: 'open', details: { impact: 'Fees', resolution: 'Retry' } })] }));
    await openTaskLink(page, 'i');
    await drawer(page).getByLabel('Type').selectOption('change_request');
    await expect.poll(async () => (await savedState(page)).state.tasks[0]).toMatchObject({ type: 'change_request', status: 'draft', details: { impact: 'Fees' } });
    await expect(drawer(page).getByRole('button', { name: 'Mark implemented' })).toBeVisible();
  });

  test('the board puts every type in its phase, and the type filter narrows the list', async ({ page }) => {
    await seed(
      page,
      stored({
        tasks: [
          task('t', 'Plain task', 2),
          task('r', 'Mitigating risk', 2, { type: 'risk', status: 'mitigating' }),
          task('d', 'Open decision', 2, { type: 'decision', status: 'proposed' }),
        ],
      }),
    );
    await page.goto('tasks?view=board');
    const column = (name: string) => page.locator('div', { has: page.getByText(name, { exact: true }) }).filter({ hasText: name });
    await expect(column('In progress').getByText('Mitigating risk')).toBeVisible();
    await expect(column('To do').getByText('Open decision')).toBeVisible();
    await page.goto('tasks');
    await page.getByLabel('Item type').selectOption('risk');
    await expect(page.getByText('Mitigating risk', { exact: true })).toBeVisible();
    await expect(page.getByText('Plain task', { exact: true })).toHaveCount(0);
  });

  test('filters by a product from the sidebar, and deleting it keeps its items', async ({ page }) => {
    page.on('dialog', (dlg) => dlg.accept());
    await seed(
      page,
      stored({
        products: [LOANS],
        partners: [TELCO],
        pairs: [{ id: 'loans+telco', product: 'loans', partner: 'telco', updatedAt: 1 }],
        tasks: [task('a', 'Loan item', 2, { project: '', product: 'loans', partner: 'telco' }), task('b', 'Home item', 2)],
      }),
    );
    await page.goto('dashboard');
    await openSidebar(page);
    await page.getByRole('button', { name: /^Loans/ }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Loans');
    await expect(page.getByText('Loan item', { exact: true })).toBeVisible();
    await expect(page.getByText('Home item', { exact: true })).toHaveCount(0);

    await openSidebar(page);
    await page.getByRole('button', { name: 'Delete "Loans"' }).click();
    await expect.poll(async () => (await savedState(page)).state.products).toEqual([]);
    const { state } = await savedState(page);
    expect(state.tasks.map((t) => [t.id, t.product ?? '', t.partner ?? ''])).toEqual([['a', '', 'telco'], ['b', '', '']]);
    expect(state.pairs).toEqual([]);
    expect(Object.keys(state.deleted)).toEqual(expect.arrayContaining(['product:default:loans', 'pair:default:loans+telco']));
  });
});
