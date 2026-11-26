import { describe, expect, it } from 'vitest';
import { addDaysIso, chaseDue, isSnoozed, isWaiting, quickDates } from './followUp';

describe('follow-up rules', () => {
  it('a snoozed item is back on its date', () => {
    expect(isSnoozed({ snoozedUntil: '2026-11-28' }, '2026-11-27')).toBe(true);
    expect(isSnoozed({ snoozedUntil: '2026-11-28' }, '2026-11-28')).toBe(false);
    expect(isSnoozed({}, '2026-11-27')).toBe(false);
    expect(isSnoozed({ snoozedUntil: 'Friday' }, '2026-11-27')).toBe(false); // not a date: not snoozed
  });

  it('waiting needs a name, and a chase is due on or after its date', () => {
    expect(isWaiting({ waitingOn: '  ' })).toBe(false);
    expect(isWaiting({ waitingOn: 'Telco IT' })).toBe(true);
    expect(chaseDue({ waitingOn: 'Telco IT', chaseOn: '2026-11-27' }, '2026-11-27')).toBe(true);
    expect(chaseDue({ waitingOn: 'Telco IT', chaseOn: '2026-11-20' }, '2026-11-27')).toBe(true);
    expect(chaseDue({ waitingOn: 'Telco IT', chaseOn: '2026-11-28' }, '2026-11-27')).toBe(false);
    expect(chaseDue({ waitingOn: '', chaseOn: '2026-11-20' }, '2026-11-27')).toBe(false);
    expect(chaseDue({ waitingOn: 'Telco IT', chaseOn: 'soon' }, '2026-11-27')).toBe(false);
  });

  it('counts calendar days across months, years and daylight saving', () => {
    expect(addDaysIso('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDaysIso('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDaysIso('2026-03-28', 2)).toBe('2026-03-30'); // across Europe's clock change
    expect(addDaysIso('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('next week means the coming Monday, a full week on from a Monday', () => {
    expect(quickDates('2026-11-27')).toEqual({ tomorrow: '2026-11-28', nextWeek: '2026-11-30' }); // Friday
    expect(quickDates('2026-11-29')).toEqual({ tomorrow: '2026-11-30', nextWeek: '2026-11-30' }); // Sunday
    expect(quickDates('2026-11-30').nextWeek).toBe('2026-12-07'); // Monday
  });
});
