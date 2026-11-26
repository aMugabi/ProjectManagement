import { drawer, expect, HOME, openSettings, openSidebar, openTaskLink, savedState, seed, stored, task, test } from '../fixtures';

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

  test('sorts projects into products and partners, after a dry run', async ({ page }) => {
    page.on('dialog', (dlg) => dlg.accept());
    const MTN = { ...HOME, id: 'loans-mtn', name: 'Loans MTN', color: '#7b6a94' };
    const CARDS = { ...HOME, id: 'cards', name: 'Cards', color: '#4f7a86' };
    await seed(
      page,
      stored({
        projects: [HOME, MTN, CARDS],
        tasks: [
          task('a', 'Settlement file', 2, { project: 'loans-mtn' }),
          task('b', 'Card limits', 2, { project: 'cards', status: 'done' }),
          task('c', 'Home item', 2),
        ],
      }),
    );
    await page.goto('dashboard');
    await openSettings(page);
    await page.getByRole('dialog', { name: 'Settings' }).getByRole('button', { name: 'Open' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sort projects');
    await expect(page.getByRole('row', { name: /Cards/ })).toContainText('0 open · 1 done');

    await page.getByLabel('What "Loans MTN" becomes').selectOption('pair');
    await page.getByLabel('Product for "Loans MTN"').fill('Loans');
    await expect(page.getByText('Give a name for: Loans MTN.')).toBeVisible(); // the partner has no name yet
    await expect(page.getByRole('button', { name: 'Sort projects' })).toBeDisabled();
    await page.getByLabel('Partner for "Loans MTN"').fill('MTN');
    await page.getByLabel('What "Cards" becomes').selectOption('product');
    const dry = page.getByLabel('Dry run');
    await expect(dry).toContainText('2 projects sorted, 1 project stays; 2 items move.');
    await expect(dry).toContainText('New products: Loans, Cards. New partners: MTN.');
    await expect(dry).toContainText('New pairs: Loans · MTN.');
    expect((await savedState(page)).state.products).toEqual([]); // a dry run changes nothing

    await page.getByRole('button', { name: 'Sort 2 projects' }).click();
    await expect(page.getByRole('status')).toHaveText('Done: 2 projects sorted and 2 items moved; 3 items before and after.');
    await expect.poll(async () => (await savedState(page)).state.projects.map((p) => p.id)).toEqual(['home']);
    const { state } = await savedState(page);
    expect(state.products.map((p) => [p.id, p.name, p.color])).toEqual([['loans', 'Loans', '#7b6a94'], ['cards', 'Cards', '#4f7a86']]);
    expect(state.partners.map((p) => p.name)).toEqual(['MTN']);
    expect(state.pairs.map((p) => p.id)).toEqual(['loans+mtn']);
    expect(state.tasks.map((t) => [t.id, t.project, t.product ?? '', t.partner ?? '', t.status])).toEqual([
      ['a', '', 'loans', 'mtn', 'todo'],
      ['b', '', 'cards', '', 'done'],
      ['c', 'home', '', '', 'todo'],
    ]);
    expect(Object.keys(state.deleted)).toEqual(expect.arrayContaining(['project:default:loans-mtn', 'project:default:cards']));
    await expect(page.getByLabel('What "Home" becomes')).toBeVisible(); // only the project left to sort
    await expect(page.getByLabel('What "Cards" becomes')).toHaveCount(0);
  });
});
