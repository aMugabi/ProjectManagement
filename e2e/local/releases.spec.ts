import { expect, HOME, openSidebar, savedState, seed, stored, test } from '../fixtures';

const LOANS = { ...HOME, id: 'loans', name: 'Loans', color: '#7b6a94' };
const TELCO = { ...HOME, id: 'telco', name: 'Telco', color: '#4f7a86' };

test.describe('local-only build: releases and sign-offs (Step 3)', () => {
  test('adds a release for a product with a partner, which brings the default stages', async ({ page }) => {
    await seed(page, stored({ products: [LOANS], partners: [TELCO] }));
    await page.goto('dashboard');
    await openSidebar(page);
    await page.getByRole('button', { name: /Releases/ }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Releases');
    await page.getByRole('button', { name: '+ New release' }).click();
    await page.getByLabel('Release name').fill('Loans v2');
    await page.getByLabel('Target date').fill('2026-12-15');
    await page.getByRole('button', { name: 'Add release' }).click();
    const group = page.getByRole('region', { name: 'Loans · Telco' });
    await expect(group).toContainText('Loans v2');
    await expect(group).toContainText('Not started');
    await expect(page.getByLabel('Stages of Loans v2')).toHaveText(/SIT.*UAT.*UVT.*InfoSec.*Go-live/);
    const { state } = await savedState(page);
    expect(state.releases).toMatchObject([{ product: 'loans', partner: 'telco', name: 'Loans v2', targetDate: '2026-12-15' }]);
    expect(state.pairs.map((p) => p.id)).toEqual(['loans+telco']);
    expect(state.stages.map((s) => s.name)).toEqual(['SIT', 'UAT', 'UVT', 'InfoSec', 'Go-live']);
  });

  test('signs off a stage, refuses a bad evidence link, and fixes a mistake with a correction', async ({ page }) => {
    const stages = ['SIT', 'UAT'].map((name, i) => ({ id: name.toLowerCase(), name, order: i + 1, updatedAt: 1 }));
    await seed(
      page,
      stored({
        products: [LOANS],
        partners: [TELCO],
        pairs: [{ id: 'loans+telco', product: 'loans', partner: 'telco', updatedAt: 1 }],
        stages,
        releases: [{ id: 'rel-1', product: 'loans', partner: 'telco', name: 'Loans v2', updatedAt: 1 }],
      }),
    );
    await page.goto('releases');
    await page.getByRole('button', { name: /Loans v2/ }).click();
    await page.getByRole('button', { name: 'Sign off SIT for Loans v2' }).click();
    const form = page.getByRole('form', { name: 'Sign-off' });
    await form.getByLabel('Outcome').selectOption('failed');
    await form.getByLabel('Approver').fill('Jane Okello');
    await form.getByLabel('Role').fill('Head of QA');
    await form.getByLabel('Signed at').fill('2026-11-25T14:30');
    await form.getByLabel('Evidence link').fill('file:///c:/report.pdf');
    await form.getByRole('button', { name: 'Record sign-off' }).click();
    await expect(form.getByRole('alert')).toHaveText('Not recorded: the evidence is not a web link (http:// or https://).');
    await form.getByLabel('Evidence link').fill('https://bank.example/sit/1');
    await form.getByRole('button', { name: 'Record sign-off' }).click();
    await expect(form).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Loans · Telco' })).toContainText('Failed at SIT');

    // Entered as failed by mistake: correct it.
    await page.getByRole('button', { name: 'Correct sign-off by Jane Okello on SIT' }).click();
    await form.getByLabel('Outcome').selectOption('passed');
    await form.getByLabel('Note').fill('Entered as failed by mistake');
    await form.getByRole('button', { name: 'Record correction' }).click();
    await expect(page.getByRole('region', { name: 'Loans · Telco' })).toContainText('Next: UAT');
    const history = page.getByLabel('History of Loans v2');
    await expect(history).toContainText('corrected by Jane Okello');
    await expect(history).toContainText('corrects an earlier entry');

    const { state } = await savedState(page);
    expect(state.signoffs.map((s) => [s.outcome, s.stageName, s.approver, s.role, s.signedAt, s.evidence, Boolean(s.corrects)])).toEqual([
      ['failed', 'SIT', 'Jane Okello', 'Head of QA', '2026-11-25T14:30', 'https://bank.example/sit/1', false],
      ['passed', 'SIT', 'Jane Okello', 'Head of QA', '2026-11-25T14:30', 'https://bank.example/sit/1', true],
    ]);
    expect(state.signoffs[1].corrects).toBe(state.signoffs[0].id);

    // What a sign-off names stays: the release can't be deleted, nor the stage.
    await expect(page.getByRole('button', { name: 'Delete release' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Delete stage SIT' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Delete stage UAT' })).toBeEnabled();
  });

  test('edits the stage template, and keeps a product with releases from being deleted', async ({ page }) => {
    const messages: string[] = [];
    page.on('dialog', (dlg) => {
      messages.push(dlg.message());
      void dlg.accept();
    });
    await seed(
      page,
      stored({
        products: [LOANS],
        partners: [TELCO],
        pairs: [{ id: 'loans+telco', product: 'loans', partner: 'telco', updatedAt: 1 }],
        stages: ['SIT', 'UAT'].map((name, i) => ({ id: name.toLowerCase(), name, order: i + 1, updatedAt: 1 })),
        releases: [{ id: 'rel-1', product: 'loans', partner: 'telco', name: 'Loans v2', updatedAt: 1 }],
      }),
    );
    await page.goto('releases');
    const stages = page.getByRole('region', { name: 'Stages' });
    await stages.getByLabel('New stage').fill('Pen test');
    await stages.getByRole('button', { name: 'Add stage' }).click();
    await stages.getByRole('button', { name: 'Move Pen test earlier' }).click();
    await expect(page.getByLabel('Stages of Loans v2')).toHaveText(/SIT.*Pen test.*UAT/);
    await stages.getByRole('button', { name: 'Delete stage UAT' }).click();
    await expect(page.getByLabel('Stages of Loans v2')).not.toContainText('UAT');
    expect(Object.keys((await savedState(page)).state.deleted)).toContain('stage:default:uat');

    await openSidebar(page);
    await page.getByRole('button', { name: 'Delete "Loans"' }).click();
    await expect.poll(() => messages).toEqual(['"Loans" has 1 release, so it can\'t be deleted: their sign-offs are records that keep it.']);
    expect((await savedState(page)).state.products.map((p) => p.id)).toEqual(['loans']);
  });
});
