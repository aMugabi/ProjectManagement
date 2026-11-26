/**
 * Following things up (build plan Step 2): who an item waits on and when to chase them, and
 * snoozing. Pure, so the app's views and the server's reminders apply the same rules. Dates are
 * ISO calendar days ('YYYY-MM-DD'); anything else (an old device's text) counts as no date.
 */
import type { Task } from '../types.js';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const validDate = (value: string | undefined): value is string => Boolean(value && ISO_DATE.test(value));

/** Snoozed: out of reminders and the dashboard until its date; on that day it is back. */
export function isSnoozed(t: Pick<Task, 'snoozedUntil'>, todayIso: string): boolean {
  return validDate(t.snoozedUntil) && t.snoozedUntil > todayIso;
}

/** Waiting on someone or something. */
export function isWaiting(t: Pick<Task, 'waitingOn'>): boolean {
  return Boolean(t.waitingOn?.trim());
}

/** Waiting, with a chase date of today or earlier. */
export function chaseDue(t: Pick<Task, 'waitingOn' | 'chaseOn'>, todayIso: string): boolean {
  return isWaiting(t) && validDate(t.chaseOn) && t.chaseOn <= todayIso;
}

/** The calendar day `days` after `iso` (no time zone or daylight-saving drift). */
export function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** The quick choices for snoozing, chasing and moving a due date: tomorrow, and next Monday. */
export function quickDates(todayIso: string): { tomorrow: string; nextWeek: string } {
  const [y, m, d] = todayIso.split('-').map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  return { tomorrow: addDaysIso(todayIso, 1), nextWeek: addDaysIso(todayIso, ((8 - weekday) % 7) || 7) };
}
