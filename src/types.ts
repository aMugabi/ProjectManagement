export type Status = 'todo' | 'doing' | 'blocked' | 'done';
export type Priority = 'high' | 'med' | 'low';
export type Recurring = 'weekly' | 'monthly' | 'yearly' | null;

export interface Subtask {
  text: string;
  done: boolean;
}

export interface Task {
  id: string;
  project: string;
  title: string;
  status: Status;
  priority: Priority;
  /** ISO date string, e.g. '2026-08-20' */
  dueDate: string;
  /** Optional start date for timeline bars with a true span */
  startDate?: string;
  subs: Subtask[];
  recurring: Recurring;
  deps: string[];
  notes: string;
  /** Manual sort position within a board status column. */
  order: number;
  /** Days before the due date to send a reminder. Unset = the settings default; null = never. */
  remindDaysBefore?: number | null;
  /** Last edit time (ms). Sync keeps the newer copy of each task; 0 = unknown/pre-sync data. */
  updatedAt: number;
}

export interface Project {
  id: string;
  name: string;
  color: string;
  updatedAt: number;
}

export interface Workspace {
  id: string;
  name: string;
  updatedAt: number;
}

/** Data for a workspace that isn't currently active — the active workspace's data lives in the top-level tasks/projects fields. */
export interface WorkspaceSnapshot {
  projects: Project[];
  tasks: Task[];
}

export interface ReminderSettings {
  enabled: boolean;
  /** Local time of day ('HH:MM') for the daily digest and lead reminders. */
  digestTime: string;
  /** Lead reminder for tasks without their own remindDaysBefore. 0 = none beyond the digest. */
  defaultLeadDays: number;
  includeOverdue: boolean;
  /** IANA time zone the server uses to decide when it's digestTime. */
  timezone: string;
  updatedAt: number;
}

export type Screen = 'dashboard' | 'tasks' | 'timeline';
export type DashLayout = 'focus' | 'portfolio';
export type TaskView = 'list' | 'board';
