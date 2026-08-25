import { useLocation } from 'react-router-dom';
import { useEffect, useRef } from 'react';
import { useTaskStore } from '../store/taskStore';
import { useFilters } from '../lib/useFilters';
import { visibleTasks, withoutDone } from '../lib/selectors';
import { offsetFromToday, formatLongDate, today } from '../lib/date';
import s from './Header.module.css';

const PRIORITIES = [
  { id: 'high', label: 'High' },
  { id: 'med', label: 'Medium' },
  { id: 'low', label: 'Low' },
] as const;

export function Header() {
  const location = useLocation();
  const screen = location.pathname.replace('/', '') || 'dashboard';
  const { tasks, projects } = useTaskStore();
  const f = useFilters();
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      const inField = /input|textarea|select/i.test(target.tagName || '');
      if (e.key === '/' && !inField) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const project = f.project ? projects.find((p) => p.id === f.project) : null;

  let kicker = 'Good morning';
  let title = formatLongDate(today());
  if (project) {
    kicker = 'Project';
    title = project.name;
  } else if (screen === 'tasks') {
    kicker = 'Everything open';
    title = 'All tasks';
  } else if (screen === 'timeline') {
    kicker = 'Timeline';
    title = 'Next two weeks';
  }

  const filtered = visibleTasks(tasks, projects, f);
  const open = withoutDone(filtered);
  const overdue = open.filter((t) => offsetFromToday(t.dueDate) < 0).length;

  let resultLine: string;
  if (screen === 'dashboard') {
    resultLine = `${open.length} open · ${overdue} overdue`;
  } else {
    const shown = screen === 'tasks' && f.taskView === 'board' ? filtered : screen === 'timeline' || f.hideDone ? withoutDone(filtered) : filtered;
    resultLine = `${shown.length} shown`;
  }

  return (
    <header className={s.header}>
      <div className={s.row1}>
        <div className={s.left}>
          <div className={s.kicker}>{kicker}</div>
          <h1 className={s.title}>{title}</h1>
        </div>
        <div className={s.right}>
          <div className={s.search}>
            <span className={s.glyph}>/</span>
            <input
              ref={searchRef}
              placeholder="Search tasks"
              value={f.search}
              onChange={(e) => f.setSearch(e.target.value)}
            />
          </div>
          {screen === 'dashboard' && (
            <div className={s.viewSwitch}>
              {(['focus', 'portfolio'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  className={`${s.viewTab} ${f.dashLayout === v ? s.selected : ''}`}
                  onClick={() => f.setDashLayout(v)}
                >
                  {v === 'focus' ? 'Focus' : 'Portfolio'}
                </button>
              ))}
            </div>
          )}
          {screen === 'tasks' && (
            <div className={s.viewSwitch}>
              {(['list', 'board'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  className={`${s.viewTab} ${f.taskView === v ? s.selected : ''}`}
                  onClick={() => f.setTaskView(v)}
                >
                  {v === 'list' ? 'List' : 'Board'}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className={s.row2}>
        {project && (
          <button type="button" className={`${s.chip} ${s.active}`} onClick={f.clearProject}>
            × {project.name}
          </button>
        )}
        <button
          type="button"
          className={`${s.chip} ${!f.priority ? s.active : ''}`}
          onClick={() => f.setPriority(null)}
        >
          All priorities
        </button>
        {PRIORITIES.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`${s.chip} ${f.priority === p.id ? s.active : ''}`}
            onClick={() => f.setPriority(p.id)}
          >
            {p.label}
          </button>
        ))}
        <button
          type="button"
          className={`${s.chip} ${!f.hideDone ? s.active : ''}`}
          onClick={() => f.setHideDone(!f.hideDone)}
        >
          {f.hideDone ? 'Hiding done' : 'Showing done'}
        </button>
        <div className={s.chipSpacer} />
        <span className={s.resultLine}>{resultLine}</span>
      </div>
    </header>
  );
}
