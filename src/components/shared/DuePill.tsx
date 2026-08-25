import type { Status } from '../../types';
import { dueMeta } from '../../lib/date';
import s from './shared.module.css';

export function DuePill({ dueDate, status }: { dueDate: string; status: Status }) {
  const { label, overdue, dueToday } = dueMeta(dueDate, status);
  const color =
    status === 'done'
      ? 'var(--text-faint)'
      : overdue
        ? 'var(--overdue-text)'
        : dueToday
          ? 'var(--today-text)'
          : 'var(--text-muted)';
  const background = overdue ? 'var(--blocked-bg)' : dueToday ? 'var(--today-pill-bg)' : 'transparent';
  return (
    <span className={s.duePill} style={{ color, background }}>
      {label}
    </span>
  );
}
