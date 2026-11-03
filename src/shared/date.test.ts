import { describe, expect, it } from 'vitest';
import { addDays, advanceRecurrence, dateToIso, dueMeta, today } from './date';

const inDays = (n: number) => dateToIso(addDays(today(), n));

describe('advanceRecurrence', () => {
  it('advances weekly, monthly and yearly from the due date', () => {
    expect(advanceRecurrence('2026-11-03', 'weekly')).toBe('2026-11-10');
    expect(advanceRecurrence('2026-11-03', 'monthly')).toBe('2026-12-03');
    expect(advanceRecurrence('2026-11-03', 'yearly')).toBe('2027-11-03');
  });
});

describe('dueMeta', () => {
  it('labels today, tomorrow and late tasks', () => {
    expect(dueMeta(inDays(0), 'todo')).toMatchObject({ label: 'today', dueToday: true });
    expect(dueMeta(inDays(1), 'todo').label).toBe('tomorrow');
    expect(dueMeta(inDays(-2), 'todo')).toMatchObject({ label: '2d late', overdue: true });
    expect(dueMeta(inDays(-2), 'done').overdue).toBe(false);
  });
});
