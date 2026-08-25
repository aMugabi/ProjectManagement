/** Real-date helpers. All task dates are ISO strings ('YYYY-MM-DD'), compared at day granularity. */
import type { Recurring, Status } from '../types';

const DAY = 86400000;

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function today(): Date {
  return startOfDay(new Date());
}

export function isoToDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function dateToIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * DAY);
}

/** Next due date for a recurring task, advanced from its current due date (not from today). */
export function advanceRecurrence(iso: string, recurring: NonNullable<Recurring>): string {
  const d = isoToDate(iso);
  if (recurring === 'weekly') return dateToIso(addDays(d, 7));
  if (recurring === 'monthly') return dateToIso(new Date(d.getFullYear(), d.getMonth() + 1, d.getDate()));
  return dateToIso(new Date(d.getFullYear() + 1, d.getMonth(), d.getDate()));
}

/** Days from today to the given ISO date. Negative = past. */
export function offsetFromToday(iso: string): number {
  return Math.round((isoToDate(iso).getTime() - today().getTime()) / DAY);
}

export function formatLongDate(d: Date): string {
  return d.toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long' });
}

export function formatShortDate(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toLowerCase();
}

export function formatLongDateShortWeekday(d: Date): string {
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

export interface DueMeta {
  label: string;
  overdue: boolean;
  dueToday: boolean;
}

export function dueMeta(dueDate: string, status: Status): DueMeta {
  const d = offsetFromToday(dueDate);
  const overdue = d < 0 && status !== 'done';
  const dueToday = d === 0 && status !== 'done';
  let label: string;
  if (status === 'done') label = 'done';
  else if (d === 0) label = 'today';
  else if (d === 1) label = 'tomorrow';
  else if (d < 0) label = `${Math.abs(d)}d late`;
  else if (d < 7) label = `in ${d}d`;
  else label = formatShortDate(isoToDate(dueDate));
  return { label, overdue, dueToday };
}
