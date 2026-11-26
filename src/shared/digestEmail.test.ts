import { describe, expect, it } from 'vitest';
import type { ReminderSettings, Task } from '../types';
import { digestEmail, isEmail } from './digestEmail';
import { normalizeState } from './state';

const TODAY = '2026-11-03';
const APP = 'https://mugabi-ledger.vercel.app';

function task(id: string, title: string, dueDate: string): Task {
  return { id, project: 'p', title, status: 'todo', priority: 'med', dueDate, subs: [], recurring: null, deps: [], notes: '', order: 0, updatedAt: 1 };
}

const on: Partial<ReminderSettings> = { enabled: true, emailDigest: true, email: 'me@example.com', digestTime: '06:00', defaultLeadDays: 1, includeOverdue: true, privateNotifications: false };

function state(tasks: Task[], reminders: Partial<ReminderSettings> = on) {
  return normalizeState({ tasks, projects: [{ id: 'p', name: 'Home', color: '#000', updatedAt: 1 }], reminders });
}

const tasks = [task('a', 'Pay rent', TODAY), task('b', 'Renew licence', '2026-11-01'), task('c', 'Book flights', '2026-11-04')];

describe('digestEmail', () => {
  it('builds one email with due today, overdue and coming up, linking to each task', () => {
    const email = digestEmail(state(tasks), { date: TODAY, minutes: 6 * 60 }, APP)!;
    expect(email.key).toBe('email-digest:2026-11-03');
    expect(email.to).toBe('me@example.com');
    expect(email.subject).toBe('Ledger · 1 due today, 1 overdue, 1 coming up');
    expect(email.text).toContain('DUE TODAY\n- Pay rent (Home, today)');
    expect(email.text).toContain('- Renew licence (Home, 2d late)');
    expect(email.text).toContain(`${APP}/dashboard?task=c&ws=default`);
    expect(email.html).toContain(`href="${APP}/dashboard?task=a&amp;ws=default"`);
  });

  it('is not sent when off, before the digest time, without a valid address, or with nothing to report', () => {
    const now = { date: TODAY, minutes: 6 * 60 };
    expect(digestEmail(state(tasks, { ...on, emailDigest: false }), now, APP)).toBeNull();
    expect(digestEmail(state(tasks, { ...on, enabled: false }), now, APP)).toBeNull();
    expect(digestEmail(state(tasks, { ...on, email: 'not-an-email' }), now, APP)).toBeNull();
    expect(digestEmail(state(tasks), { date: TODAY, minutes: 5 * 60 + 59 }, APP)).toBeNull();
    expect(digestEmail(state([task('z', 'Far away', '2026-12-25')]), now, APP)).toBeNull();
  });

  it('leaves overdue out when the setting is off', () => {
    const email = digestEmail(state(tasks, { ...on, includeOverdue: false }), { date: TODAY, minutes: 600 }, APP)!;
    expect(email.subject).toBe('Ledger · 1 due today, 1 coming up');
    expect(email.text).not.toContain('Renew licence');
  });

  it('escapes task titles in the HTML', () => {
    const email = digestEmail(state([task('x', '<script>alert(1)</script> & co', TODAY)]), { date: TODAY, minutes: 600 }, APP)!;
    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; co');
  });

  it('leaves every name and per-task link out when private notifications are on (the default)', () => {
    const { privateNotifications: _omitted, ...defaults } = on;
    for (const settings of [{ ...on, privateNotifications: true }, defaults]) {
      const email = digestEmail(state(tasks, settings), { date: TODAY, minutes: 6 * 60 }, APP)!;
      expect(email.subject).toBe('Ledger · 1 due today, 1 overdue, 1 coming up');
      expect(email.text).toContain('Due today: 1\nOverdue: 1\nComing up: 1');
      expect(email.text).toContain(`Open Ledger: ${APP}`);
      for (const body of [email.text, email.html]) {
        for (const name of ['Pay rent', 'Renew licence', 'Book flights', 'Home', 'task=', 'ws=']) expect(body).not.toContain(name);
      }
      expect(email.html).toContain(`href="${APP}"`);
    }
  });

  it('validates addresses', () => {
    expect(isEmail('tech@phaneroo.org')).toBe(true);
    expect(isEmail(' a@b.co ')).toBe(true);
    expect(isEmail('a@b')).toBe(false);
    expect(isEmail('')).toBe(false);
  });

  it('adds the items to chase, with who they wait on, and leaves snoozed items out (Step 2)', () => {
    const chase = { ...task('w', 'Settlement file', '2026-11-20'), waitingOn: 'Telco IT', chaseOn: '2026-11-02' };
    const snoozed = { ...task('s', 'Snoozed bill', TODAY), snoozedUntil: '2026-11-05' };
    const email = digestEmail(state([task('a', 'Pay rent', TODAY), chase, snoozed]), { date: TODAY, minutes: 600 }, APP)!;
    expect(email.subject).toBe('Ledger · 1 due today, 1 to chase');
    expect(email.text).toContain('TO CHASE\n- Settlement file (Telco IT · Home, chase 1d late)');
    expect(email.html).toContain('chase 1d late');
    expect(email.text).not.toContain('Snoozed bill');
    const quiet = digestEmail(state([task('a', 'Pay rent', TODAY), chase], { ...on, privateNotifications: true }), { date: TODAY, minutes: 600 }, APP)!;
    expect(quiet.text).toContain('To chase: 1');
    expect(quiet.text).not.toContain('Telco IT');
  });
});

