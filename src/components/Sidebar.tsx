import { useState, type KeyboardEvent } from 'react';
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
  const { tasks, projects, addProject, renameProject } = useTaskStore();
  const navigate = useNavigate();
  const location = useLocation();
  const { project: projectFilter } = useFilters();
  const openComposer = useUiStore((st) => st.openComposer);
  const sidebarOpen = useUiStore((st) => st.sidebarOpen);
  const closeSidebar = useUiStore((st) => st.closeSidebar);

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [addingProject, setAddingProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');

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

  function startRename(id: string, name: string) {
    setRenamingId(id);
    setRenameDraft(name);
  }

  function commitRename() {
    const trimmed = renameDraft.trim();
    if (renamingId && trimmed) renameProject(renamingId, trimmed);
    setRenamingId(null);
    setRenameDraft('');
  }

  function handleRenameKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') e.currentTarget.blur();
    if (e.key === 'Escape') {
      setRenamingId(null);
      setRenameDraft('');
    }
  }

  function commitAddProject() {
    const trimmed = newProjectName.trim();
    if (trimmed) addProject(trimmed);
    setAddingProject(false);
    setNewProjectName('');
  }

  function handleAddProjectKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') e.currentTarget.blur();
    if (e.key === 'Escape') {
      setAddingProject(false);
      setNewProjectName('');
    }
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

      <div className={s.sectionRow}>
        <span className={s.sectionLabel}>Projects</span>
        <button
          type="button"
          className={s.addProjectBtn}
          onClick={() => setAddingProject(true)}
          aria-label="Add project"
        >
          +
        </button>
      </div>
      <div className={s.projectList}>
        {projects.length === 0 && !addingProject && (
          <div className={s.emptyProjects}>No projects yet — add one above.</div>
        )}
        {projects.map((p) => {
          const active = currentScreen === 'tasks' && projectFilter === p.id;
          const count = tasks.filter((t) => t.project === p.id && t.status !== 'done').length;
          const isRenaming = renamingId === p.id;
          return (
            <div key={p.id} className={s.projectRowWrap}>
              {isRenaming ? (
                <div className={s.navRow}>
                  <span className={s.dot} style={{ background: p.color }} />
                  <input
                    className={s.renameInput}
                    autoFocus
                    value={renameDraft}
                    onChange={(e) => setRenameDraft(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={handleRenameKeyDown}
                  />
                </div>
              ) : (
                <button
                  type="button"
                  className={`${s.navRow} ${active ? s.active : ''}`}
                  onClick={() => goToProject(p.id)}
                >
                  <span className={s.dot} style={{ background: p.color }} />
                  <span className={s.label}>{p.name}</span>
                  <span className={s.count}>{count}</span>
                </button>
              )}
              {!isRenaming && (
                <button
                  type="button"
                  className={s.editProjectBtn}
                  onClick={(e) => {
                    e.stopPropagation();
                    startRename(p.id, p.name);
                  }}
                  aria-label={`Rename "${p.name}"`}
                >
                  ✎
                </button>
              )}
            </div>
          );
        })}
        {addingProject && (
          <div className={s.navRow}>
            <span className={s.dot} style={{ background: 'var(--border-strong)' }} />
            <input
              className={s.renameInput}
              autoFocus
              placeholder="Project name"
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              onBlur={commitAddProject}
              onKeyDown={handleAddProjectKeyDown}
            />
          </div>
        )}
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
