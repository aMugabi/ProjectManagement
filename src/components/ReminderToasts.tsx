import type { Reminder } from '../shared/reminders';
import s from './ReminderToasts.module.css';

interface Props {
  toasts: Reminder[];
  onOpen: (r: Reminder) => void;
  onSnooze: (key: string) => void;
  onDismiss: (key: string) => void;
}

/** In-app reminder pop-ups, newest on top; at most three shown, the rest live in the header bell. */
export function ReminderToasts({ toasts, onOpen, onSnooze, onDismiss }: Props) {
  if (!toasts.length) return null;
  const shown = toasts.slice(0, 3);
  return (
    <div className={s.stack} role="region" aria-label="Reminders" aria-live="polite">
      {shown.map((r) => (
        <div key={r.key} className={`${s.toast} ${r.kind === 'digest' ? s.digest : ''}`}>
          <div className={s.kicker}>{r.kind === 'digest' ? 'Today' : 'Reminder'}</div>
          <div className={s.title}>{r.title}</div>
          {r.body && <div className={s.body}>{r.body}</div>}
          <div className={s.actions}>
            <button type="button" className={s.primary} onClick={() => onOpen(r)}>
              {r.kind === 'digest' ? 'View' : 'Open task'}
            </button>
            <button type="button" className={s.secondary} onClick={() => onSnooze(r.key)}>
              Snooze 1h
            </button>
            <button type="button" className={s.secondary} onClick={() => onDismiss(r.key)}>
              Dismiss
            </button>
          </div>
        </div>
      ))}
      {toasts.length > shown.length && <div className={s.more}>+{toasts.length - shown.length} more in 🔔</div>}
    </div>
  );
}
