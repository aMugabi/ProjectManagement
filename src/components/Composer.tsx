import { useEffect, useRef, type KeyboardEvent } from 'react';
import type { ItemType, Priority } from '../types';
import { ITEM_TYPES, TYPE_IDS } from '../shared/itemTypes';
import { parseHome } from '../lib/items';
import { HomePicker } from './shared/HomePicker';
import { useTaskStore } from '../store/taskStore';
import { useUiStore } from '../store/uiStore';
import { useFilters } from '../lib/useFilters';
import { addDays, dateToIso, today } from '../shared/date';
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
  const draftHome = useUiStore((st) => st.draftProject);
  const setDraftHome = useUiStore((st) => st.setDraftProject);
  const draftType = useUiStore((st) => st.draftType);
  const setDraftType = useUiStore((st) => st.setDraftType);
  const draftPrio = useUiStore((st) => st.draftPrio);
  const setDraftPrio = useUiStore((st) => st.setDraftPrio);
  const draftDueOffset = useUiStore((st) => st.draftDueOffset);
  const setDraftDueOffset = useUiStore((st) => st.setDraftDueOffset);
  const { projects, products, partners, addTask } = useTaskStore();
  const f = useFilters();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (composing) inputRef.current?.focus();
  }, [composing]);

  // Opening the composer while a project, product or partner view is filtered pre-selects it;
  // otherwise a remembered place that no longer exists falls back to the first project.
  useEffect(() => {
    if (!composing) return;
    const exists = (value: string) => {
      const h = parseHome(value);
      if (h.project) return projects.some((p) => p.id === h.project);
      return (!h.product || products.some((p) => p.id === h.product)) && (!h.partner || partners.some((p) => p.id === h.partner));
    };
    const filtered = f.project ? `project:${f.project}` : f.product ? `product:${f.product}` : f.partner ? `partner:${f.partner}` : null;
    if (filtered && exists(filtered)) setDraftHome(filtered);
    else if (!draftHome || !exists(draftHome)) setDraftHome(projects[0] ? `project:${projects[0].id}` : '');
    // Only re-run when the composer opens — not on every keystroke of the draft or the lists.
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

  const typeLabel = ITEM_TYPES[draftType].label.toLowerCase();

  function submit() {
    const title = draftTitle.trim();
    if (!title) return;
    addTask({
      title,
      home: draftHome,
      type: draftType,
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
        <div className={s.kicker}>New {typeLabel}</div>
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
            value={draftType}
            onChange={(e) => setDraftType(e.target.value as ItemType)}
            aria-label="Type"
          >
            {TYPE_IDS.map((t) => (
              <option key={t} value={t}>
                {ITEM_TYPES[t].label}
              </option>
            ))}
          </select>
          <HomePicker className={s.projectSelect} value={draftHome} onChange={setDraftHome} />
        </div>
        <div className={s.controlRow}>
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
            Add {typeLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
