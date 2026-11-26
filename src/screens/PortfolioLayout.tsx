import { useNavigate } from 'react-router-dom';
import { useTaskStore } from '../store/taskStore';
import { useUiStore } from '../store/uiStore';
import { useFilters } from '../lib/useFilters';
import { visibleTasks, withoutDone, sortByDue, projectStats, phaseOf, type GroupKind } from '../lib/selectors';
import { isDone } from '../shared/itemTypes';
import { offsetFromToday } from '../shared/date';
import { Checkbox } from '../components/shared/Checkbox';
import { DuePill } from '../components/shared/DuePill';
import { ProgressBar } from '../components/shared/ProgressBar';
import s from './Dashboard.module.css';

export function PortfolioLayout() {
  const store = useTaskStore();
  const { tasks, projects, products, partners, toggleDone } = store;
  const openDrawer = useUiStore((st) => st.openDrawer);
  const navigate = useNavigate();
  const f = useFilters();

  const open = withoutDone(visibleTasks(tasks, store, f));
  const dueThisWeek = open.filter((t) => offsetFromToday(t.dueDate) <= 7);
  const overdue = open.filter((t) => offsetFromToday(t.dueDate) < 0);
  const blocked = tasks.filter((t) => phaseOf(t, tasks) === 'blocked');
  // A card for every project, product and partner (a product's and partner's include their pairs' items).
  const groups: [GroupKind, typeof projects][] = [['project', projects], ['product', products], ['partner', partners]];
  const oldestOverdueDays = overdue.length
    ? Math.max(...overdue.map((t) => Math.abs(offsetFromToday(t.dueDate))))
    : 0;

  const tiles = [
    { label: 'Open tasks', value: open.length, note: `across ${projects.length} projects` },
    { label: 'Due this week', value: dueThisWeek.length, note: 'incl. today' },
    {
      label: 'Overdue',
      value: overdue.length,
      note: overdue.length ? `oldest ${oldestOverdueDays} days` : 'nothing slipping',
    },
    { label: 'Blocked', value: blocked.length, note: 'waiting on other work' },
  ];

  function goToProject(id: string, kind: GroupKind) {
    navigate(`/tasks?${kind}=${encodeURIComponent(id)}`);
  }

  return (
    <div style={{ maxWidth: 1360 }}>
      <div className={s.statGrid}>
        {tiles.map((t) => (
          <div key={t.label} className={`${s.card} ${s.statTile}`}>
            <div className={s.statLabel}>{t.label}</div>
            <div className={s.statValue}>{t.value}</div>
            <div className={s.statNote}>{t.note}</div>
          </div>
        ))}
      </div>

      <div className={s.projectCards}>
        {groups.flatMap(([kind, list]) => list.map((p) => {
          const stat = projectStats(tasks, p, kind);
          const soonest = sortByDue(
            open.filter((t) => t[kind] === p.id),
          ).slice(0, 3);
          const note =
            stat.total === 0 || stat.percent === 100
              ? 'all clear'
              : stat.overdueCount > 0
                ? `${stat.overdueCount} overdue · next: ${stat.nextTask?.title.toLowerCase() ?? ''}`
                : stat.nextTask
                  ? `next: ${stat.nextTask.title}`
                  : 'all clear';
          return (
            <div key={`${kind}:${p.id}`} className={`${s.card} ${s.projectCard}`}>
              <div className={s.projectCardHeader} onClick={() => goToProject(p.id, kind)}>
                <span className={s.projectCardDot} style={{ background: p.color }} />
                <span className={s.projectCardName}>{kind === 'project' ? p.name : `${p.name} · ${kind}`}</span>
                <span className={s.projectCardPercent}>{stat.percent}%</span>
              </div>
              <div className={s.projectCardProgress}>
                <ProgressBar percent={stat.percent} color={p.color} />
              </div>
              <div className={s.miniTasks}>
                {soonest.map((t) => (
                  <div key={t.id} className={s.miniRow} onClick={() => openDrawer(t.id)}>
                    <Checkbox done={isDone(t)} onToggle={() => toggleDone(t.id)} label={`Mark "${t.title}" done`} />
                    <span className={s.miniTitle}>{t.title}</span>
                    <DuePill dueDate={t.dueDate} done={isDone(t)} />
                  </div>
                ))}
              </div>
              <div className={s.projectCardFooter}>{note}</div>
            </div>
          );
        }))}
      </div>
    </div>
  );
}
