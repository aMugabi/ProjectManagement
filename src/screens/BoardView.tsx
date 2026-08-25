import { DndContext, useDraggable, useDroppable, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core';
import type { Status, Task } from '../types';
import { useTaskStore } from '../store/taskStore';
import { useUiStore } from '../store/uiStore';
import { useFilters } from '../lib/useFilters';
import { visibleTasks, sortByDue, projectById, subtaskProgress } from '../lib/selectors';
import { PriorityPill } from '../components/shared/PriorityPill';
import { DuePill } from '../components/shared/DuePill';
import { ProgressBar } from '../components/shared/ProgressBar';
import s from './BoardView.module.css';

const COLUMNS: { status: Status; label: string; dot: string }[] = [
  { status: 'todo', label: 'To do', dot: 'var(--todo-dot)' },
  { status: 'doing', label: 'In progress', dot: 'var(--accent)' },
  { status: 'blocked', label: 'Blocked', dot: 'var(--blocked)' },
  { status: 'done', label: 'Done', dot: 'var(--done)' },
];

function BoardCard({ task }: { task: Task }) {
  const { projects } = useTaskStore();
  const openDrawer = useUiStore((st) => st.openDrawer);
  const dragId = useUiStore((st) => st.dragId);
  const { attributes, listeners, setNodeRef, transform } = useDraggable({ id: task.id });
  const project = projectById(projects, task.project);
  const prog = subtaskProgress(task);
  const isDragging = dragId === task.id;

  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, zIndex: 10 }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={`${s.card} ${isDragging ? s.isDragging : ''}`}
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
        <div className={s.metaSpacer} />
        <DuePill dueDate={task.dueDate} status={task.status} />
      </div>
    </div>
  );
}

function BoardColumn({ status, label, dot, tasks, isDropTarget }: {
  status: Status;
  label: string;
  dot: string;
  tasks: Task[];
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
      <div className={s.cards}>
        {tasks.map((t) => (
          <BoardCard key={t.id} task={t} />
        ))}
      </div>
    </div>
  );
}

export function BoardView() {
  const { tasks, projects, setStatus } = useTaskStore();
  const ui = useUiStore();
  const f = useFilters();

  const filtered = visibleTasks(tasks, projects, f);

  function handleDragStart(e: DragStartEvent) {
    ui.setDragId(String(e.active.id));
  }
  function handleDragEnd(e: DragEndEvent) {
    if (e.over) setStatus(String(e.active.id), e.over.id as Status);
    ui.setDragId(null);
  }

  return (
    <DndContext onDragStart={handleDragStart} onDragEnd={handleDragEnd} onDragCancel={() => ui.setDragId(null)}>
      <div className={s.board}>
        {COLUMNS.map((col) => (
          <BoardColumn
            key={col.status}
            status={col.status}
            label={col.label}
            dot={col.dot}
            tasks={sortByDue(filtered.filter((t) => t.status === col.status))}
            isDropTarget={ui.dragId !== null}
          />
        ))}
      </div>
    </DndContext>
  );
}
