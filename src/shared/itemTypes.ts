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

export interface TypeInfo {
  label: string;
  /** In workflow order; the first is a new item's status. */
  statuses: StatusInfo[];
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
