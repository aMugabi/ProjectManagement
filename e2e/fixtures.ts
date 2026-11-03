import { test as base, expect, type Page } from '@playwright/test';
import type { Project, ReminderSettings, Task, Workspace } from '../src/types';
import type { StoredState, SyncedState } from '../src/shared/state';

export { expect };

/** Local calendar date `days` from today, as the app stores due dates. */
export function iso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function task(id: string, title: string, dueInDays: number, extra: Partial<Task> = {}): Task {
  return {
    id,
    project: 'home',
    title,
    status: 'todo',
    priority: 'med',
    dueDate: iso(dueInDays),
    subs: [],
    recurring: null,
    deps: [],
    notes: '',
    order: 0,
    updatedAt: 1,
    ...extra,
  };
}

export const HOME: Project = { id: 'home', name: 'Home', color: '#b4674a', updatedAt: 1 };
export const DEFAULT_WS: Workspace = { id: 'default', name: 'My Workspace', updatedAt: 1 };

/** Reminders off unless a test turns them on, so pop-ups don't cover controls in unrelated tests. */
export const REMINDERS_OFF: ReminderSettings = {
  enabled: false,
  digestTime: '00:00',
  defaultLeadDays: 1,
  includeOverdue: true,
  timezone: 'UTC',
  emailDigest: false,
  email: '',
  updatedAt: 1,
};
export const REMINDERS_ON: ReminderSettings = { ...REMINDERS_OFF, enabled: true };

export function stored(partial: Partial<SyncedState> = {}): StoredState {
  return {
    state: {
      tasks: [],
      projects: [HOME],
      workspaces: [DEFAULT_WS],
      activeWorkspaceId: 'default',
      workspaceData: {},
      deleted: {},
      reminders: REMINDERS_OFF,
      ...partial,
    },
    version: 3,
  };
}

/**
 * Seeds localStorage before the app's first script runs, once per tab (later reloads keep
 * whatever the app saved, so persistence can be tested).
 */
export async function seed(page: Page, value: unknown, extra: Record<string, string> = {}) {
  await page.addInitScript(
    ({ value, extra }) => {
      if (sessionStorage.getItem('__seeded')) return;
      sessionStorage.setItem('__seeded', '1');
      localStorage.clear();
      if (value) localStorage.setItem('ledger-tasks-v2', JSON.stringify(value));
      for (const [k, v] of Object.entries(extra)) localStorage.setItem(k, v);
    },
    { value, extra },
  );
}

/** The app's persisted state, as currently saved in this browser. */
export async function savedState(page: Page): Promise<StoredState> {
  return page.evaluate(() => JSON.parse(localStorage.getItem('ledger-tasks-v2') ?? 'null'));
}

/** On narrow screens the sidebar is an off-canvas menu; open it if needed. */
export async function openSidebar(page: Page) {
  const menu = page.getByRole('button', { name: 'Open menu' });
  if (await menu.isVisible()) await menu.click();
}

export async function openSettings(page: Page) {
  await openSidebar(page);
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
}

/** The task details drawer. */
export const drawer = (page: Page) => page.getByRole('dialog', { name: 'Task details' });

/** Opens a task's drawer through the app's own deep link. */
export async function openTaskLink(page: Page, id: string, ws = 'default') {
  await page.goto(`dashboard?task=${id}&ws=${ws}`);
  await expect(drawer(page)).toBeVisible();
}

/** Fails any test whose page logs an error or throws (network status logs are expected for 401/429 cases). */
export const test = base.extend<{ consoleErrors: string[] }>({
  consoleErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
      page.on('console', (m) => {
        if (m.type() !== 'error') return;
        const text = m.text();
        if (/Failed to load resource|status of (401|429|500)|NetworkError|net::ERR_/i.test(text)) return;
        errors.push(`console: ${text}`);
      });
      await use(errors);
      expect(errors, 'page errors / console errors').toEqual([]);
    },
    { auto: true },
  ],
});
