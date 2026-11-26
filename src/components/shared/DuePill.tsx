import { dueMeta } from '../../shared/date';
import s from './shared.module.css';

/** `done`: the item is finished (by its type's own statuses). */
export function DuePill({ dueDate, done }: { dueDate: string; done: boolean }) {
  const { label, overdue, dueToday } = dueMeta(dueDate, done);
  const color =
    done
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
