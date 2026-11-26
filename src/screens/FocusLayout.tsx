import { useNavigate } from 'react-router-dom';
import type { Task } from '../types';
import { useTaskStore } from '../store/taskStore';
import { useUiStore } from '../store/uiStore';
import { useFilters } from '../lib/useFilters';
import { visibleTasks, withoutDone, sortByDue, homeOf, subtaskProgress, projectStats, depTitles, phaseOf, type GroupKind } from '../lib/selectors';
import { isDone } from '../shared/itemTypes';
import { dateToIso, offsetFromToday, today } from '../shared/date';
import { isSnoozed } from '../shared/followUp';
import { Checkbox } from '../components/shared/Checkbox';
import { PriorityPill } from '../components/shared/PriorityPill';
import { DuePill } from '../components/shared/DuePill';
import { ProgressBar } from '../components/shared/ProgressBar';
import s from './Dashboard.module.css';

export function FocusLayout() {
  const store = useTaskStore();
  const { tasks, projects, products, partners, toggleDone } = store;
  const openDrawer = useUiStore((st) => st.openDrawer);
  const navigate = useNavigate();
  const f = useFilters();

  // Snoozed items stay out of the dashboard until their date (the header counts them).
  const todayIso = dateToIso(today());
  const open = withoutDone(visibleTasks(tasks, store, f)).filter((t) => !isSnoozed(t, todayIso));
  const needsToday = sortByDue(open.filter((t) => offsetFromToday(t.dueDate) <= 0));
  const restOfWeek = sortByDue(
    open.filter((t) => {
      const d = offsetFromToday(t.dueDate);
      return d >= 1 && d <= 7;
    }),
  );
  const overdueCount = needsToday.filter((t) => offsetFromToday(t.dueDate) < 0).length;
  const blocked = tasks.filter((t) => phaseOf(t, tasks) === 'blocked');
  // Health for every project, product and partner (a product's and partner's include their pairs' items).
  const groups: [GroupKind, typeof projects][] = [['project', projects], ['product', products], ['partner', partners]];

  function goToProject(id: string, kind: GroupKind = 'project') {
    navigate(`/tasks?${kind}=${encodeURIComponent(id)}`);
  }

  return (
    <div className={s.columns}>
      <div className={s.colLeft}>
        <div className={`${s.card} ${s.cardWithList}`}>
          <h2 className={s.panelHeading}>
            Needs you today
            <span className={s.headingMeta}>
              {needsToday.length} items · {overdueCount} overdue
            </span>
          </h2>
          {needsToday.length === 0 && <div className={s.emptyNote}>Nothing due — all clear.</div>}
          {needsToday.map((t) => {
            const p = homeOf(t, store);
            const prog = subtaskProgress(t);
            return (
              <div key={t.id} className={s.row} onClick={() => openDrawer(t.id)}>
                <Checkbox done={isDone(t)} onToggle={() => toggleDone(t.id)} label={`Mark "${t.title}" done`} />
                <div className={s.textBlock}>
                  <div className={s.rowTitle}>{t.title}</div>
                  <div className={s.rowSubline}>
                    <span className={s.dot} style={{ background: p.color }} />
                    <span className={s.projectName}>{p.name}</span>
                    {prog.total > 0 && (
                      <span className={s.subCount}>
                        {prog.done}/{prog.total}
                      </span>
                    )}
                  </div>
                </div>
                <PriorityPill priority={t.priority} done={isDone(t)} />
                <DuePill dueDate={t.dueDate} done={isDone(t)} />
              </div>
            );
          })}
          <div className={s.listSpacer} />
        </div>

        <div className={`${s.card} ${s.cardWithList}`}>
          <h2 className={s.panelHeading}>Rest of the week</h2>
          {restOfWeek.length === 0 && <div className={s.emptyNote}>Nothing scheduled this week.</div>}
          {restOfWeek.map((t) => {
            const p = homeOf(t, store);
            return (
              <div key={t.id} className={s.denseRow} onClick={() => openDrawer(t.id)}>
                <Checkbox done={isDone(t)} onToggle={() => toggleDone(t.id)} label={`Mark "${t.title}" done`} />
                <div className={s.denseTitle}>{t.title}</div>
                <span className={s.denseProjectDot} style={{ background: p.color }} />
                <span className={s.denseProjectName}>{p.name}</span>
                <DuePill dueDate={t.dueDate} done={isDone(t)} />
              </div>
            );
          })}
          <div className={s.listSpacer} />
        </div>
      </div>

      <div className={s.colRight}>
        <div className={s.card}>
          <h2 className={s.panelHeading}>Project health</h2>
          <div style={{ marginTop: 15 }}>
            {groups.flatMap(([kind, list]) => list.map((p) => {
              const stat = projectStats(tasks, p, kind);
              const note = stat.total === 0 || stat.percent === 100
                ? 'all clear'
                : stat.overdueCount > 0
                  ? `${stat.overdueCount} overdue · next: ${stat.nextTask?.title.toLowerCase() ?? ''}`
                  : stat.nextTask
                    ? `next: ${stat.nextTask.title}`
                    : 'all clear';
              return (
                <div key={`${kind}:${p.id}`} className={s.projectGroup}>
                  <div className={`${s.projectRow}`} onClick={() => goToProject(p.id, kind)}>
                    <div className={s.projectHeaderLine}>
                      <span className={s.projectHeaderDot} style={{ background: p.color }} />
                      <span className={s.projectHeaderName}>{kind === 'project' ? p.name : `${p.name} · ${kind}`}</span>
                      <span className={s.projectPercent}>{stat.percent}%</span>
                    </div>
                    <ProgressBar percent={stat.percent} color={p.color} />
                    <div className={s.projectNote}>{note}</div>
                  </div>
                </div>
              );
            }))}
          </div>
        </div>

        <div className={s.card}>
          <h2 className={s.panelHeading}>Blocked</h2>
          <div style={{ marginTop: 10 }}>
            {blocked.length === 0 && <div className={s.emptyNote}>Nothing blocked.</div>}
            {blocked.map((t: Task) => (
              <div key={t.id} className={s.blockedEntry} onClick={() => openDrawer(t.id)}>
                <div className={s.blockedTitle}>{t.title}</div>
                <div className={s.blockedSub}>waiting on {depTitles(tasks, t.deps)}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
