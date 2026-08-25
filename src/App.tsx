import { useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { Drawer } from './components/Drawer';
import { Composer } from './components/Composer';
import { Dashboard } from './screens/Dashboard';
import { Tasks } from './screens/Tasks';
import { Timeline } from './screens/Timeline';
import { useUiStore } from './store/uiStore';
import s from './App.module.css';

export default function App() {
  const composing = useUiStore((st) => st.composing);
  const openComposer = useUiStore((st) => st.openComposer);

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
    </div>
  );
}
