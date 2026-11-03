import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTaskStore } from '../store/taskStore';
import { computeReminders, type LocalNow, type Reminder } from '../shared/reminders';
import { dateToIso, today } from '../shared/date';
import { isPushActive, notificationPermission, showSystemNotification } from './notifications';

/** Per-device record of what happened to each reminder, so pop-ups and notifications don't repeat. */
const LOG_KEY = 'ledger-reminders';
const LOG_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const SNOOZE_MS = 60 * 60 * 1000;

interface LogEntry {
  at: number;
  notifiedAt?: number;
  dismissedAt?: number;
  snoozeUntil?: number;
}
type Log = Record<string, LogEntry>;

function loadLog(): Log {
  try {
    const log = JSON.parse(localStorage.getItem(LOG_KEY) ?? '{}') as Log;
    const cutoff = Date.now() - LOG_TTL_MS;
    for (const [key, entry] of Object.entries(log)) if (entry.at < cutoff) delete log[key];
    return log;
  } catch {
    return {};
  }
}

function saveLog(log: Log) {
  try {
    localStorage.setItem(LOG_KEY, JSON.stringify(log));
  } catch {
    // ignore
  }
}

function updateLog(key: string, patch: Partial<LogEntry>) {
  const log = loadLog();
  log[key] = { ...log[key], at: Date.now(), ...patch };
  saveLog(log);
}

function deviceNow(): LocalNow {
  const d = new Date();
  return { date: dateToIso(today()), minutes: d.getHours() * 60 + d.getMinutes() };
}

const sameKeys = (a: Reminder[], b: Reminder[]) =>
  a.length === b.length && a.every((r, i) => r.key === b[i].key && r.title === b[i].title);

/**
 * Due reminders for in-app pop-ups. Checks every minute, on data changes and when the app comes
 * back into view. While the tab is hidden it also raises system notifications — unless this
 * device has push turned on, in which case the server sends them (avoiding duplicates).
 */
export function useReminders() {
  const navigate = useNavigate();
  const [toasts, setToasts] = useState<Reminder[]>([]);

  useEffect(() => {
    const tick = () => {
      if (!useTaskStore.persist.hasHydrated()) return;
      const due = computeReminders(useTaskStore.getState(), deviceNow());
      const log = loadLog();
      const now = Date.now();
      const visible = due.filter((r) => !log[r.key]?.dismissedAt && !((log[r.key]?.snoozeUntil ?? 0) > now));
      setToasts((prev) => (sameKeys(prev, visible) ? prev : visible));

      if (document.visibilityState === 'hidden' && notificationPermission() === 'granted' && !isPushActive()) {
        for (const r of visible) {
          if (log[r.key]?.notifiedAt) continue;
          log[r.key] = { ...log[r.key], at: now, notifiedAt: now };
          void showSystemNotification(r);
        }
      }
      saveLog(log);
    };

    // Keep the server's reminder time zone in step with this device (after hydration, so the
    // stamped change can't be overwritten by the stored copy).
    const syncTimezone = () => {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const { reminders, updateReminders } = useTaskStore.getState();
      if (tz && reminders.timezone !== tz) updateReminders({ timezone: tz });
      tick();
    };
    const unsubHydration = useTaskStore.persist.hasHydrated()
      ? (syncTimezone(), () => {})
      : useTaskStore.persist.onFinishHydration(syncTimezone);

    const interval = setInterval(tick, 60_000);
    const unsubStore = useTaskStore.subscribe(tick);
    document.addEventListener('visibilitychange', tick);
    return () => {
      unsubHydration();
      clearInterval(interval);
      unsubStore();
      document.removeEventListener('visibilitychange', tick);
    };
  }, []);

  const dismiss = useCallback((key: string) => {
    updateLog(key, { dismissedAt: Date.now() });
    setToasts((prev) => prev.filter((r) => r.key !== key));
  }, []);

  const snooze = useCallback((key: string) => {
    updateLog(key, { snoozeUntil: Date.now() + SNOOZE_MS });
    setToasts((prev) => prev.filter((r) => r.key !== key));
  }, []);

  const open = useCallback(
    (r: Reminder) => {
      dismiss(r.key);
      navigate(`/${r.url}`);
    },
    [dismiss, navigate],
  );

  return { toasts, dismiss, snooze, open };
}
