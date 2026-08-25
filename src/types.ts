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
}

export interface Project {
  id: string;
  name: string;
  color: string;
}

export type Screen = 'dashboard' | 'tasks' | 'timeline';
export type DashLayout = 'focus' | 'portfolio';
export type TaskView = 'list' | 'board';
