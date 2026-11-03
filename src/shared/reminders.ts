/**
 * Which tasks need attention and which reminders are due. Pure, so the app (in-app pop-ups) and
 * /api/reminders (push) apply exactly the same rules. Dates are compared as calendar days in the
 * user's time zone: the app passes the device's local date, the server converts with
 * settings.timezone.
 */
import type { Task, Workspace } from '../types.js';
import { daysBetween } from './date.js';
import { allWorkspaceData, ownEntry, type SyncedState } from './state.js';

/** The current calendar date and minute of the day, in the user's time zone. */
export interface LocalNow {
  date: string;
  minutes: number;
}

export interface TaskRef {
  task: Task;
  workspace: Workspace;
  projectName: string;
  /** Days until due: negative = overdue, 0 = today. */
  daysLeft: number;
}

export interface Attention {
  overdue: TaskRef[];
  today: TaskRef[];
  /** Due within the task's reminder lead time (1+ days away). */
  upcoming: TaskRef[];
}

export interface Reminder {
  /** Stable id: each reminder is notified once (per device in the app, once overall for push). */
  key: string;
  kind: 'digest' | 'lead';
  title: string;
  body: string;
  /** App-relative link (no leading slash) opened when the reminder is clicked. */
  url: string;
  taskId?: string;
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

/** Open tasks across every workspace that are overdue, due today, or inside their reminder lead time. */
export function attentionTasks(state: SyncedState, todayIso: string): Attention {
  const result: Attention = { overdue: [], today: [], upcoming: [] };
  const data = allWorkspaceData(state);
  for (const workspace of state.workspaces) {
    const { tasks = [], projects = [] } = ownEntry(data, workspace.id) ?? {};
    const projectNames = new Map(projects.map((p) => [p.id, p.name]));
    for (const task of tasks) {
      if (task.status === 'done') continue;
      const daysLeft = daysBetween(todayIso, task.dueDate);
      const ref: TaskRef = { task, workspace, projectName: projectNames.get(task.project) ?? '', daysLeft };
      if (daysLeft < 0) result.overdue.push(ref);
      else if (daysLeft === 0) result.today.push(ref);
      else if (daysLeft <= leadDays(task, state.reminders.defaultLeadDays)) result.upcoming.push(ref);
    }
  }
  const byDue = (a: TaskRef, b: TaskRef) => a.daysLeft - b.daysLeft || a.task.title.localeCompare(b.task.title);
  result.overdue.sort(byDue);
  result.today.sort(byDue);
  result.upcoming.sort(byDue);
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

function listTitles(refs: TaskRef[], max = 3): string {
  const titles = refs.slice(0, max).map((r) => r.task.title);
  return refs.length > max ? `${titles.join(', ')} +${refs.length - max} more` : titles.join(', ');
}

function dueIn(days: number): string {
  return days === 1 ? 'Due tomorrow' : `Due in ${days} days`;
}

/**
 * Reminders due at `now`. Nothing fires before the digest time; from then on the day's digest
 * (due today, plus overdue if enabled) and a lead reminder for each task inside its lead time are
 * due. Keys include the date (digest) or due date (lead), so each fires once per day / occurrence.
 */
export function computeReminders(state: SyncedState, now: LocalNow): Reminder[] {
  const settings = state.reminders;
  if (!settings.enabled || now.minutes < parseTime(settings.digestTime)) return [];

  const { overdue, today, upcoming } = attentionTasks(state, now.date);
  const multiWorkspace = state.workspaces.length > 1;
  const where = (ref: TaskRef) =>
    [ref.projectName, multiWorkspace ? ref.workspace.name : ''].filter(Boolean).join(' · ');
  const reminders: Reminder[] = [];

  const late = settings.includeOverdue ? overdue : [];
  if (today.length || late.length) {
    const counts = [today.length && `${today.length} due today`, late.length && `${late.length} overdue`];
    const lines = [today.length && `Today: ${listTitles(today)}`, late.length && `Overdue: ${listTitles(late)}`];
    reminders.push({
      key: `digest:${now.date}`,
      kind: 'digest',
      title: `Ledger · ${counts.filter(Boolean).join(', ')}`,
      body: lines.filter(Boolean).join('\n'),
      url: 'dashboard',
    });
  }

  for (const ref of upcoming) {
    reminders.push({
      key: `lead:${ref.workspace.id}:${ref.task.id}:${ref.task.dueDate}`,
      kind: 'lead',
      title: `${dueIn(ref.daysLeft)}: ${ref.task.title}`,
      body: where(ref) || 'Ledger',
      url: taskUrl(ref),
      taskId: ref.task.id,
    });
  }
  return reminders;
}
