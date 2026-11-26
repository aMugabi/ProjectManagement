import { describe, expect, it } from 'vitest';
import type { Task } from '../types';
import { attentionTasks, computeReminders, nowInZone, outsideText, parseTime } from './reminders';
import { normalizeState, type SyncedState } from './state';

function task(id: string, dueDate: string, extra: Partial<Task> = {}): Task {
  return {
    id,
    project: 'p',
    title: id,
    status: 'todo',
    priority: 'med',
    dueDate,
    subs: [],
    recurring: null,
    deps: [],
    notes: '',
    order: 0,
    updatedAt: 1,
    ...extra,
  };
}

const TODAY = '2026-11-03';

function state(tasks: Task[], extra: Partial<SyncedState> = {}): SyncedState {
  return normalizeState({ tasks, projects: [{ id: 'p', name: 'Home', color: '#000', updatedAt: 1 }], ...extra });
}

const tasks = [
  task('late', '2026-11-01'),
  task('today', TODAY),
  task('tomorrow', '2026-11-04'),
  task('in3', '2026-11-06'),
  task('in3-own-lead', '2026-11-06', { remindDaysBefore: 3 }),
  task('never', '2026-11-04', { remindDaysBefore: null }),
  task('done', TODAY, { status: 'done' }),
];

describe('attentionTasks', () => {
  it('splits open tasks into overdue, today and upcoming within each lead time', () => {
    const a = attentionTasks(state(tasks), TODAY);
    expect(a.overdue.map((r) => r.task.id)).toEqual(['late']);
    expect(a.today.map((r) => r.task.id)).toEqual(['today']);
    expect(a.upcoming.map((r) => r.task.id)).toEqual(['tomorrow', 'in3-own-lead']);
    expect(a.overdue[0].daysLeft).toBe(-2);
  });
});

describe('computeReminders', () => {
  it('sends nothing before the digest time', () => {
    expect(computeReminders(state(tasks), { date: TODAY, minutes: parseTime('07:59') })).toEqual([]);
  });

  it('sends one digest from the digest time, with what is coming up folded in', () => {
    const r = computeReminders(state(tasks), { date: TODAY, minutes: parseTime('08:00') });
    expect(r).toEqual([
      {
        key: 'digest:2026-11-03',
        title: 'Ledger · 1 due today, 1 overdue, 2 coming up',
        body: 'Today: today\nOverdue: late\nComing up: tomorrow (tomorrow), in3-own-lead (in 3d)',
        url: 'dashboard',
      },
    ]);
  });

  it('sends the digest for coming-up items alone', () => {
    const [r] = computeReminders(state([task('soon', '2026-11-04')]), { date: TODAY, minutes: 600 });
    expect(r).toMatchObject({ title: 'Ledger · 1 coming up', body: 'Coming up: soon (tomorrow)' });
  });

  it('respects includeOverdue and the enabled switch', () => {
    const noOverdue = state([task('late', '2026-11-01')], {
      reminders: { ...state([]).reminders, includeOverdue: false },
    });
    expect(computeReminders(noOverdue, { date: TODAY, minutes: 600 })).toEqual([]);
    const off = state(tasks, { reminders: { ...state([]).reminders, enabled: false } });
    expect(computeReminders(off, { date: TODAY, minutes: 600 })).toEqual([]);
  });

  it('covers tasks in inactive workspaces too', () => {
    const s = state([], {
      workspaces: [
        { id: 'default', name: 'Home', updatedAt: 1 },
        { id: 'work', name: 'Work', updatedAt: 1 },
      ],
      workspaceData: { work: { projects: [], tasks: [task('w', '2026-11-04')], products: [], partners: [], pairs: [] } },
    });
    const [r] = computeReminders(s, { date: TODAY, minutes: 600 });
    expect(r).toMatchObject({ key: 'digest:2026-11-03', body: 'Coming up: w (tomorrow)' });
    expect(attentionTasks(s, TODAY).upcoming[0].workspace.name).toBe('Work');
  });
});

describe('time helpers', () => {
  it('parses HH:MM and falls back to 08:00', () => {
    expect(parseTime('18:45')).toBe(1125);
    expect(parseTime('25:00')).toBe(480);
  });

  it('converts an instant to the local date and minute in a zone', () => {
    const at = new Date('2026-11-03T22:30:00Z');
    expect(nowInZone('Africa/Kampala', at)).toEqual({ date: '2026-11-04', minutes: 90 });
    expect(nowInZone('UTC', at)).toEqual({ date: '2026-11-03', minutes: 1350 });
    expect(nowInZone('Not/AZone', at)).toEqual({ date: '2026-11-03', minutes: 1350 });
  });
});

describe('outsideText', () => {
  const [digest] = computeReminders(state(tasks, { reminders: { enabled: true, digestTime: '08:00', defaultLeadDays: 1 } as SyncedState['reminders'] }), {
    date: TODAY,
    minutes: 9 * 60,
  });

  it('shows the full text only when private notifications are explicitly off', () => {
    expect(outsideText(digest, false)).toEqual({ title: digest.title, body: digest.body });
    expect(digest.body).toContain('in3-own-lead');
  });

  it('keeps only the counts when private, or when the setting predates this option', () => {
    for (const setting of [true, undefined]) {
      expect(outsideText(digest, setting)).toEqual({ title: digest.title, body: 'Open Ledger to see them.' });
    }
    expect(digest.title).toBe('Ledger · 1 due today, 1 overdue, 2 coming up'); // counts only, no names
  });
});

describe('waiting on, chasing and snoozing (Step 2)', () => {
  it('lists items to chase from their chase date, with who they wait on, and counts them', () => {
    const s = state([
      task('chase-today', '2026-11-20', { waitingOn: 'Telco IT', chaseOn: TODAY }),
      task('chase-late', '2026-11-20', { waitingOn: 'Bank ops', chaseOn: '2026-11-01' }),
      task('chase-later', '2026-11-20', { waitingOn: 'Bank ops', chaseOn: '2026-11-04' }),
      task('no-one', '2026-11-20', { chaseOn: TODAY }),
    ]);
    const a = attentionTasks(s, TODAY);
    expect(a.chase.map((r) => [r.task.id, r.daysLeft])).toEqual([['chase-late', -2], ['chase-today', 0]]);
    const [r] = computeReminders(s, { date: TODAY, minutes: 600 });
    expect(r.title).toBe('Ledger · 2 to chase');
    expect(r.body).toBe('To chase: chase-late (Bank ops), chase-today (Telco IT)');
  });

  it('leaves snoozed items out of everything until their date', () => {
    const snoozed = [
      task('late', '2026-11-01', { snoozedUntil: '2026-11-04' }),
      task('chase', '2026-11-20', { waitingOn: 'Telco IT', chaseOn: TODAY, snoozedUntil: '2026-11-04' }),
    ];
    expect(computeReminders(state(snoozed), { date: TODAY, minutes: 600 })).toEqual([]);
    const tomorrow = attentionTasks(state(snoozed), '2026-11-04');
    expect([tomorrow.overdue.map((r) => r.task.id), tomorrow.chase.map((r) => r.task.id)]).toEqual([['late'], ['chase']]);
  });
});

describe('reminders for every item type (Step 1b)', () => {
  const bank = (tasks: Task[]) =>
    state([], {
      workspaces: [{ id: 'default', name: 'My Workspace', updatedAt: 1 }],
      tasks,
      products: [{ id: 'loans', name: 'Loans', color: '#000000', updatedAt: 1 }],
      partners: [{ id: 'telco', name: 'Telco', color: '#000000', updatedAt: 1 }],
      pairs: [{ id: 'loans+telco', product: 'loans', partner: 'telco', updatedAt: 1 }],
    });

  it("leaves out finished items of every type, by each type's own finished statuses", () => {
    const a = attentionTasks(
      bank([
        task('closed-risk', TODAY, { type: 'risk', status: 'closed', project: '' }),
        task('open-risk', TODAY, { type: 'risk', status: 'open', project: '' }),
        task('decided', TODAY, { type: 'decision', status: 'decided', project: '' }),
        task('approved-cr', TODAY, { type: 'change_request', status: 'approved', project: '' }), // still to implement
      ]),
      TODAY,
    );
    expect(a.today.map((r) => r.task.id)).toEqual(['approved-cr', 'open-risk']);
  });

  it('names an item by its product and partner when it has no project', () => {
    const a = attentionTasks(
      bank([
        task('both', TODAY, { project: '', product: 'loans', partner: 'telco' }),
        task('product', TODAY, { project: '', product: 'loans' }),
        task('partner', TODAY, { project: '', partner: 'telco' }),
        task('plain', TODAY, { project: 'p' }),
      ]),
      TODAY,
    );
    expect(Object.fromEntries(a.today.map((r) => [r.task.id, r.projectName]))).toEqual({ both: 'Loans · Telco', product: 'Loans', partner: 'Telco', plain: 'Home' });
  });
});
