import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Status, Task } from '../types';
import { useTaskStore } from '../store/taskStore';
import { useUiStore } from '../store/uiStore';
import { useFilters } from '../lib/useFilters';
import { visibleTasks, sortByOrder, projectById, subtaskProgress, effectiveStatus, isDepBlocked, depTitles } from '../lib/selectors';
import { PriorityPill } from '../components/shared/PriorityPill';
import { DuePill } from '../components/shared/DuePill';
import { ProgressBar } from '../components/shared/ProgressBar';
import s from './BoardView.module.css';

const STATUSES: Status[] = ['todo', 'doing', 'blocked', 'done'];

const COLUMNS: { status: Status; label: string; dot: string }[] = [
  { status: 'todo', label: 'To do', dot: 'var(--todo-dot)' },
  { status: 'doing', label: 'In progress', dot: 'var(--accent)' },
  { status: 'blocked', label: 'Blocked', dot: 'var(--blocked)' },
  { status: 'done', label: 'Done', dot: 'var(--done)' },
];

function BoardCard({ task, allTasks }: { task: Task; allTasks: Task[] }) {
  const { projects } = useTaskStore();
  const openDrawer = useUiStore((st) => st.openDrawer);
  const blocked = isDepBlocked(task, allTasks);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    disabled: blocked,
  });
  const project = projectById(projects, task.project);
  const prog = subtaskProgress(task);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...(blocked ? {} : listeners)}
      {...attributes}
      className={`${s.card} ${isDragging ? s.isDragging : ''} ${blocked ? s.isBlocked : ''}`}
      onClick={() => openDrawer(task.id)}
    >
      <div className={s.topRow}>
        <span className={s.topDot} style={{ background: project.color }} />
        <div className={s.cardTitle}>{task.title}</div>
      </div>
      {prog.total > 0 && (
        <div className={s.subProgress}>
          <ProgressBar percent={(prog.done / prog.total) * 100} color={project.color} thin />
        </div>
      )}
      <div className={s.metaRow}>
        <PriorityPill priority={task.priority} status={task.status} />
        {task.recurring && <span className={s.recur}>↻ {task.recurring}</span>}
        {blocked && (
          <span className={s.blockedTag} title={`Waiting on ${depTitles(allTasks, task.deps)}`}>
            ⛔ blocked
          </span>
        )}
        <div className={s.metaSpacer} />
        <DuePill dueDate={task.dueDate} status={task.status} />
      </div>
    </div>
  );
}

function BoardColumn({ status, label, dot, tasks, allTasks, isDropTarget }: {
  status: Status;
  label: string;
  dot: string;
  tasks: Task[];
  allTasks: Task[];
  isDropTarget: boolean;
}) {
  const { setNodeRef } = useDroppable({ id: status });
  return (
    <div ref={setNodeRef} className={`${s.column} ${isDropTarget ? s.dragging : ''}`}>
      <div className={s.columnHeader}>
        <span className={s.columnDot} style={{ background: dot }} />
        <span className={s.columnLabel}>{label}</span>
        <span className={s.columnCount}>{tasks.length}</span>
      </div>
      <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        <div className={s.cards}>
          {tasks.map((t) => (
            <BoardCard key={t.id} task={t} allTasks={allTasks} />
          ))}
        </div>
      </SortableContext>
    </div>
  );
}

export function BoardView() {
  const { tasks, projects, moveTask } = useTaskStore();
  const ui = useUiStore();
  const f = useFilters();
  // A distance threshold keeps a plain click (which opens the drawer) from being read as a drag.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const filtered = visibleTasks(tasks, projects, f);
  const columnTasks = new Map(
    STATUSES.map((status) => [status, sortByOrder(filtered.filter((t) => effectiveStatus(t, tasks) === status))]),
  );

  function handleDragStart(e: DragStartEvent) {
    ui.setDragId(String(e.active.id));
  }

  function handleDragEnd(e: DragEndEvent) {
    ui.setDragId(null);
    const overId = e.over?.id;
    if (!overId) return;

    const activeId = String(e.active.id);
    if (activeId === overId) return; // dropped back where it started — nothing to do

    const activeTask = tasks.find((t) => t.id === activeId);
    if (!activeTask) return;

    const overIsColumn = (STATUSES as string[]).includes(String(overId));
    const overTask = overIsColumn ? null : tasks.find((t) => t.id === overId);
    const destStatus = overIsColumn ? (overId as Status) : overTask ? effectiveStatus(overTask, tasks) : null;

    // The Blocked column is derived from dependencies — it isn't a valid manual drop target.
    if (!destStatus || destStatus === 'blocked') return;

    // Full destination-column order, active task removed from its old slot (if it was already there).
    const destIds = (columnTasks.get(destStatus) ?? []).map((t) => t.id).filter((id) => id !== activeId);
    const insertIndex = overTask ? destIds.indexOf(overTask.id) : destIds.length;
    destIds.splice(insertIndex === -1 ? destIds.length : insertIndex, 0, activeId);
    moveTask(activeId, destStatus, destIds);
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => ui.setDragId(null)}
    >
      <div className={s.board}>
        {COLUMNS.map((col) => (
          <BoardColumn
            key={col.status}
            status={col.status}
            label={col.label}
            dot={col.dot}
            tasks={columnTasks.get(col.status) ?? []}
            allTasks={tasks}
            isDropTarget={ui.dragId !== null && col.status !== 'blocked'}
          />
        ))}
      </div>
    </DndContext>
  );
}
