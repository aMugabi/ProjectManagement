import { useTaskStore } from '../store/taskStore';
import { useUiStore } from '../store/uiStore';
import { useFilters } from '../lib/useFilters';
import { visibleTasks, withoutDone, sortByDue, homeOf, phaseOf } from '../lib/selectors';
import { isDone } from '../shared/itemTypes';
import { addDays, dueMeta, offsetFromToday, today } from '../shared/date';
import s from './Timeline.module.css';

const WINDOW_START = -3;
const WINDOW_SPAN = 16;

function barWeight(taskSubsCount: number, highPriority: boolean): number {
  if (taskSubsCount > 2) return 4;
  if (highPriority) return 3;
  return 2;
}

export function Timeline() {
  const store = useTaskStore();
  const { tasks } = store;
  const openDrawer = useUiStore((st) => st.openDrawer);
  const f = useFilters();

  const filtered = withoutDone(visibleTasks(tasks, store, f));
  const shown = sortByDue(filtered);

  const days = Array.from({ length: WINDOW_SPAN }, (_, i) => {
    const d = addDays(today(), WINDOW_START + i);
    const isToday = i === -WINDOW_START;
    const isWeekend = d.getDay() === 0 || d.getDay() === 6;
    return { date: d, isToday, isWeekend };
  });

  return (
    <div className={s.card}>
      <div className={s.headerRow}>
        <div className={s.headerGutter} />
        <div className={s.headerStrip}>
          {days.map((d, i) => (
            <div
              key={i}
              className={`${s.dayCell} ${d.isToday ? s.today : ''} ${d.isWeekend ? s.weekend : ''}`}
            >
              <div className={s.weekdayInitial}>{d.date.toLocaleDateString('en-US', { weekday: 'narrow' })}</div>
              <div className={s.dayNumber}>{d.date.getDate()}</div>
            </div>
          ))}
        </div>
      </div>

      {shown.length === 0 && <div className={s.emptyNote}>Nothing in the next two weeks.</div>}

      {shown.map((t) => {
        const project = homeOf(t, store);
        const meta = dueMeta(t.dueDate, isDone(t));
        const dueDayIndex = offsetFromToday(t.dueDate) - WINDOW_START;
        const length = barWeight(t.subs.length, t.priority === 'high');
        let startDay = dueDayIndex - (length - 1);
        let endDay = dueDayIndex;
        startDay = Math.max(0, Math.min(WINDOW_SPAN, startDay));
        endDay = Math.max(0, Math.min(WINDOW_SPAN, endDay + 1));
        let widthPct = ((endDay - startDay) / WINDOW_SPAN) * 100;
        if (widthPct < 4) widthPct = 4;
        const leftPct = (startDay / WINDOW_SPAN) * 100;

        const blocked = phaseOf(t, tasks) === 'blocked';
        // A colour with transparency added; an item with no project has a theme colour instead.
        const tint = (alpha: string, fallback: string) => (project.color.startsWith('#') ? `${project.color}${alpha}` : fallback);
        const background = blocked ? 'var(--blocked-bg)' : tint('22', 'var(--surface-raised)');
        const border = blocked ? '1px solid var(--blocked-border)' : `1px solid ${tint('55', 'var(--border-strong)')}`;

        return (
          <div key={t.id} className={s.row}>
            <div className={s.gutter} onClick={() => openDrawer(t.id)}>
              <span className={s.gutterDot} style={{ background: project.color }} />
              <span className={s.gutterTitle}>{t.title}</span>
            </div>
            <div className={s.track}>
              <div className={s.grid} />
              <div
                className={s.bar}
                style={{ left: `${leftPct}%`, width: `${widthPct}%`, background, border }}
                onClick={() => openDrawer(t.id)}
              >
                {meta.label}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
