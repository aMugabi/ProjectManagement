import { useEffect, useRef, type KeyboardEvent } from 'react';
import type { Priority, Status } from '../types';
import { useTaskStore } from '../store/taskStore';
import { useUiStore } from '../store/uiStore';
import { projectById, depTitles, subtaskProgress } from '../lib/selectors';
import { dueMeta, formatLongDateShortWeekday, isoToDate } from '../lib/date';
import { Checkbox } from './shared/Checkbox';
import s from './Drawer.module.css';

const STATUS_OPTIONS: { value: Status; label: string }[] = [
  { value: 'todo', label: 'To do' },
  { value: 'doing', label: 'In progress' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'done', label: 'Done' },
];

const PRIO_OPTIONS: { value: Priority; label: string; color: string }[] = [
  { value: 'high', label: 'High', color: 'var(--prio-high)' },
  { value: 'med', label: 'Med', color: 'var(--prio-med)' },
  { value: 'low', label: 'Low', color: 'var(--prio-low)' },
];

const RECUR_LABEL: Record<string, string> = {
  weekly: 'every week',
  monthly: 'every month',
  yearly: 'every year',
};

export function Drawer() {
  const openId = useUiStore((st) => st.openId);
  const closeDrawer = useUiStore((st) => st.closeDrawer);
  const subDraft = useUiStore((st) => st.subDraft);
  const setSubDraft = useUiStore((st) => st.setSubDraft);
  const { tasks, projects, toggleDone, setStatus, setPriority, setTitle, setNotes, addSubtask, toggleSubtask, deleteTask } =
    useTaskStore();
  const titleRef = useRef<HTMLTextAreaElement>(null);

  const task = openId ? tasks.find((t) => t.id === openId) : null;

  useEffect(() => {
    if (titleRef.current) {
      titleRef.current.style.height = 'auto';
      titleRef.current.style.height = `${titleRef.current.scrollHeight}px`;
    }
  }, [task?.title]);

  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key === 'Escape' && openId) closeDrawer();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openId, closeDrawer]);

  if (!task) return null;

  const project = projectById(projects, task.project);
  const meta = dueMeta(task.dueDate, task.status);
  const prog = subtaskProgress(task);
  const done = task.status === 'done';

  function handleSubKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && subDraft.trim() && task) {
      addSubtask(task.id, subDraft.trim());
      setSubDraft('');
    }
  }

  function handleDelete() {
    if (!task) return;
    if (window.confirm(`Delete "${task.title}"? This can't be undone.`)) {
      deleteTask(task.id);
      closeDrawer();
    }
  }

  return (
    <div className={s.scrim} onClick={closeDrawer}>
      <div className={s.panel} onClick={(e) => e.stopPropagation()}>
        <div className={s.header}>
          <div className={s.metaRow}>
            <span className={s.metaDot} style={{ background: project.color }} />
            <span className={s.metaProject}>{project.name}</span>
            <div className={s.metaSpacer} />
            <button type="button" className={s.closeBtn} onClick={closeDrawer} aria-label="Close">
              ×
            </button>
          </div>
          <textarea
            ref={titleRef}
            className={s.titleInput}
            rows={2}
            value={task.title}
            onChange={(e) => setTitle(task.id, e.target.value)}
          />
        </div>

        <div className={s.body}>
          <div className={s.fieldGrid}>
            <span className={s.fieldLabel}>Status</span>
            <select
              className={s.select}
              value={task.status}
              onChange={(e) => setStatus(task.id, e.target.value as Status)}
            >
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>

            <span className={s.fieldLabel}>Priority</span>
            <div className={s.prioGroup}>
              {PRIO_OPTIONS.map((o) => {
                const selected = task.priority === o.value;
                return (
                  <button
                    key={o.value}
                    type="button"
                    className={`${s.prioBtn} ${selected ? s.selected : ''}`}
                    style={
                      selected
                        ? { borderColor: o.color, background: `${o.color}18`, color: o.color }
                        : undefined
                    }
                    onClick={() => setPriority(task.id, o.value)}
                  >
                    {o.label}
                  </button>
                );
              })}
            </div>

            <span className={s.fieldLabel}>Due</span>
            <span className={s.fieldValue}>
              {formatLongDateShortWeekday(isoToDate(task.dueDate))}  ·  {meta.label}
            </span>

            <span className={s.fieldLabel}>Repeats</span>
            <span className={s.fieldValueSans}>{task.recurring ? RECUR_LABEL[task.recurring] : 'does not repeat'}</span>

            <span className={s.fieldLabel}>Depends on</span>
            <span className={s.fieldValueSans}>{depTitles(tasks, task.deps)}</span>
          </div>

          <div className={s.subtasksSection}>
            <div className={s.sectionHeading}>
              Subtasks
              {prog.total > 0 && (
                <span className={s.sectionCount}>
                  {prog.done}/{prog.total}
                </span>
              )}
            </div>
            {task.subs.map((sub, i) => (
              <div key={i} className={s.subRow} onClick={() => toggleSubtask(task.id, i)}>
                <Checkbox done={sub.done} onToggle={() => toggleSubtask(task.id, i)} size="sub" label={`Mark "${sub.text}" done`} />
                <span className={`${s.subText} ${sub.done ? s.done : ''}`}>{sub.text}</span>
              </div>
            ))}
            <div className={s.addSubRow}>
              <input
                className={s.addSubInput}
                placeholder="Add a subtask"
                value={subDraft}
                onChange={(e) => setSubDraft(e.target.value)}
                onKeyDown={handleSubKeyDown}
              />
              <button
                type="button"
                className={s.addSubButton}
                onClick={() => {
                  if (subDraft.trim()) {
                    addSubtask(task.id, subDraft.trim());
                    setSubDraft('');
                  }
                }}
              >
                Add
              </button>
            </div>
          </div>

          <div className={s.notesSection}>
            <div className={s.notesLabel}>Notes</div>
            <textarea
              className={s.notesTextarea}
              rows={4}
              placeholder="Anything worth remembering…"
              value={task.notes}
              onChange={(e) => setNotes(task.id, e.target.value)}
            />
          </div>
        </div>

        <div className={s.footer}>
          <button
            type="button"
            className={`${s.primaryBtn} ${done ? s.reopen : s.complete}`}
            onClick={() => toggleDone(task.id)}
          >
            {done ? 'Reopen task' : 'Mark complete'}
          </button>
          <button type="button" className={s.deleteBtn} onClick={handleDelete}>
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
