import { useEffect, useState } from 'react';
import { useTaskStore } from '../store/taskStore';
import { useUiStore } from '../store/uiStore';
import { CLOUD_ENABLED } from '../lib/cloud';
import { signOut } from '../lib/auth';
import { notificationPermission, requestNotificationPermission, type PermissionState } from '../lib/notifications';
import { disablePush, enablePush, pushStatus, sendTestPush, type PushStatus } from '../lib/push';
import { sendTestEmail } from '../lib/email';
import { isEmail } from '../shared/digestEmail';
import type { ReminderSettings } from '../types';
import s from './SettingsDialog.module.css';

const LEAD_OPTIONS = [
  { value: 0, label: 'Only on the day (daily digest)' },
  { value: 1, label: '1 day before' },
  { value: 2, label: '2 days before' },
  { value: 3, label: '3 days before' },
  { value: 7, label: '1 week before' },
];

const PERMISSION_TEXT: Record<PermissionState, string> = {
  granted: "On for this device — to turn them off, change this site's notification setting in your browser or phone settings",
  denied: 'Blocked — allow notifications for this site in your browser settings',
  default: 'Off for this device',
  unsupported: 'Not supported in this browser',
};

const PUSH_TEXT: Record<PushStatus | 'loading', string> = {
  loading: 'Checking…',
  on: 'On for this device — reminders arrive even when Ledger is closed',
  off: 'Get reminders even when Ledger is closed',
  'needs-install':
    'On iPhone and iPad, add Ledger to your Home Screen (Share → Add to Home Screen) and open it from there to turn on push',
  unsupported: "This browser can't receive push notifications here",
  blocked: 'Notifications are blocked for this site — allow them in your browser settings',
  'not-configured': "Push isn't set up on the server yet (VAPID keys — see the README)",
};

function PushSettings() {
  const [status, setStatus] = useState<PushStatus | 'loading'>('loading');
  const [busy, setBusy] = useState(false);
  // Outcome of the last action (test sent, or why turning on failed); replaces the status line.
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void pushStatus().then((st) => live && setStatus(st));
    return () => {
      live = false;
    };
  }, []);

  async function run(action: () => Promise<PushStatus>) {
    setBusy(true);
    setMessage(null);
    try {
      setStatus(await action());
    } catch (e) {
      // Say why, rather than silently showing "Turn on" again.
      setStatus('off');
      setMessage(`Couldn't turn on push: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    const ok = await sendTestPush().catch(() => false);
    setMessage(ok ? 'Sent — it should appear in a moment' : "Couldn't send a test notification");
    setBusy(false);
  }

  return (
    <div className={s.row}>
      <span>
        Push notifications
        <small>{message ?? PUSH_TEXT[status]}</small>
      </span>
      <span className={s.buttons}>
        {status === 'off' && (
          <button type="button" className={s.button} disabled={busy} onClick={() => void run(enablePush)}>
            Turn on
          </button>
        )}
        {status === 'on' && (
          <>
            <button type="button" className={s.buttonSecondary} disabled={busy} onClick={() => void test()}>
              Send test
            </button>
            <button type="button" className={s.buttonSecondary} disabled={busy} onClick={() => void run(disablePush)}>
              Turn off
            </button>
          </>
        )}
      </span>
    </div>
  );
}

/** Cloud builds only: the server emails the morning digest (one email a day, never one per task). */
function EmailDigestSettings({
  reminders,
  update,
}: {
  reminders: ReminderSettings;
  update: (patch: Partial<ReminderSettings>) => void;
}) {
  const [draft, setDraft] = useState(reminders.email);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const valid = isEmail(draft);

  function save() {
    const email = draft.trim();
    if (email !== reminders.email && (valid || !email)) update({ email });
  }

  async function test() {
    save();
    setBusy(true);
    const error = await sendTestEmail(draft.trim());
    setMessage(error ? `Couldn't send: ${error}` : `Sent to ${draft.trim()} — check your inbox (and spam)`);
    setBusy(false);
  }

  return (
    <>
      <label className={s.row}>
        <span>
          Email me the daily digest
          <small>One email at the digest time: due today, overdue and coming up</small>
        </span>
        <input
          type="checkbox"
          checked={reminders.emailDigest}
          disabled={!reminders.enabled}
          onChange={(e) => update({ emailDigest: e.target.checked })}
        />
      </label>
      {reminders.emailDigest && (
        <div className={s.row}>
          <span>
            <input
              type="email"
              className={s.input}
              placeholder="you@example.com"
              aria-label="Digest email address"
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                setMessage(null);
              }}
              onBlur={save}
            />
            <small>{message ?? (draft && !valid ? 'Enter a valid email address' : 'Where the digest is sent')}</small>
          </span>
          <button type="button" className={s.buttonSecondary} disabled={busy || !valid} onClick={() => void test()}>
            Send test email
          </button>
        </div>
      )}
    </>
  );
}

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
          {CLOUD_ENABLED && <EmailDigestSettings reminders={reminders} update={updateReminders} />}
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
          {CLOUD_ENABLED && <PushSettings />}
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
