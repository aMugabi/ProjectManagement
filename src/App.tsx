import { useEffect } from 'react';
import { Navigate, Route, Routes, useNavigate, useSearchParams } from 'react-router-dom';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { Drawer } from './components/Drawer';
import { Composer } from './components/Composer';
import { ReminderToasts } from './components/ReminderToasts';
import { SettingsDialog } from './components/SettingsDialog';
import { Dashboard } from './screens/Dashboard';
import { Tasks } from './screens/Tasks';
import { Timeline } from './screens/Timeline';
import { useUiStore } from './store/uiStore';
import { useTaskStore } from './store/taskStore';
import { useReminders } from './lib/useReminders';
import { openTask } from './lib/openTask';
import s from './App.module.css';

export default function App() {
  const composing = useUiStore((st) => st.composing);
  const openComposer = useUiStore((st) => st.openComposer);
  const reminders = useReminders();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const linkedTask = params.get('task');
  const linkedWorkspace = params.get('ws');

  // Reminder links (?task=<id>&ws=<workspace>) open that task's drawer, then tidy the URL.
  useEffect(() => {
    if (!linkedTask) return;
    const open = () => {
      openTask(linkedTask, linkedWorkspace);
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete('task');
          next.delete('ws');
          return next;
        },
        { replace: true },
      );
    };
    // Wait for stored data, or the task (and its workspace) won't be there yet.
    if (useTaskStore.persist.hasHydrated()) open();
    else return useTaskStore.persist.onFinishHydration(open);
  }, [linkedTask, linkedWorkspace, setParams]);

  // Notification clicks while Ledger is already open arrive from the service worker (public/push-sw.js).
  useEffect(() => {
    const sw = navigator.serviceWorker;
    if (!sw) return;
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === 'ledger:open' && typeof e.data.path === 'string') navigate(`/${e.data.path}`);
    };
    sw.addEventListener('message', onMessage);
    return () => sw.removeEventListener('message', onMessage);
  }, [navigate]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      const inField = /input|textarea|select/i.test(target.tagName || '');
      if (e.key === 'n' && !composing && !inField) {
        e.preventDefault();
        openComposer();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [composing, openComposer]);

  return (
    <div className={s.app}>
      <div className={s.body}>
        <Sidebar />
        <div className={s.main}>
          <Header />
          <div className={s.content}>
            <Routes>
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/tasks" element={<Tasks />} />
              <Route path="/timeline" element={<Timeline />} />
              <Route path="*" element={<Navigate to="/dashboard" replace />} />
            </Routes>
          </div>
        </div>
      </div>
      <Drawer />
      <Composer />
      <SettingsDialog />
      <ReminderToasts
        toasts={reminders.toasts}
        onOpen={reminders.open}
        onSnooze={reminders.snooze}
        onDismiss={reminders.dismiss}
      />
    </div>
  );
}
