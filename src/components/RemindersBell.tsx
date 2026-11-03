import { useState } from 'react';
import { useTaskStore } from '../store/taskStore';
import { useUiStore } from '../store/uiStore';
import { attentionTasks, type TaskRef } from '../shared/reminders';
import { dateToIso, today } from '../shared/date';
import { notificationPermission, requestNotificationPermission } from '../lib/notifications';
import { openTask } from '../lib/openTask';
import s from './RemindersBell.module.css';

function dueLabel(days: number): string {
  if (days < 0) return `${-days}d late`;
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  return `in ${days}d`;
}

/** Header bell: everything overdue, due today, or inside its reminder lead time, across all workspaces. */
export function RemindersBell() {
  const state = useTaskStore();
  const openSettings = useUiStore((st) => st.openSettings);
  const [open, setOpen] = useState(false);
  const [permission, setPermission] = useState(notificationPermission);

  const { overdue, today: dueToday, upcoming } = attentionTasks(state, dateToIso(today()));
  const count = overdue.length + dueToday.length + upcoming.length;
  const showWorkspace = state.workspaces.length > 1;

  const sections: [string, TaskRef[]][] = [
    ['Overdue', overdue],
    ['Due today', dueToday],
    ['Coming up', upcoming],
  ];

  return (
    <div className={s.wrap}>
      <button
        type="button"
        className={`${s.bell} ${open ? s.bellOpen : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-label={`Reminders (${count})`}
        aria-expanded={open}
      >
        <span aria-hidden="true">🔔</span>
        {count > 0 && <span className={`${s.badge} ${overdue.length ? s.badgeLate : ''}`}>{count}</span>}
      </button>

      {open && (
        <>
          <div className={s.scrim} onClick={() => setOpen(false)} aria-hidden="true" />
          <div className={s.panel} role="dialog" aria-label="Reminders">
            <div className={s.panelHeader}>
              <span className={s.panelTitle}>Reminders</span>
              <button
                type="button"
                className={s.link}
                onClick={() => {
                  setOpen(false);
                  openSettings();
                }}
              >
                Settings
              </button>
            </div>

            {permission === 'default' && (
              <div className={s.hint}>
                Get notified even when Ledger is in the background.
                <button
                  type="button"
                  className={s.hintBtn}
                  onClick={async () => setPermission(await requestNotificationPermission())}
                >
                  Turn on notifications
                </button>
              </div>
            )}

            {count === 0 && <div className={s.empty}>Nothing due soon. 🎉</div>}

            {sections.map(
              ([label, refs]) =>
                refs.length > 0 && (
                  <div key={label} className={s.section}>
                    <div className={s.sectionLabel}>{label}</div>
                    {refs.map((ref) => (
                      <button
                        key={`${ref.workspace.id}:${ref.task.id}`}
                        type="button"
                        className={s.row}
                        onClick={() => {
                          setOpen(false);
                          openTask(ref.task.id, ref.workspace.id);
                        }}
                      >
                        <span className={s.rowTitle}>{ref.task.title}</span>
                        <span className={s.rowMeta}>
                          {[ref.projectName, showWorkspace ? ref.workspace.name : ''].filter(Boolean).join(' · ')}
                        </span>
                        <span className={`${s.rowDue} ${ref.daysLeft < 0 ? s.late : ''}`}>{dueLabel(ref.daysLeft)}</span>
                      </button>
                    ))}
                  </div>
                ),
            )}
          </div>
        </>
      )}
    </div>
  );
}
