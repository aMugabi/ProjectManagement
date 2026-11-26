import { useState, type KeyboardEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTaskStore } from '../store/taskStore';
import { useUiStore } from '../store/uiStore';
import { useFilters } from '../lib/useFilters';
import { CLOUD_ENABLED } from '../lib/cloud';
import { isDone } from '../shared/itemTypes';
import { isWaiting } from '../shared/followUp';
import type { GroupKind } from '../store/taskStore';
import s from './Sidebar.module.css';

const NAV_ITEMS = [
  { screen: 'dashboard', glyph: '◧', label: 'Dashboard', showCount: false },
  { screen: 'tasks', glyph: '≡', label: 'All tasks', showCount: true },
  { screen: 'timeline', glyph: '⋯', label: 'Timeline', showCount: false },
  { screen: 'waiting', glyph: '⧖', label: 'Waiting on', showCount: true },
] as const;

export function Sidebar() {
  const {
    tasks,
    workspaces,
    activeWorkspaceId,
    addWorkspace,
    renameWorkspace,
    setActiveWorkspace,
  } = useTaskStore();
  const navigate = useNavigate();
  const location = useLocation();
  const f = useFilters();
  const projectFilter = f.project ?? f.product ?? f.partner;
  const openComposer = useUiStore((st) => st.openComposer);
  const sidebarOpen = useUiStore((st) => st.sidebarOpen);
  const closeSidebar = useUiStore((st) => st.closeSidebar);
  const openSettings = useUiStore((st) => st.openSettings);


  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const [renamingWorkspaceId, setRenamingWorkspaceId] = useState<string | null>(null);
  const [renameWorkspaceDraft, setRenameWorkspaceDraft] = useState('');
  const [addingWorkspace, setAddingWorkspace] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState('');

  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId);

  const currentScreen = location.pathname.replace('/', '') || 'dashboard';
  const open = tasks.filter((t) => !isDone(t));
  const counts: Record<string, number> = { tasks: open.length, waiting: open.filter(isWaiting).length };

  function goToScreen(screen: string) {
    navigate(`/${screen}`);
    closeSidebar();
  }

  function switchWorkspace(id: string) {
    setActiveWorkspace(id);
    setWorkspaceMenuOpen(false);
    navigate('/dashboard');
    closeSidebar();
  }

  function startRenameWorkspace(id: string, name: string) {
    setRenamingWorkspaceId(id);
    setRenameWorkspaceDraft(name);
  }

  function commitRenameWorkspace() {
    const trimmed = renameWorkspaceDraft.trim();
    if (renamingWorkspaceId && trimmed) renameWorkspace(renamingWorkspaceId, trimmed);
    setRenamingWorkspaceId(null);
    setRenameWorkspaceDraft('');
  }

  function handleRenameWorkspaceKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') e.currentTarget.blur();
    if (e.key === 'Escape') {
      setRenamingWorkspaceId(null);
      setRenameWorkspaceDraft('');
    }
  }

  function commitAddWorkspace() {
    const trimmed = newWorkspaceName.trim();
    if (trimmed) addWorkspace(trimmed);
    setAddingWorkspace(false);
    setNewWorkspaceName('');
  }

  function handleAddWorkspaceKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') e.currentTarget.blur();
    if (e.key === 'Escape') {
      setAddingWorkspace(false);
      setNewWorkspaceName('');
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
              {item.showCount && <span className={s.count}>{counts[item.screen]}</span>}
            </button>
          );
        })}
      </nav>

      <GroupSection kind="project" label="Projects" />
      <GroupSection kind="product" label="Products" />
      <GroupSection kind="partner" label="Partners" />

      <div className={s.spacer} />
      <div className={s.footerWrap}>
        {workspaceMenuOpen && (
          <>
            <div className={s.menuScrim} onClick={() => setWorkspaceMenuOpen(false)} aria-hidden="true" />
            <div className={s.workspaceMenu}>
              <div className={s.sectionLabel}>Workspaces</div>
              {workspaces.map((w) => {
                const isRenaming = renamingWorkspaceId === w.id;
                const isActive = w.id === activeWorkspaceId;
                return (
                  <div key={w.id} className={s.projectRowWrap}>
                    {isRenaming ? (
                      <div className={s.navRow}>
                        <input
                          className={s.renameInput}
                          autoFocus
                          value={renameWorkspaceDraft}
                          onChange={(e) => setRenameWorkspaceDraft(e.target.value)}
                          onBlur={commitRenameWorkspace}
                          onKeyDown={handleRenameWorkspaceKeyDown}
                        />
                      </div>
                    ) : (
                      <button
                        type="button"
                        className={`${s.navRow} ${isActive ? s.active : ''}`}
                        onClick={() => switchWorkspace(w.id)}
                      >
                        <span className={s.label}>{w.name}</span>
                        {isActive && <span className={s.count}>current</span>}
                      </button>
                    )}
                    {!isRenaming && (
                      <button
                        type="button"
                        className={s.editProjectBtn}
                        onClick={(e) => {
                          e.stopPropagation();
                          startRenameWorkspace(w.id, w.name);
                        }}
                        aria-label={`Rename "${w.name}"`}
                      >
                        ✎
                      </button>
                    )}
                  </div>
                );
              })}
              {addingWorkspace ? (
                <div className={s.navRow}>
                  <input
                    className={s.renameInput}
                    autoFocus
                    placeholder="Workspace name"
                    value={newWorkspaceName}
                    onChange={(e) => setNewWorkspaceName(e.target.value)}
                    onBlur={commitAddWorkspace}
                    onKeyDown={handleAddWorkspaceKeyDown}
                  />
                </div>
              ) : (
                <button type="button" className={s.addWorkspaceBtn} onClick={() => setAddingWorkspace(true)}>
                  + New workspace
                </button>
              )}
            </div>
          </>
        )}
        <div className={s.footerRow}>
          <button type="button" className={s.footer} onClick={() => setWorkspaceMenuOpen((v) => !v)}>
            <div className={s.avatar}>JM</div>
            <span className={s.footerLabel}>{activeWorkspace?.name ?? 'Workspace'}</span>
            <span className={s.footerChevron}>{workspaceMenuOpen ? '▾' : '▴'}</span>
          </button>
          <button type="button" className={s.settingsBtn} onClick={openSettings} aria-label="Settings" title="Settings">
            ⚙
          </button>
        </div>
        {!CLOUD_ENABLED && (
          <div className={s.localOnly} title="This build has no cloud sync: tasks are saved in this browser only.">
            Local only · this browser
          </div>
        )}
      </div>
      </aside>
    </>
  );
}

const SINGULAR: Record<GroupKind, string> = { project: 'project', product: 'product', partner: 'partner' };
const LIST = { project: 'projects', product: 'products', partner: 'partners' } as const;

/**
 * One sidebar section: projects, products or partners, each opening the task list filtered to it,
 * with an open-item count, and add, rename and delete. A product's or partner's count includes
 * its pairs' items.
 */
function GroupSection({ kind, label }: { kind: GroupKind; label: string }) {
  const store = useTaskStore();
  const { tasks, addGroup, renameGroup, deleteGroup } = store;
  const groups = store[LIST[kind]];
  const navigate = useNavigate();
  const location = useLocation();
  const f = useFilters();
  const closeSidebar = useUiStore((st) => st.closeSidebar);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const singular = SINGULAR[kind];
  const Singular = singular[0].toUpperCase() + singular.slice(1);
  const currentScreen = location.pathname.replace('/', '') || 'dashboard';

  function open(id: string) {
    navigate(`/tasks?${kind}=${encodeURIComponent(id)}`);
    closeSidebar();
  }

  function commitRename() {
    if (renamingId && renameDraft.trim()) renameGroup(kind, renamingId, renameDraft);
    setRenamingId(null);
    setRenameDraft('');
  }

  function commitAdd() {
    if (newName.trim()) addGroup(kind, newName);
    setAdding(false);
    setNewName('');
  }

  function keyHandler(cancel: () => void) {
    return (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') e.currentTarget.blur();
      if (e.key === 'Escape') cancel();
    };
  }

  function handleDelete(id: string, name: string) {
    const count = tasks.filter((t) => t[kind] === id).length;
    const items = `${count} item${count === 1 ? '' : 's'}`;
    const message =
      kind === 'project'
        ? count
          ? `Delete "${name}"? This also deletes its ${count} task${count === 1 ? '' : 's'}. This can't be undone.`
          : `Delete "${name}"? This can't be undone.`
        : count
          ? `Delete "${name}"? Its ${items} stay, no longer in this ${singular}. This can't be undone.`
          : `Delete "${name}"? This can't be undone.`;
    if (window.confirm(message)) deleteGroup(kind, id);
  }

  // Products and partners are new in Step 1b: their sections show only a heading until used.
  const quiet = kind !== 'project' && groups.length === 0 && !adding;

  return (
    <>
      <div className={s.sectionRow}>
        <span className={s.sectionLabel}>{label}</span>
        <button type="button" className={s.addProjectBtn} onClick={() => setAdding(true)} aria-label={`Add ${singular}`}>
          +
        </button>
      </div>
      {!quiet && <div className={s.projectList}>
        {kind === 'project' && groups.length === 0 && !adding && (
          <div className={s.emptyProjects}>No projects yet — add one above.</div>
        )}
        {groups.map((p) => {
          const active = currentScreen === 'tasks' && f[kind] === p.id;
          const count = tasks.filter((t) => t[kind] === p.id && !isDone(t)).length;
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
                    onKeyDown={keyHandler(() => {
                      setRenamingId(null);
                      setRenameDraft('');
                    })}
                  />
                </div>
              ) : (
                <button type="button" className={`${s.navRow} ${active ? s.active : ''}`} onClick={() => open(p.id)}>
                  <span className={s.dot} style={{ background: p.color }} />
                  <span className={s.label}>{p.name}</span>
                  <span className={s.count}>{count}</span>
                </button>
              )}
              {!isRenaming && (
                <>
                  <button
                    type="button"
                    className={s.editProjectBtn}
                    onClick={(e) => {
                      e.stopPropagation();
                      setRenamingId(p.id);
                      setRenameDraft(p.name);
                    }}
                    aria-label={`Rename "${p.name}"`}
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    className={`${s.editProjectBtn} ${s.deleteProjectBtn}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(p.id, p.name);
                    }}
                    aria-label={`Delete "${p.name}"`}
                  >
                    🗑
                  </button>
                </>
              )}
            </div>
          );
        })}
        {adding && (
          <div className={s.navRow}>
            <span className={s.dot} style={{ background: 'var(--border-strong)' }} />
            <input
              className={s.renameInput}
              autoFocus
              placeholder={`${Singular} name`}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onBlur={commitAdd}
              onKeyDown={keyHandler(() => {
                setAdding(false);
                setNewName('');
              })}
            />
          </div>
        )}
      </div>}
    </>
  );
}

