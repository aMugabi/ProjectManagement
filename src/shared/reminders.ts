/**
 * Which tasks need attention and which reminders are due. Pure, so the app (in-app pop-ups) and
 * /api/reminders (push) apply exactly the same rules. Dates are compared as calendar days in the
 * user's time zone: the app passes the device's local date, the server converts with
 * settings.timezone. Since Step 2 there is one reminder a day, the morning digest: due today,
 * overdue, coming up (each item's lead time) and to chase; snoozed items stay out until their date.
 */
import type { Task, Workspace } from '../types.js';
import { daysBetween } from './date.js';
import { isDone } from './itemTypes.js';
import { chaseDue, isSnoozed } from './followUp.js';
import { allWorkspaceData, ownEntry, type SyncedState } from './state.js';

/** The current calendar date and minute of the day, in the user's time zone. */
export interface LocalNow {
  date: string;
  minutes: number;
}

export interface TaskRef {
  task: Task;
  workspace: Workspace;
  /** Where it belongs, for showing: its project's name, or its product's and/or partner's ("Loans · Telco"). */
  projectName: string;
  /** Days until due (in `chase`: until the chase date): negative = late, 0 = today. */
  daysLeft: number;
}

export interface Attention {
  overdue: TaskRef[];
  today: TaskRef[];
  /** Due within the task's reminder lead time (1+ days away). */
  upcoming: TaskRef[];
  /** Waiting on someone, with the chase date today or past (may also be in the lists above). */
  chase: TaskRef[];
}

/** The day's digest: the one reminder a day (lead reminders were folded into it in Step 2). */
export interface Reminder {
  /** Stable id ('digest:<date>'): notified once (per device in the app, once overall for push). */
  key: string;
  title: string;
  body: string;
  /** App-relative link (no leading slash) opened when the reminder is clicked. */
  url: string;
}

/** 'HH:MM' → minutes after midnight; invalid input falls back to 08:00. */
export function parseTime(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return 8 * 60;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** The local date and minute in an IANA time zone (falls back to UTC for unknown zones). */
export function nowInZone(timezone: string, at: Date = new Date()): LocalNow {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(at);
  } catch {
    return nowInZone('UTC', at);
  }
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

/** A task's lead time in days: its own setting, else the default. 0 = no lead reminder. */
export function leadDays(task: Task, defaultLeadDays: number): number {
  if (task.remindDaysBefore === null) return 0;
  return Math.max(0, task.remindDaysBefore ?? defaultLeadDays);
}

/**
 * Open items across every workspace that are overdue, due today, inside their reminder lead time,
 * or due a chase. Snoozed items are left out until their date.
 */
export function attentionTasks(state: SyncedState, todayIso: string): Attention {
  const result: Attention = { overdue: [], today: [], upcoming: [], chase: [] };
  const data = allWorkspaceData(state);
  for (const workspace of state.workspaces) {
    const { tasks = [], projects = [], products = [], partners = [] } = ownEntry(data, workspace.id) ?? {};
    const names = (list: { id: string; name: string }[]) => new Map(list.map((p) => [p.id, p.name]));
    const projectNames = names(projects);
    const productNames = names(products);
    const partnerNames = names(partners);
    const home = (task: Task) =>
      projectNames.get(task.project) ??
      [task.product && productNames.get(task.product), task.partner && partnerNames.get(task.partner)].filter(Boolean).join(' · ');
    for (const task of tasks) {
      // Finished items (a closed risk, a decided decision) need no reminder, whatever their status is called.
      if (isDone(task) || isSnoozed(task, todayIso)) continue;
      if (chaseDue(task, todayIso)) result.chase.push({ task, workspace, projectName: home(task), daysLeft: daysBetween(todayIso, task.chaseOn!) });
      const daysLeft = daysBetween(todayIso, task.dueDate);
      const ref: TaskRef = { task, workspace, projectName: home(task), daysLeft };
      if (daysLeft < 0) result.overdue.push(ref);
      else if (daysLeft === 0) result.today.push(ref);
      else if (daysLeft <= leadDays(task, state.reminders.defaultLeadDays)) result.upcoming.push(ref);
    }
  }
  const byDue = (a: TaskRef, b: TaskRef) => a.daysLeft - b.daysLeft || a.task.title.localeCompare(b.task.title);
  result.overdue.sort(byDue);
  result.today.sort(byDue);
  result.upcoming.sort(byDue);
  result.chase.sort(byDue);
  return result;
}

/** Short due label: '3d late', 'today', 'tomorrow', 'in 4d'. */
export function dueLabel(daysLeft: number): string {
  if (daysLeft < 0) return `${-daysLeft}d late`;
  if (daysLeft === 0) return 'today';
  if (daysLeft === 1) return 'tomorrow';
  return `in ${daysLeft}d`;
}

export function taskUrl(ref: TaskRef): string {
  return `dashboard?task=${encodeURIComponent(ref.task.id)}&ws=${encodeURIComponent(ref.workspace.id)}`;
}

function listTitles(refs: TaskRef[], note: (r: TaskRef) => string = () => '', max = 3): string {
  const titles = refs.slice(0, max).map((r) => (note(r) ? `${r.task.title} (${note(r)})` : r.task.title));
  return refs.length > max ? `${titles.join(', ')} +${refs.length - max} more` : titles.join(', ');
}

/** The digest's counts, as in its title and the email's subject: '1 due today, 2 to chase'. */
export function digestCounts(a: Pick<Attention, 'today' | 'overdue' | 'upcoming' | 'chase'>): string[] {
  return [
    a.today.length && `${a.today.length} due today`,
    a.overdue.length && `${a.overdue.length} overdue`,
    a.upcoming.length && `${a.upcoming.length} coming up`,
    a.chase.length && `${a.chase.length} to chase`,
  ].filter((c): c is string => Boolean(c));
}

/**
 * Reminders due at `now`: nothing before the digest time; from then on the day's one digest, if
 * anything is due today, overdue (when included), coming up within its lead time, or to chase.
 * Its key holds the date, so it fires once a day.
 */
export function computeReminders(state: SyncedState, now: LocalNow): Reminder[] {
  const settings = state.reminders;
  if (!settings.enabled || now.minutes < parseTime(settings.digestTime)) return [];

  const { overdue, today, upcoming, chase } = attentionTasks(state, now.date);
  const shown = { today, overdue: settings.includeOverdue ? overdue : [], upcoming, chase };
  const counts = digestCounts(shown);
  if (!counts.length) return [];
  const lines = [
    today.length && `Today: ${listTitles(today)}`,
    shown.overdue.length && `Overdue: ${listTitles(shown.overdue)}`,
    upcoming.length && `Coming up: ${listTitles(upcoming, (r) => dueLabel(r.daysLeft))}`,
    chase.length && `To chase: ${listTitles(chase, (r) => r.task.waitingOn?.trim() ?? '')}`,
  ];
  return [{ key: `digest:${now.date}`, title: `Ledger · ${counts.join(', ')}`, body: lines.filter(Boolean).join('\n'), url: 'dashboard' }];
}

/**
 * The words a reminder shows outside the app: push and system notifications, which can appear on
 * a lock screen. With private notifications on, only the counts, never a task, project, person or
 * workspace name. (In-app pop-ups show the full text: the app is already unlocked.)
 */
export function outsideText(r: Reminder, privateNotifications: boolean | undefined): { title: string; body: string } {
  // Only an explicit "off" shows names; data saved before the setting existed stays private.
  if (privateNotifications === false) return { title: r.title, body: r.body };
  // The title is counts only ("Ledger · 2 due today, 1 overdue").
  return { title: r.title, body: 'Open Ledger to see them.' };
}
