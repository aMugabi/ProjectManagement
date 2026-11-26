export type TaskStatus = 'todo' | 'doing' | 'blocked' | 'done';
/** The kinds of item (build plan Step 1b). An item with no type is a task. See src/shared/itemTypes.ts. */
export type ItemType = 'task' | 'risk' | 'issue' | 'decision' | 'dependency' | 'change_request';
/** Any item's status; which ones each type allows is in src/shared/itemTypes.ts. */
export type Status =
  | TaskStatus
  | 'open' | 'mitigating' | 'closed' // risk
  | 'in_progress' | 'resolved' // issue (with open)
  | 'proposed' | 'decided' | 'superseded' // decision
  | 'waiting' | 'at_risk' | 'met' // dependency
  | 'draft' | 'submitted' | 'approved' | 'rejected' | 'implemented'; // change request
export type Priority = 'high' | 'med' | 'low';
export type Recurring = 'weekly' | 'monthly' | 'yearly' | null;

export interface Subtask {
  text: string;
  done: boolean;
}

/**
 * One item: a task, or (with `type`) a risk, issue, decision, dependency or change request. It
 * belongs to a plain `project`, or to a `product` and/or a `partner`, or to none of them.
 */
export interface Task {
  id: string;
  /** A plain project's id ('' when the item belongs to a product or partner, or to nothing). */
  project: string;
  /** Absent: a task. */
  type?: ItemType;
  /** The product and/or partner it belongs to (ids in the same workspace); absent or '' = none. */
  product?: string;
  partner?: string;
  /** The type's own fields (e.g. a risk's likelihood and impact), checked by src/shared/itemSchemas.ts. */
  details?: Record<string, unknown>;
  title: string;
  status: Status;
  priority: Priority;
  /** ISO date string, e.g. '2026-08-20' */
  dueDate: string;
  /** Optional start date for timeline bars with a true span */
  startDate?: string;
  /** Who or what the item waits on (Step 2); absent or '' = nobody. */
  waitingOn?: string;
  /** ISO date to chase whoever it waits on. */
  chaseOn?: string;
  /** ISO date: until that day the item stays out of reminders and the dashboard. */
  snoozedUntil?: string;
  /** ISO date it was finished (Step 4 reports); cleared when it's reopened. */
  completedOn?: string;
  /** A recurring item's finished occurrences (ISO dates, oldest first, the last 100). */
  completions?: string[];
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

/** Products and partners have the same shape as projects: a name and a colour. */
export type Product = Project;
export type Partner = Project;

/** A product and a partner that work together; its id is `${product}+${partner}`. */
export interface ProductPartner {
  id: string;
  product: string;
  partner: string;
  updatedAt: number;
}

export interface Workspace {
  id: string;
  name: string;
  updatedAt: number;
}

/** Data for a workspace that isn't currently active — the active workspace's data lives in the top-level tasks/projects fields. */
/** A stage of the workspace's delivery template (Step 3): SIT, UAT, UVT, InfoSec, Go-live by default. */
export interface Stage {
  id: string;
  name: string;
  /** Position in the template (lowest first). */
  order: number;
  updatedAt: number;
}

/** A release of a product with a partner (their pair must exist). */
export interface Release {
  id: string;
  product: string;
  partner: string;
  name: string;
  /** ISO date the release should go live. */
  targetDate?: string;
  updatedAt: number;
}

export type SignOffOutcome = 'passed' | 'failed' | 'waived';

/**
 * One stage of one release signed off (Step 3). Never edited or deleted: a correction is a new
 * sign-off naming the one it replaces in `corrects`.
 */
export interface SignOff {
  id: string;
  release: string;
  stage: string;
  /** The stage's name when signed, so the record reads the same after a rename. */
  stageName: string;
  outcome: SignOffOutcome;
  approver: string;
  /** The approver's role, e.g. 'Head of QA'. */
  role: string;
  /** The approver's local date and time, 'YYYY-MM-DDTHH:MM'. */
  signedAt: string;
  /** A link to the evidence in the bank's own systems ('' = none). No uploads. */
  evidence: string;
  note: string;
  corrects?: string;
  /** When it was recorded (ms). */
  updatedAt: number;
}

export interface WorkspaceSnapshot {
  projects: Project[];
  tasks: Task[];
  products: Product[];
  partners: Partner[];
  pairs: ProductPartner[];
  stages: Stage[];
  releases: Release[];
  signoffs: SignOff[];
}

export interface ReminderSettings {
  enabled: boolean;
  /** Local time of day ('HH:MM') for the daily digest (which includes the lead reminders). */
  digestTime: string;
  /** Lead reminder for tasks without their own remindDaysBefore. 0 = none beyond the digest. */
  defaultLeadDays: number;
  includeOverdue: boolean;
  /** IANA time zone the server uses to decide when it's digestTime. */
  timezone: string;
  /** Also email the daily digest (cloud builds only) to `email`. */
  emailDigest: boolean;
  email: string;
  /**
   * Emails, push and system notifications (anything seen outside the app, e.g. on a lock screen
   * or by the email service) show counts only, never task, project or workspace names.
   */
  privateNotifications: boolean;
  updatedAt: number;
}

export type Screen = 'dashboard' | 'tasks' | 'timeline';
export type DashLayout = 'focus' | 'portfolio';
export type TaskView = 'list' | 'board';
