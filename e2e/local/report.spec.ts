import { readFileSync } from 'node:fs';
import { expect, HOME, iso, openSidebar, seed, stored, task, test } from '../fixtures';

const LOANS = { ...HOME, id: 'loans', name: 'Loans', color: '#7b6a94' };
// The Tuesday of next week, as the report counts weeks (Monday to Sunday).
const weekday = new Date().getDay();
const nextTuesday = (((8 - weekday) % 7) || 7) + 1;

const data = () =>
  stored({
    products: [LOANS],
    tasks: [
      task('done', 'Sent the settlement file', 0, { project: '', product: 'loans', status: 'done', completedOn: iso(0) }),
      task('rec', 'Weekly reconciliation', 7, { project: '', product: 'loans', recurring: 'weekly', completions: [iso(0)] }),
      task('risk', 'Telco outage', 5, { project: '', product: 'loans', type: 'risk', status: 'mitigating', details: { likelihood: 'high' }, updatedAt: Date.now() }),
      task('wait', 'Card limits', 9, { project: '', product: 'loans', waitingOn: 'Telco IT' }),
      task('late', 'Renew licence', -3, { project: '', product: 'loans' }),
      task('next', 'Board pack', nextTuesday, { project: '', product: 'loans' }),
      task('home', 'Home chore', 0, { status: 'done', completedOn: iso(0) }),
    ],
  });

/** Records what the page copies instead of touching the real clipboard; `fail` makes copying fail. */
async function stubClipboard(page: import('@playwright/test').Page, fail = false) {
  await page.addInitScript((fail) => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          if (fail) throw new Error('not allowed');
          (window as unknown as { __copied: string }).__copied = text;
        },
      },
    });
  }, fail);
}

test.describe('local-only build: the weekly report (Step 4)', () => {
  test("shows a product's week, section by section", async ({ page }) => {
    await seed(page, data());
    await page.goto('dashboard');
    await openSidebar(page);
    await page.getByRole('button', { name: /Weekly report/ }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Weekly report');
    await page.getByLabel('Report on').selectOption('product:loans');
    const section = (name: string) => page.getByRole('region', { name, exact: true });
    await expect(section('Done')).toContainText('Sent the settlement file');
    await expect(section('Done')).toContainText('Weekly reconciliation');
    await expect(section('Done')).not.toContainText('Home chore'); // another project
    await expect(section('Risks and issues that changed')).toContainText('Likelihood: high');
    await expect(section('Waiting on others')).toContainText('waiting on Telco IT');
    await expect(section('Overdue')).toContainText('Renew licence');
    await expect(section('Due next week')).toContainText('Board pack');

    await page.getByRole('button', { name: 'Previous week' }).click();
    await expect(section('Done')).toContainText('Nothing.');
    await page.getByRole('button', { name: 'This week' }).click();
    await expect(section('Done')).toContainText('Sent the settlement file');
  });

  test('copies the report as email text, and downloads it as CSV', async ({ page }) => {
    await stubClipboard(page);
    await seed(page, data());
    await page.goto('report');
    await page.getByLabel('Report on').selectOption('product:loans');
    await page.getByRole('button', { name: 'Copy as email text' }).click();
    await expect(page.getByRole('status')).toHaveText('Copied: paste it into an email.');
    const text = await page.evaluate(() => (window as unknown as { __copied: string }).__copied);
    expect(text).toMatch(/^Weekly report: Loans \(product\), \d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2}\n\nDONE \(2\)\n/);
    expect(text).toContain('OVERDUE (1)\n- Renew licence');

    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download CSV' }).click()]);
    expect(download.suggestedFilename()).toMatch(/^ledger-report-product-loans-\d{4}-\d{2}-\d{2}\.csv$/);
    const csv = readFileSync((await download.path())!, 'utf8').split('\r\n');
    expect(csv[0]).toBe('section,title,belongs to,type,status,date,detail');
    expect(csv).toContain(`Overdue,Renew licence,Loans,Task,To do,${iso(-3)},`);
  });

  test('shows the text to copy by hand when the browser refuses', async ({ page }) => {
    await stubClipboard(page, true);
    await seed(page, data());
    await page.goto('report');
    await page.getByRole('button', { name: 'Copy as email text' }).click();
    await expect(page.getByLabel('Report text')).toHaveValue(/^Weekly report: All items/);
  });
});
