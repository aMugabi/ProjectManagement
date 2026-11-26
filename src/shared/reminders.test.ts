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

  it('sends the digest and one lead reminder per task from the digest time', () => {
    const r = computeReminders(state(tasks), { date: TODAY, minutes: parseTime('08:00') });
    expect(r.map((x) => x.key)).toEqual([
      'digest:2026-11-03',
      'lead:default:tomorrow:2026-11-04',
      'lead:default:in3-own-lead:2026-11-06',
    ]);
    expect(r[0].title).toBe('Ledger · 1 due today, 1 overdue');
    expect(r[1]).toMatchObject({ title: 'Due tomorrow: tomorrow', body: 'Home', url: 'dashboard?task=tomorrow&ws=default' });
    expect(r[2].title).toBe('Due in 3 days: in3-own-lead');
  });

  it('respects includeOverdue and the enabled switch', () => {
    const noOverdue = state([task('late', '2026-11-01')], {
      reminders: { ...state([]).reminders, includeOverdue: false },
    });
    expect(computeReminders(noOverdue, { date: TODAY, minutes: 600 })).toEqual([]);
    const off = state(tasks, { reminders: { ...state([]).reminders, enabled: false } });
    expect(computeReminders(off, { date: TODAY, minutes: 600 })).toEqual([]);
  });

  it('covers tasks in inactive workspaces too, naming the workspace', () => {
    const s = state([], {
      workspaces: [
        { id: 'default', name: 'Home', updatedAt: 1 },
        { id: 'work', name: 'Work', updatedAt: 1 },
      ],
      workspaceData: { work: { projects: [], tasks: [task('w', '2026-11-04')], products: [], partners: [], pairs: [] } },
    });
    const [r] = computeReminders(s, { date: TODAY, minutes: 600 });
    expect(r).toMatchObject({ key: 'lead:work:w:2026-11-04', body: 'Work', url: 'dashboard?task=w&ws=work' });
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
  const reminders = computeReminders(state(tasks, { reminders: { enabled: true, digestTime: '08:00', defaultLeadDays: 1 } as SyncedState['reminders'] }), {
    date: TODAY,
    minutes: 9 * 60,
  });
  const digest = reminders.find((r) => r.kind === 'digest')!;
  const lead = reminders.find((r) => r.taskId === 'in3-own-lead')!;

  it('shows the full text only when private notifications are explicitly off', () => {
    expect(outsideText(lead, false)).toEqual({ title: lead.title, body: lead.body });
    expect(lead.title).toContain('in3-own-lead');
  });

  it('keeps only counts and timing when private, or when the setting predates this option', () => {
    for (const setting of [true, undefined]) {
      expect(outsideText(digest, setting)).toEqual({ title: digest.title, body: 'Open Ledger to see them.' });
      expect(outsideText(lead, setting)).toEqual({ title: 'Ledger · A task is due in 3 days', body: 'Open Ledger to see it.' });
    }
    expect(digest.title).toBe('Ledger · 1 due today, 1 overdue'); // counts only, no names
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
