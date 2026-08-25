import { useEffect, useRef, type KeyboardEvent } from 'react';
import type { Priority } from '../types';
import { useTaskStore } from '../store/taskStore';
import { useUiStore } from '../store/uiStore';
import { useFilters } from '../lib/useFilters';
import { addDays, dateToIso, today } from '../lib/date';
import s from './Composer.module.css';

const PRIO_OPTIONS: { value: Priority; label: string }[] = [
  { value: 'high', label: 'High' },
  { value: 'med', label: 'Med' },
  { value: 'low', label: 'Low' },
];

const DUE_OPTIONS: { label: string; offset: number }[] = [
  { label: 'Today', offset: 0 },
  { label: 'Tomorrow', offset: 1 },
  { label: 'This week', offset: 4 },
  { label: 'Later', offset: 14 },
];

export function Composer() {
  const composing = useUiStore((st) => st.composing);
  const closeComposer = useUiStore((st) => st.closeComposer);
  const draftTitle = useUiStore((st) => st.draftTitle);
  const setDraftTitle = useUiStore((st) => st.setDraftTitle);
  const resetDraftTitle = useUiStore((st) => st.resetDraftTitle);
  const draftProject = useUiStore((st) => st.draftProject);
  const setDraftProject = useUiStore((st) => st.setDraftProject);
  const draftPrio = useUiStore((st) => st.draftPrio);
  const setDraftPrio = useUiStore((st) => st.setDraftPrio);
  const draftDueOffset = useUiStore((st) => st.draftDueOffset);
  const setDraftDueOffset = useUiStore((st) => st.setDraftDueOffset);
  const { projects, addTask } = useTaskStore();
  const { project: projectFilter } = useFilters();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (composing) inputRef.current?.focus();
  }, [composing]);

  // Opening the composer while a project view is filtered pre-selects that project.
  useEffect(() => {
    if (!composing) return;
    if (projectFilter && projects.some((p) => p.id === projectFilter)) {
      setDraftProject(projectFilter);
    } else if (!projects.some((p) => p.id === draftProject) && projects.length > 0) {
      setDraftProject(projects[0].id);
    }
    // Only re-run when the composer opens — not on every keystroke of draftProject/projects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composing]);

  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key === 'Escape' && composing) closeComposer();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [composing, closeComposer]);

  if (!composing) return null;

  if (projects.length === 0) {
    return (
      <div className={s.scrim} onClick={closeComposer}>
        <div className={s.dialog} onClick={(e) => e.stopPropagation()}>
          <div className={s.kicker}>New task</div>
          <p className={s.emptyProjectsNote}>
            Add a project from the sidebar first — every task needs one to live under.
          </p>
          <div className={s.footerRow}>
            <span className={s.hint}>esc to close</span>
            <button type="button" className={s.cancelBtn} onClick={closeComposer}>
              Close
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Falls back to the first project if the remembered draft project was renamed/removed.
  const projectValue = projects.some((p) => p.id === draftProject) ? draftProject : projects[0].id;

  function submit() {
    const title = draftTitle.trim();
    if (!title) return;
    addTask({
      title,
      project: projectValue,
      priority: draftPrio,
      dueDate: dateToIso(addDays(today(), draftDueOffset)),
    });
    resetDraftTitle();
    closeComposer();
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') submit();
  }

  return (
    <div className={s.scrim} onClick={closeComposer}>
      <div className={s.dialog} onClick={(e) => e.stopPropagation()}>
        <div className={s.kicker}>New task</div>
        <input
          ref={inputRef}
          className={s.titleInput}
          placeholder="What needs doing?"
          value={draftTitle}
          onChange={(e) => setDraftTitle(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <div className={s.controlRow}>
          <select
            className={s.projectSelect}
            value={projectValue}
            onChange={(e) => setDraftProject(e.target.value)}
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          {PRIO_OPTIONS.map((p) => (
            <button
              key={p.value}
              type="button"
              className={`${s.prioBtn} ${draftPrio === p.value ? s.selected : ''}`}
              onClick={() => setDraftPrio(p.value)}
            >
              {p.label}
            </button>
          ))}
          {DUE_OPTIONS.map((d) => (
            <button
              key={d.label}
              type="button"
              className={`${s.dueBtn} ${draftDueOffset === d.offset ? s.selected : ''}`}
              onClick={() => setDraftDueOffset(d.offset)}
            >
              {d.label}
            </button>
          ))}
        </div>
        <div className={s.footerRow}>
          <span className={s.hint}>enter to save · esc to close</span>
          <button type="button" className={s.cancelBtn} onClick={closeComposer}>
            Cancel
          </button>
          <button type="button" className={s.addBtn} onClick={submit}>
            Add task
          </button>
        </div>
      </div>
    </div>
  );
}
