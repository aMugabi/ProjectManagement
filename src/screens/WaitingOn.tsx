/**
 * Everything open that waits on someone (build plan Step 2), grouped by who, with the chase date.
 * The groups with a chase due come first. "Chased" sets the next chase three days on; "Got it"
 * stops waiting.
 */
import type { Task } from '../types';
import { useTaskStore } from '../store/taskStore';
import { useUiStore } from '../store/uiStore';
import { useFilters } from '../lib/useFilters';
import { homeOf, visibleTasks, withoutDone } from '../lib/selectors';
import { dateToIso, daysBetween, today } from '../shared/date';
import { addDaysIso, chaseDue, isWaiting } from '../shared/followUp';
import s from './WaitingOn.module.css';

/** Days to the next chase after chasing. */
export const CHASE_AGAIN_DAYS = 3;

function chaseLabel(t: Task, todayIso: string): { text: string; late: boolean } {
  if (!t.chaseOn || !/^\d{4}-\d{2}-\d{2}$/.test(t.chaseOn)) return { text: 'No chase date', late: false };
  const days = daysBetween(todayIso, t.chaseOn);
  if (days < 0) return { text: `Chase ${-days}d late`, late: true };
  if (days === 0) return { text: 'Chase today', late: true };
  if (days === 1) return { text: 'Chase tomorrow', late: false };
  return { text: `Chase in ${days}d`, late: false };
}

export function WaitingOn() {
  const store = useTaskStore();
  const { tasks, setChaseOn, setWaitingOn } = store;
  const openDrawer = useUiStore((st) => st.openDrawer);
  const f = useFilters();
  const todayIso = dateToIso(today());

  const waiting = withoutDone(visibleTasks(tasks, store, f)).filter(isWaiting);
  // One group per person, however they were typed ('telco it' and 'Telco IT ' are the same).
  const groups = new Map<string, { name: string; items: Task[] }>();
  for (const t of waiting) {
    const key = t.waitingOn!.trim().toLowerCase();
    const group = groups.get(key) ?? { name: t.waitingOn!.trim(), items: [] };
    group.items.push(t);
    groups.set(key, group);
  }
  const chaseOrder = (t: Task) => (t.chaseOn && /^\d{4}-\d{2}-\d{2}$/.test(t.chaseOn) ? t.chaseOn : '9999-12-31');
  const list = [...groups.values()]
    .map((g) => ({ ...g, items: g.items.sort((a, b) => chaseOrder(a).localeCompare(chaseOrder(b)) || a.title.localeCompare(b.title)) }))
    .sort((a, b) => {
      const due = (g: typeof a) => (g.items.some((t) => chaseDue(t, todayIso)) ? 0 : 1);
      return due(a) - due(b) || a.name.localeCompare(b.name);
    });

  if (list.length === 0) {
    return (
      <div className={s.card}>
        <p className={s.empty}>Nothing is waiting on anyone. Set "Waiting on" in an item's details to follow it up here.</p>
      </div>
    );
  }

  return (
    <div className={s.groups}>
      {list.map((g) => (
        <section key={g.name.toLowerCase()} className={s.card} aria-label={`Waiting on ${g.name}`}>
          <h2 className={s.heading}>
            {g.name}
            <span className={s.count}>{g.items.length}</span>
          </h2>
          {g.items.map((t) => {
            const home = homeOf(t, store);
            const chase = chaseLabel(t, todayIso);
            return (
              <div key={t.id} className={s.row}>
                <span className={s.dot} style={{ background: home.color }} />
                <button type="button" className={s.title} onClick={() => openDrawer(t.id)}>
                  {t.title}
                </button>
                <span className={s.home}>{home.name}</span>
                <span className={chase.late ? s.late : s.chase}>{chase.text}</span>
                <span className={s.actions}>
                  <button
                    type="button"
                    className={s.button}
                    aria-label={`Chased about "${t.title}"`}
                    title={`Chase again in ${CHASE_AGAIN_DAYS} days`}
                    onClick={() => setChaseOn(t.id, addDaysIso(todayIso, CHASE_AGAIN_DAYS))}
                  >
                    Chased
                  </button>
                  <button
                    type="button"
                    className={s.button}
                    aria-label={`Stop waiting on ${g.name} for "${t.title}"`}
                    title="No longer waiting"
                    onClick={() => setWaitingOn(t.id, '')}
                  >
                    Got it
                  </button>
                </span>
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}
