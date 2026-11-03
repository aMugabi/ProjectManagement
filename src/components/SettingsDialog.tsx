import { useEffect, useState } from 'react';
import { useTaskStore } from '../store/taskStore';
import { useUiStore } from '../store/uiStore';
import { CLOUD_ENABLED } from '../lib/cloud';
import { signOut } from '../lib/auth';
import { notificationPermission, requestNotificationPermission, type PermissionState } from '../lib/notifications';
import s from './SettingsDialog.module.css';

const LEAD_OPTIONS = [
  { value: 0, label: 'Only on the day (daily digest)' },
  { value: 1, label: '1 day before' },
  { value: 2, label: '2 days before' },
  { value: 3, label: '3 days before' },
  { value: 7, label: '1 week before' },
];

const PERMISSION_TEXT: Record<PermissionState, string> = {
  granted: 'On for this device',
  denied: 'Blocked — allow notifications for this site in your browser settings',
  default: 'Off for this device',
  unsupported: 'Not supported in this browser',
};

export function SettingsDialog() {
  const open = useUiStore((st) => st.settingsOpen);
  const close = useUiStore((st) => st.closeSettings);
  // Mounting the panel fresh on each open re-reads things like notification permission.
  return open ? <SettingsPanel close={close} /> : null;
}

function SettingsPanel({ close }: { close: () => void }) {
  const reminders = useTaskStore((st) => st.reminders);
  const updateReminders = useTaskStore((st) => st.updateReminders);
  const [permission, setPermission] = useState<PermissionState>(notificationPermission);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  return (
    <div className={s.scrim} onClick={close}>
      <div className={s.dialog} role="dialog" aria-label="Settings" onClick={(e) => e.stopPropagation()}>
        <div className={s.header}>
          <span className={s.title}>Settings</span>
          <button type="button" className={s.close} onClick={close} aria-label="Close settings">
            ×
          </button>
        </div>

        <section className={s.section}>
          <div className={s.sectionLabel}>Reminders</div>
          <label className={s.row}>
            <span>Remind me about upcoming and overdue tasks</span>
            <input
              type="checkbox"
              checked={reminders.enabled}
              onChange={(e) => updateReminders({ enabled: e.target.checked })}
            />
          </label>
          <label className={s.row}>
            <span>
              Daily digest at
              <small>Tasks due today{reminders.includeOverdue ? ' and overdue' : ''}; lead reminders arrive then too</small>
            </span>
            <input
              type="time"
              className={s.input}
              value={reminders.digestTime}
              disabled={!reminders.enabled}
              onChange={(e) => e.target.value && updateReminders({ digestTime: e.target.value })}
            />
          </label>
          <label className={s.row}>
            <span>
              Default reminder
              <small>Each task can override this in its details</small>
            </span>
            <select
              className={s.input}
              value={reminders.defaultLeadDays}
              disabled={!reminders.enabled}
              onChange={(e) => updateReminders({ defaultLeadDays: Number(e.target.value) })}
            >
              {LEAD_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className={s.row}>
            <span>Include overdue tasks in the digest</span>
            <input
              type="checkbox"
              checked={reminders.includeOverdue}
              disabled={!reminders.enabled}
              onChange={(e) => updateReminders({ includeOverdue: e.target.checked })}
            />
          </label>
        </section>

        <section className={s.section}>
          <div className={s.sectionLabel}>Notifications</div>
          <div className={s.row}>
            <span>
              System notifications
              <small>{PERMISSION_TEXT[permission]}</small>
            </span>
            {permission === 'default' && (
              <button
                type="button"
                className={s.button}
                onClick={async () => setPermission(await requestNotificationPermission())}
              >
                Turn on
              </button>
            )}
          </div>
          {!CLOUD_ENABLED && (
            <p className={s.note}>
              This is the local-only version, so reminders appear while Ledger is open (or in a background tab). Use the
              cloud version to get push notifications when it's closed.
            </p>
          )}
        </section>

        {CLOUD_ENABLED && (
          <section className={s.section}>
            <div className={s.sectionLabel}>Account</div>
            <div className={s.row}>
              <span>
                Sign out
                <small>Tasks stay saved in the cloud; this browser keeps its copy</small>
              </span>
              <span className={s.buttons}>
                <button type="button" className={s.button} onClick={() => void signOut()}>
                  This device
                </button>
                <button type="button" className={s.buttonSecondary} onClick={() => void signOut(true)}>
                  All devices
                </button>
              </span>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
