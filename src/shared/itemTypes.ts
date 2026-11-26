/**
 * The kinds of item and what each one allows (build plan Step 1b). Plain data, shared by the app
 * and the server; the matching field checks (Zod) are in src/shared/itemSchemas.ts, which only
 * the server loads, to keep the app small. The same types and statuses are rows in Postgres
 * (db/migrations/0002), so the database refuses anything this list doesn't allow.
 */
import type { ItemType, Status, Task } from '../types.js';

export interface StatusInfo {
  id: Status;
  label: string;
  /** Finished: no longer counted as open, and no reminders. */
  done?: boolean;
}

/** One of a type's own fields, for the item panel; src/shared/itemSchemas.ts checks the same keys. */
export interface FieldInfo {
  key: string;
  label: string;
  /** level: low/med/high; line: a name or short text; text: paragraphs; date: YYYY-MM-DD. */
  kind: 'level' | 'line' | 'text' | 'date';
}

export interface TypeInfo {
  label: string;
  /** In workflow order; the first is a new item's status. */
  statuses: StatusInfo[];
  /** The status "Mark complete" sets. */
  complete: Status;
  /** The status the board's "In progress" column sets. */
  progress: Status;
  /** Its own fields, shown in the item panel. */
  fields: FieldInfo[];
  /** The panel's complete button, e.g. "Close risk". */
  completeLabel: string;
  /** What the priority field means for this type. */
  priorityLabel: string;
  /** What the date field means for this type. */
  dateLabel: string;
}

export const ITEM_TYPES: Record<ItemType, TypeInfo> = {
  task: {
    label: 'Task',
    statuses: [
      { id: 'todo', label: 'To do' },
      { id: 'doing', label: 'Doing' },
      { id: 'blocked', label: 'Blocked' },
      { id: 'done', label: 'Done', done: true },
    ],
    priorityLabel: 'Priority',
    dateLabel: 'Due',
    complete: 'done',
    progress: 'doing',
    fields: [],
    completeLabel: 'Mark complete',
  },
  risk: {
    label: 'Risk',
    statuses: [
      { id: 'open', label: 'Open' },
      { id: 'mitigating', label: 'Mitigating' },
      { id: 'closed', label: 'Closed', done: true },
    ],
    priorityLabel: 'Severity',
    dateLabel: 'Review by',
    complete: 'closed',
    progress: 'mitigating',
    fields: [
      { key: 'likelihood', label: 'Likelihood', kind: 'level' },
      { key: 'impact', label: 'Impact', kind: 'level' },
      { key: 'mitigation', label: 'Mitigation', kind: 'text' },
    ],
    completeLabel: 'Close risk',
  },
  issue: {
    label: 'Issue',
    statuses: [
      { id: 'open', label: 'Open' },
      { id: 'in_progress', label: 'In progress' },
      { id: 'resolved', label: 'Resolved', done: true },
    ],
    priorityLabel: 'Severity',
    dateLabel: 'Resolve by',
    complete: 'resolved',
    progress: 'in_progress',
    fields: [
      { key: 'impact', label: 'Impact', kind: 'text' },
      { key: 'resolution', label: 'Resolution', kind: 'text' },
    ],
    completeLabel: 'Resolve issue',
  },
  decision: {
    label: 'Decision',
    statuses: [
      { id: 'proposed', label: 'Proposed' },
      { id: 'decided', label: 'Decided', done: true },
      { id: 'superseded', label: 'Superseded', done: true },
    ],
    priorityLabel: 'Priority',
    dateLabel: 'Decide by',
    complete: 'decided',
    progress: 'proposed',
    fields: [
      { key: 'decidedBy', label: 'Decided by', kind: 'line' },
      { key: 'decidedOn', label: 'Decided on', kind: 'date' },
      { key: 'rationale', label: 'Rationale', kind: 'text' },
    ],
    completeLabel: 'Mark decided',
  },
  dependency: {
    label: 'Dependency',
    statuses: [
      { id: 'waiting', label: 'Waiting' },
      { id: 'at_risk', label: 'At risk' },
      { id: 'met', label: 'Met', done: true },
    ],
    priorityLabel: 'Priority',
    dateLabel: 'Needed by',
    complete: 'met',
    progress: 'at_risk',
    fields: [{ key: 'onWhom', label: 'Waiting on', kind: 'line' }],
    completeLabel: 'Mark met',
  },
  change_request: {
    label: 'Change request',
    statuses: [
      { id: 'draft', label: 'Draft' },
      { id: 'submitted', label: 'Submitted' },
      { id: 'approved', label: 'Approved' },
      { id: 'rejected', label: 'Rejected', done: true },
      { id: 'implemented', label: 'Implemented', done: true },
    ],
    priorityLabel: 'Priority',
    dateLabel: 'Needed by',
    complete: 'implemented',
    progress: 'submitted',
    fields: [
      { key: 'requestedBy', label: 'Requested by', kind: 'line' },
      { key: 'approver', label: 'Approver', kind: 'line' },
      { key: 'impact', label: 'Impact', kind: 'text' },
    ],
    completeLabel: 'Mark implemented',
  },
};

export const TYPE_IDS = Object.keys(ITEM_TYPES) as ItemType[];

export function isItemType(value: unknown): value is ItemType {
  return typeof value === 'string' && Object.hasOwn(ITEM_TYPES, value);
}

/** The item's type: a task unless it says otherwise (and says something known). */
export function typeOf(item: Pick<Task, 'type'>): ItemType {
  return isItemType(item.type) ? item.type : 'task';
}

export function statusAllowed(type: ItemType, status: unknown): status is Status {
  return ITEM_TYPES[type].statuses.some((s) => s.id === status);
}

/** Finished items need no attention: not counted as open, and no reminders. */
export function isDone(item: Pick<Task, 'type' | 'status'>): boolean {
  return ITEM_TYPES[typeOf(item)].statuses.some((s) => s.id === item.status && s.done);
}

export function firstStatus(type: ItemType): Status {
  return ITEM_TYPES[type].statuses[0].id;
}

/** The status "Mark complete" sets for this item's type. */
export function completeStatus(item: Pick<Task, 'type'>): Status {
  return ITEM_TYPES[typeOf(item)].complete;
}

/** Where an item stands, whatever its type calls it: the board's columns. */
export type Phase = 'todo' | 'doing' | 'blocked' | 'done';

/** The phase a status means: finished statuses are done; a task's own blocked is blocked; the first status is to do. */
export function phaseOfStatus(item: Pick<Task, 'type' | 'status'>): Phase {
  const type = typeOf(item);
  if (isDone(item)) return 'done';
  if (type === 'task' && item.status === 'blocked') return 'blocked';
  // A decision has no in-between status: "proposed" (its first) is to do, then it is decided.
  return item.status === firstStatus(type) ? 'todo' : 'doing';
}

/** The status that puts an item of this type in a board column (blocked is never chosen: it is derived). */
export function statusForPhase(type: ItemType, phase: Exclude<Phase, 'blocked'>): Status {
  const info = ITEM_TYPES[type];
  return phase === 'todo' ? firstStatus(type) : phase === 'doing' ? info.progress : info.complete;
}

/** "Risks", "Dependencies", "Change requests". */
export function pluralLabel(type: ItemType): string {
  const label = ITEM_TYPES[type].label;
  return label.endsWith('y') ? `${label.slice(0, -1)}ies` : `${label}s`;
}
