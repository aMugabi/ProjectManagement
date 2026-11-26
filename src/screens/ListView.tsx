import type { KeyboardEvent } from 'react';
import type { Status, Task } from '../types';
import { isDone, ITEM_TYPES, typeOf } from '../shared/itemTypes';
import { useTaskStore } from '../store/taskStore';
import { useUiStore } from '../store/uiStore';
import { useFilters } from '../lib/useFilters';
import { visibleTasks, withoutDone, sortByDue, subtaskProgress, isDepBlocked, depTitles, homeOf, NO_HOME, type Home } from '../lib/selectors';
import { Checkbox } from '../components/shared/Checkbox';
import { PriorityPill } from '../components/shared/PriorityPill';
import { DuePill } from '../components/shared/DuePill';
import s from './ListView.module.css';

// Each type's own statuses. A task's 'blocked' isn't offered: it's derived from unresolved dependencies.
function statusOptions(t: Task): { value: Status; label: string }[] {
  return ITEM_TYPES[typeOf(t)].statuses.filter((o) => o.id !== 'blocked').map((o) => ({ value: o.id, label: o.label }));
}

export function ListView() {
  const store = useTaskStore();
  const { tasks, projects, products, partners, pairs, toggleDone, setStatus, setTitle } = store;
  const ui = useUiStore();
  const f = useFilters();

  const filtered = visibleTasks(tasks, store, f);
  const shown = f.hideDone ? withoutDone(filtered) : filtered;

  // Grouped by where items belong: projects, then each product, its pairs, partners, and nothing.
  const homes: Home[] = [
    ...projects.map((p) => homeOf({ project: p.id }, store)),
    ...products.flatMap((p) => [
      homeOf({ project: '', product: p.id }, store),
      ...pairs.filter((x) => x.product === p.id).map((x) => homeOf({ project: '', product: x.product, partner: x.partner }, store)),
    ]),
    ...partners.map((p) => homeOf({ project: '', partner: p.id }, store)),
    NO_HOME,
  ];
  const groups = homes
    .map((home) => ({ project: home, tasks: sortByDue(shown.filter((t) => homeOf(t, store).value === home.value)) }))
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
        <div key={project.value}>
          <div className={s.groupHeader}>
            <span className={s.groupDot} style={{ background: project.color }} />
            <span className={s.groupName}>{project.name}</span>
            <span className={s.groupCount}>
              {groupTasks.filter((t) => !isDone(t)).length} open
            </span>
          </div>
          {groupTasks.map((t) => {
            const prog = subtaskProgress(t);
            const editing = ui.editingId === t.id;
            const blocked = isDepBlocked(t, tasks);
            const done = isDone(t);
            const type = typeOf(t);
            return (
              <div key={t.id} className={s.row}>
                <Checkbox done={done} onToggle={() => toggleDone(t.id)} label={`Mark "${t.title}" done`} />
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
                    className={`${s.titleDisplay} ${done ? s.done : ''}`}
                    onClick={() => ui.openDrawer(t.id)}
                    onDoubleClick={() => ui.startEdit(t.id, t.title)}
                  >
                    {t.title}
                  </div>
                )}
                {type !== 'task' && <span className={s.recurBadge}>{ITEM_TYPES[type].label}</span>}
                {t.recurring && <span className={s.recurBadge}>{t.recurring}</span>}
                {prog.total > 0 && (
                  <span className={s.subCount}>
                    {prog.done}/{prog.total}
                  </span>
                )}
                {blocked && !done ? (
                  <span className={s.blockedBadge} title={`Waiting on ${depTitles(tasks, t.deps)}`}>
                    Blocked
                  </span>
                ) : (
                  <select
                    className={s.statusSelect}
                    value={t.status}
                    onChange={(e) => setStatus(t.id, e.target.value as Status)}
                    aria-label={`Status of "${t.title}"`}
                  >
                    {statusOptions(t).map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                )}
                <PriorityPill priority={t.priority} done={done} />
                <DuePill dueDate={t.dueDate} done={done} />
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
