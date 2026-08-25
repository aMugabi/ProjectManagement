import type { KeyboardEvent } from 'react';
import type { Status, Task } from '../types';
import { useTaskStore } from '../store/taskStore';
import { useUiStore } from '../store/uiStore';
import { useFilters } from '../lib/useFilters';
import { visibleTasks, withoutDone, sortByDue, subtaskProgress, isDepBlocked, depTitles } from '../lib/selectors';
import { Checkbox } from '../components/shared/Checkbox';
import { PriorityPill } from '../components/shared/PriorityPill';
import { DuePill } from '../components/shared/DuePill';
import s from './ListView.module.css';

// 'blocked' isn't offered here — it's derived from unresolved dependencies, not picked manually.
const STATUS_OPTIONS: { value: Status; label: string }[] = [
  { value: 'todo', label: 'To do' },
  { value: 'doing', label: 'In progress' },
  { value: 'done', label: 'Done' },
];

export function ListView() {
  const { tasks, projects, toggleDone, setStatus, setTitle } = useTaskStore();
  const ui = useUiStore();
  const f = useFilters();

  const filtered = visibleTasks(tasks, projects, f);
  const shown = f.hideDone ? withoutDone(filtered) : filtered;

  const groups = projects
    .map((p) => ({ project: p, tasks: sortByDue(shown.filter((t) => t.project === p.id)) }))
    .filter((g) => g.tasks.length > 0);

  function commitEdit(task: Task) {
    const value = ui.editDraft.trim();
    if (value) setTitle(task.id, value);
    ui.stopEdit();
  }

  function handleTitleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') e.currentTarget.blur();
    if (e.key === 'Escape') ui.stopEdit();
  }

  if (groups.length === 0) {
    return (
      <div className={s.card}>
        <div className={s.emptyNote}>No tasks match the current filters.</div>
      </div>
    );
  }

  return (
    <div className={s.card}>
      {groups.map(({ project, tasks: groupTasks }) => (
        <div key={project.id}>
          <div className={s.groupHeader}>
            <span className={s.groupDot} style={{ background: project.color }} />
            <span className={s.groupName}>{project.name}</span>
            <span className={s.groupCount}>
              {groupTasks.filter((t) => t.status !== 'done').length} open
            </span>
          </div>
          {groupTasks.map((t) => {
            const prog = subtaskProgress(t);
            const editing = ui.editingId === t.id;
            const blocked = isDepBlocked(t, tasks);
            return (
              <div key={t.id} className={s.row}>
                <Checkbox done={t.status === 'done'} onToggle={() => toggleDone(t.id)} label={`Mark "${t.title}" done`} />
                {editing ? (
                  <input
                    className={s.titleEdit}
                    autoFocus
                    value={ui.editDraft}
                    onChange={(e) => ui.setEditDraft(e.target.value)}
                    onBlur={() => commitEdit(t)}
                    onKeyDown={handleTitleKeyDown}
                  />
                ) : (
                  <div
                    className={`${s.titleDisplay} ${t.status === 'done' ? s.done : ''}`}
                    onClick={() => ui.openDrawer(t.id)}
                    onDoubleClick={() => ui.startEdit(t.id, t.title)}
                  >
                    {t.title}
                  </div>
                )}
                {t.recurring && <span className={s.recurBadge}>{t.recurring}</span>}
                {prog.total > 0 && (
                  <span className={s.subCount}>
                    {prog.done}/{prog.total}
                  </span>
                )}
                {blocked && t.status !== 'done' ? (
                  <span className={s.blockedBadge} title={`Waiting on ${depTitles(tasks, t.deps)}`}>
                    Blocked
                  </span>
                ) : (
                  <select
                    className={s.statusSelect}
                    value={t.status}
                    onChange={(e) => setStatus(t.id, e.target.value as Status)}
                  >
                    {STATUS_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                )}
                <PriorityPill priority={t.priority} status={t.status} />
                <DuePill dueDate={t.dueDate} status={t.status} />
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
