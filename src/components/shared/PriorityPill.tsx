import type { Priority, Status } from '../../types';
import s from './shared.module.css';

const LABEL: Record<Priority, string> = { high: 'High', med: 'Med', low: 'Low' };
const COLOR: Record<Priority, string> = {
  high: 'var(--prio-high)',
  med: 'var(--prio-med)',
  low: 'var(--prio-low)',
};
const BG: Record<Priority, string> = {
  high: 'var(--prio-high-bg)',
  med: 'var(--prio-med-bg)',
  low: 'var(--prio-low-bg)',
};

export function PriorityPill({ priority, status }: { priority: Priority; status?: Status }) {
  const done = status === 'done';
  return (
    <span
      className={s.pill}
      style={{
        color: done ? 'var(--text-faint)' : COLOR[priority],
        background: done ? 'transparent' : BG[priority],
      }}
    >
      {LABEL[priority]}
    </span>
  );
}
