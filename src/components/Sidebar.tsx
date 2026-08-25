import { useLocation, useNavigate } from 'react-router-dom';
import { useTaskStore } from '../store/taskStore';
import { useUiStore } from '../store/uiStore';
import { useFilters } from '../lib/useFilters';
import s from './Sidebar.module.css';

const NAV_ITEMS = [
  { screen: 'dashboard', glyph: '◧', label: 'Dashboard', showCount: false },
  { screen: 'tasks', glyph: '≡', label: 'All tasks', showCount: true },
  { screen: 'timeline', glyph: '⋯', label: 'Timeline', showCount: false },
] as const;

export function Sidebar() {
  const { tasks, projects } = useTaskStore();
  const navigate = useNavigate();
  const location = useLocation();
  const { project: projectFilter } = useFilters();
  const openComposer = useUiStore((st) => st.openComposer);
  const sidebarOpen = useUiStore((st) => st.sidebarOpen);
  const closeSidebar = useUiStore((st) => st.closeSidebar);

  const currentScreen = location.pathname.replace('/', '') || 'dashboard';
  const openCount = tasks.filter((t) => t.status !== 'done').length;

  function goToScreen(screen: string) {
    navigate(`/${screen}`);
    closeSidebar();
  }

  function goToProject(id: string) {
    navigate(`/tasks?project=${id}`);
    closeSidebar();
  }

  return (
    <>
      <div
        className={`${s.scrim} ${sidebarOpen ? s.visible : ''}`}
        onClick={closeSidebar}
        aria-hidden="true"
      />
      <aside className={`${s.sidebar} ${sidebarOpen ? s.open : ''}`}>
        <div className={s.brandRow}>
          <div className={s.mark} />
          <span className={s.wordmark}>Ledger</span>
          <button type="button" className={s.closeSidebarBtn} onClick={closeSidebar} aria-label="Close menu">
            ×
          </button>
        </div>

        <button type="button" className={s.newTaskButton} onClick={openComposer}>
          <span className={s.plus}>+</span> New task
        </button>

      <nav className={s.nav}>
        {NAV_ITEMS.map((item) => {
          const active = currentScreen === item.screen && !projectFilter;
          return (
            <button
              key={item.screen}
              type="button"
              className={`${s.navRow} ${active ? s.active : ''}`}
              onClick={() => goToScreen(item.screen)}
            >
              <span className={s.glyph}>{item.glyph}</span>
              <span className={s.label}>{item.label}</span>
              {item.showCount && <span className={s.count}>{openCount}</span>}
            </button>
          );
        })}
      </nav>

      <div className={s.sectionLabel}>Projects</div>
      <div className={s.projectList}>
        {projects.map((p) => {
          const active = currentScreen === 'tasks' && projectFilter === p.id;
          const count = tasks.filter((t) => t.project === p.id && t.status !== 'done').length;
          return (
            <button
              key={p.id}
              type="button"
              className={`${s.navRow} ${active ? s.active : ''}`}
              onClick={() => goToProject(p.id)}
            >
              <span className={s.dot} style={{ background: p.color }} />
              <span className={s.label}>{p.name}</span>
              <span className={s.count}>{count}</span>
            </button>
          );
        })}
      </div>

      <div className={s.spacer} />
      <div className={s.footer}>
        <div className={s.avatar}>JM</div>
        <span className={s.footerLabel}>Solo workspace</span>
      </div>
      </aside>
    </>
  );
}
