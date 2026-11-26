import { useEffect, useRef, type KeyboardEvent } from 'react';
import type { ItemType, Priority, Recurring, Status } from '../types';
import { isDone, ITEM_TYPES, TYPE_IDS, typeOf } from '../shared/itemTypes';
import { homeValue } from '../lib/items';
import { HomePicker } from './shared/HomePicker';
import { useTaskStore } from '../store/taskStore';
import { useUiStore } from '../store/uiStore';
import { homeOf, depTitles, subtaskProgress, isDepBlocked, wouldCreateCycle } from '../lib/selectors';
import { advanceRecurrence, dateToIso, dueMeta, formatLongDateShortWeekday, isoToDate, today } from '../shared/date';
import { isSnoozed, isWaiting, quickDates } from '../shared/followUp';
import { Checkbox } from './shared/Checkbox';
import s from './Drawer.module.css';

// Each type's own statuses. A task's 'blocked' isn't offered: it's derived from unresolved dependencies.
function statusOptions(type: ItemType): { value: Status; label: string }[] {
  return ITEM_TYPES[type].statuses.filter((o) => o.id !== 'blocked').map((o) => ({ value: o.id, label: o.label }));
}

const LEVEL_OPTIONS = [
  { value: 'high', label: 'High' },
  { value: 'med', label: 'Medium' },
  { value: 'low', label: 'Low' },
];

const PRIO_OPTIONS: { value: Priority; label: string; color: string }[] = [
  { value: 'high', label: 'High', color: 'var(--prio-high)' },
  { value: 'med', label: 'Med', color: 'var(--prio-med)' },
  { value: 'low', label: 'Low', color: 'var(--prio-low)' },
];

const RECUR_OPTIONS: { value: string; label: string }[] = [
  { value: 'none', label: 'Does not repeat' },
  { value: 'weekly', label: 'Every week' },
  { value: 'monthly', label: 'Every month' },
  { value: 'yearly', label: 'Every year' },
];

// Days before the due date for a task's lead reminder ('default' follows Settings). Every open task
// due today is in the daily digest regardless, so 'On the day only' is the minimum.
const REMIND_OPTIONS: { value: string; label: string }[] = [
  { value: '0', label: 'On the day only' },
  { value: '1', label: '1 day before' },
  { value: '2', label: '2 days before' },
  { value: '3', label: '3 days before' },
  { value: '7', label: '1 week before' },
];

function leadLabel(days: number): string {
  return REMIND_OPTIONS.find((o) => o.value === String(days))?.label.toLowerCase() ?? `${days} days before`;
}

export function Drawer() {
  const openId = useUiStore((st) => st.openId);
  const closeDrawer = useUiStore((st) => st.closeDrawer);
  const subDraft = useUiStore((st) => st.subDraft);
  const setSubDraft = useUiStore((st) => st.setSubDraft);
  const store = useTaskStore();
  const {
    tasks,
    toggleDone,
    setStatus,
    setPriority,
    setHome,
    setType,
    setDetail,
    setDueDate,
    setRecurring,
    setRemindDaysBefore,
    setWaitingOn,
    setChaseOn,
    snooze,
    reminders,
    setTitle,
    setNotes,
    addSubtask,
    toggleSubtask,
    deleteTask,
    addDependency,
    removeDependency,
  } = store;
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

  const project = homeOf(task, store);
  const type = typeOf(task);
  const info = ITEM_TYPES[type];
  const done = isDone(task);
  const meta = dueMeta(task.dueDate, done);
  const prog = subtaskProgress(task);
  const blocked = isDepBlocked(task, tasks);
  const todayIso = dateToIso(today());
  const quick = quickDates(todayIso);
  const snoozed = isSnoozed(task, todayIso);
  const dayName = (iso: string) => formatLongDateShortWeekday(isoToDate(iso));
  const depCandidates = tasks.filter(
    (t) => !task.deps.includes(t.id) && !wouldCreateCycle(tasks, task.id, t.id),
  );

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
      <div className={s.panel} role="dialog" aria-label="Task details" onClick={(e) => e.stopPropagation()}>
        <div className={s.header}>
          <div className={s.metaRow}>
            <span className={s.metaDot} style={{ background: project.color }} />
            <select
              className={s.metaProjectSelect}
              value={type}
              onChange={(e) => setType(task.id, e.target.value as ItemType)}
              aria-label="Type"
            >
              {TYPE_IDS.map((t) => (
                <option key={t} value={t}>
                  {ITEM_TYPES[t].label}
                </option>
              ))}
            </select>
            <HomePicker className={s.metaProjectSelect} value={homeValue(task)} onChange={(value) => setHome(task.id, value)} />
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
            {blocked && !done ? (
              <span className={s.blockedBadge}>Blocked · waiting on {depTitles(tasks, task.deps)}</span>
            ) : (
              <select
                className={s.select}
                value={task.status}
                onChange={(e) => setStatus(task.id, e.target.value as Status)}
                aria-label="Status"
              >
                {statusOptions(type).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            )}

            <span className={s.fieldLabel}>{info.priorityLabel}</span>
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

            <span className={s.fieldLabel}>{info.dateLabel}</span>
            <div className={s.dueEditRow}>
              <input
                type="date"
                className={s.dateInput}
                value={task.dueDate}
                onChange={(e) => {
                  if (e.target.value) setDueDate(task.id, e.target.value);
                }}
              />
              <span className={s.fieldValueSans}>{meta.label}</span>
            </div>

            <span className={s.fieldLabel}>Move to</span>
            <div className={s.dueEditRow}>
              <button type="button" className={s.prioBtn} aria-label="Move to tomorrow" onClick={() => setDueDate(task.id, quick.tomorrow)}>
                Tomorrow
              </button>
              <button type="button" className={s.prioBtn} aria-label="Move to next week" onClick={() => setDueDate(task.id, quick.nextWeek)}>
                Next week
              </button>
            </div>

            <span className={s.fieldLabel}>Snooze</span>
            <div className={s.dueEditRow}>
              {snoozed && task.snoozedUntil ? (
                <>
                  <span className={s.fieldValueSans}>Until {dayName(task.snoozedUntil)}</span>
                  <button type="button" className={s.prioBtn} onClick={() => snooze(task.id, '')}>
                    Wake now
                  </button>
                </>
              ) : (
                <>
                  <button type="button" className={s.prioBtn} aria-label="Snooze until tomorrow" onClick={() => snooze(task.id, quick.tomorrow)}>
                    Tomorrow
                  </button>
                  <button type="button" className={s.prioBtn} aria-label="Snooze until next week" onClick={() => snooze(task.id, quick.nextWeek)}>
                    Next week
                  </button>
                  <input
                    type="date"
                    className={s.dateInput}
                    aria-label="Snooze until"
                    min={quick.tomorrow}
                    value=""
                    onChange={(e) => e.target.value && snooze(task.id, e.target.value)}
                  />
                </>
              )}
            </div>

            <span className={s.fieldLabel}>Waiting on</span>
            <input
              className={s.select}
              aria-label="Waiting on"
              placeholder="Nobody"
              value={task.waitingOn ?? ''}
              onChange={(e) => setWaitingOn(task.id, e.target.value)}
            />

            {isWaiting(task) && (
              <>
                <span className={s.fieldLabel}>Chase on</span>
                <div className={s.dueEditRow}>
                  <button type="button" className={s.prioBtn} aria-label="Chase tomorrow" onClick={() => setChaseOn(task.id, quick.tomorrow)}>
                    Tomorrow
                  </button>
                  <button type="button" className={s.prioBtn} aria-label="Chase next week" onClick={() => setChaseOn(task.id, quick.nextWeek)}>
                    Next week
                  </button>
                  <input
                    type="date"
                    className={s.dateInput}
                    aria-label="Chase on"
                    value={task.chaseOn ?? ''}
                    onChange={(e) => setChaseOn(task.id, e.target.value)}
                  />
                </div>
              </>
            )}

            <span className={s.fieldLabel}>Repeats</span>
            <div className={s.dueEditRow}>
              <select
                className={s.select}
                value={task.recurring ?? 'none'}
                onChange={(e) => setRecurring(task.id, e.target.value === 'none' ? null : (e.target.value as Recurring))}
              >
                {RECUR_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              {task.recurring && (
                <span className={s.fieldValueSans}>
                  next {formatLongDateShortWeekday(isoToDate(advanceRecurrence(task.dueDate, task.recurring)))}
                </span>
              )}
            </div>

            <span className={s.fieldLabel}>Remind me</span>
            <div className={s.dueEditRow}>
              <select
                className={s.select}
                value={task.remindDaysBefore === undefined ? 'default' : String(task.remindDaysBefore ?? 0)}
                onChange={(e) =>
                  setRemindDaysBefore(task.id, e.target.value === 'default' ? undefined : Number(e.target.value))
                }
              >
                <option value="default">Default ({leadLabel(reminders.defaultLeadDays)})</option>
                {REMIND_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>

            <span className={s.fieldLabel}>Depends on</span>
            <div className={s.depsBox}>
              {task.deps.map((depId) => {
                // A dep on a task that no longer exists still blocks, so it must stay visible and removable.
                const title = tasks.find((t) => t.id === depId)?.title ?? 'Missing task';
                return (
                  <span key={depId} className={s.depChip}>
                    {title}
                    <button
                      type="button"
                      className={s.depRemove}
                      onClick={() => removeDependency(task.id, depId)}
                      aria-label={`Remove dependency on "${title}"`}
                    >
                      ×
                    </button>
                  </span>
                );
              })}
              {depCandidates.length > 0 && (
                <select
                  className={s.depAddSelect}
                  value=""
                  onChange={(e) => {
                    if (e.target.value) addDependency(task.id, e.target.value);
                  }}
                >
                  <option value="">+ Add dependency</option>
                  {depCandidates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.title}
                    </option>
                  ))}
                </select>
              )}
              {task.deps.length === 0 && depCandidates.length === 0 && (
                <span className={s.fieldValueSans}>—</span>
              )}
            </div>
          </div>

          {info.fields.length > 0 && (
            <div className={`${s.fieldGrid} ${s.typeFields}`} role="group" aria-label={`${info.label} details`}>
              {info.fields.map((field) => {
                const value = String(task.details?.[field.key] ?? '');
                const change = (v: string) => setDetail(task.id, field.key, v);
                return (
                  <label key={field.key} className={s.fieldRowLabel}>
                    <span className={s.fieldLabel}>{field.label}</span>
                    {field.kind === 'level' ? (
                      <select className={s.select} value={value} onChange={(e) => change(e.target.value)} aria-label={field.label}>
                        <option value="">—</option>
                        {LEVEL_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    ) : field.kind === 'date' ? (
                      <input type="date" className={s.dateInput} value={value} onChange={(e) => change(e.target.value)} aria-label={field.label} />
                    ) : field.kind === 'line' ? (
                      <input className={s.select} value={value} onChange={(e) => change(e.target.value)} aria-label={field.label} />
                    ) : (
                      <textarea className={s.notesTextarea} rows={2} value={value} onChange={(e) => change(e.target.value)} aria-label={field.label} />
                    )}
                  </label>
                );
              })}
            </div>
          )}

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
            {done ? `Reopen ${info.label.toLowerCase()}` : task.recurring ? 'Complete & repeat' : info.completeLabel}
          </button>
          <button type="button" className={s.deleteBtn} onClick={handleDelete}>
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
