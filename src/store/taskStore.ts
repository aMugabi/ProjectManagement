import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Priority, Project, Status, Task } from '../types';
import { buildSeedTasks, PROJECTS } from '../data/seed';
import { advanceRecurrence } from '../lib/date';

const PROJECT_COLORS = [
  '#b4674a',
  '#6d7f5b',
  '#7b6a94',
  '#4f7a86',
  '#a08a4b',
  '#8a5a44',
  '#5b7f95',
  '#946a7b',
  '#6b7a4f',
  '#4b6b94',
];

function slugifyProjectName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'project';
}

function uniqueProjectId(name: string, existing: Project[]): string {
  const base = slugifyProjectName(name);
  const ids = new Set(existing.map((p) => p.id));
  if (!ids.has(base)) return base;
  let i = 2;
  while (ids.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

function nextProjectColor(existing: Project[]): string {
  const used = new Set(existing.map((p) => p.color));
  return PROJECT_COLORS.find((c) => !used.has(c)) ?? PROJECT_COLORS[existing.length % PROJECT_COLORS.length];
}

/** Completing a recurring task rolls it to its next occurrence instead of resting at 'done'. */
function completeTask(task: Task): Task {
  if (task.recurring) {
    return {
      ...task,
      status: 'todo',
      dueDate: advanceRecurrence(task.dueDate, task.recurring),
      subs: task.subs.map((sub) => ({ ...sub, done: false })),
    };
  }
  return { ...task, status: 'done' };
}

interface TaskStore {
  tasks: Task[];
  projects: Project[];
  addProject: (name: string) => void;
  renameProject: (id: string, name: string) => void;
  toggleDone: (id: string) => void;
  setStatus: (id: string, status: Status) => void;
  setPriority: (id: string, priority: Priority) => void;
  setProject: (id: string, project: string) => void;
  setTitle: (id: string, title: string) => void;
  setNotes: (id: string, notes: string) => void;
  addSubtask: (id: string, text: string) => void;
  toggleSubtask: (id: string, index: number) => void;
  deleteTask: (id: string) => void;
  addTask: (input: { title: string; project: string; priority: Priority; dueDate: string }) => void;
  addDependency: (id: string, dependsOnId: string) => void;
  removeDependency: (id: string, dependsOnId: string) => void;
  /** Move a task into a board column at a specific position, renumbering that column's order. */
  moveTask: (id: string, destStatus: Status, destColumnOrderedIds: string[]) => void;
}

export const useTaskStore = create<TaskStore>()(
  persist(
    (set) => ({
      tasks: buildSeedTasks(),
      projects: PROJECTS,

      addProject: (name) =>
        set((s) => {
          const trimmed = name.trim();
          if (!trimmed) return s;
          const project: Project = {
            id: uniqueProjectId(trimmed, s.projects),
            name: trimmed,
            color: nextProjectColor(s.projects),
          };
          return { projects: [...s.projects, project] };
        }),

      renameProject: (id, name) =>
        set((s) => {
          const trimmed = name.trim();
          if (!trimmed) return s;
          return { projects: s.projects.map((p) => (p.id === id ? { ...p, name: trimmed } : p)) };
        }),

      toggleDone: (id) =>
        set((s) => ({
          tasks: s.tasks.map((t) => {
            if (t.id !== id) return t;
            return t.status === 'done' ? { ...t, status: 'todo' } : completeTask(t);
          }),
        })),

      setStatus: (id, status) =>
        set((s) => ({
          tasks: s.tasks.map((t) => {
            if (t.id !== id) return t;
            return status === 'done' ? completeTask(t) : { ...t, status };
          }),
        })),

      setPriority: (id, priority) =>
        set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? { ...t, priority } : t)) })),

      setProject: (id, project) =>
        set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? { ...t, project } : t)) })),

      setTitle: (id, title) =>
        set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? { ...t, title } : t)) })),

      setNotes: (id, notes) =>
        set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? { ...t, notes } : t)) })),

      addSubtask: (id, text) =>
        set((s) => ({
          tasks: s.tasks.map((t) =>
            t.id === id ? { ...t, subs: [...t.subs, { text, done: false }] } : t,
          ),
        })),

      toggleSubtask: (id, index) =>
        set((s) => ({
          tasks: s.tasks.map((t) =>
            t.id === id
              ? {
                  ...t,
                  subs: t.subs.map((sub, i) => (i === index ? { ...sub, done: !sub.done } : sub)),
                }
              : t,
          ),
        })),

      deleteTask: (id) => set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) })),

      addTask: ({ title, project, priority, dueDate }) =>
        set((s) => ({
          tasks: [
            {
              id: `t${Date.now()}`,
              project,
              title,
              status: 'todo',
              priority,
              dueDate,
              subs: [],
              recurring: null,
              deps: [],
              notes: '',
              order: Math.min(0, ...s.tasks.map((t) => t.order)) - 1,
            },
            ...s.tasks,
          ],
        })),

      addDependency: (id, dependsOnId) =>
        set((s) => ({
          tasks: s.tasks.map((t) =>
            t.id === id && t.id !== dependsOnId && !t.deps.includes(dependsOnId)
              ? { ...t, deps: [...t.deps, dependsOnId] }
              : t,
          ),
        })),

      removeDependency: (id, dependsOnId) =>
        set((s) => ({
          tasks: s.tasks.map((t) =>
            t.id === id ? { ...t, deps: t.deps.filter((d) => d !== dependsOnId) } : t,
          ),
        })),

      moveTask: (id, destStatus, destColumnOrderedIds) =>
        set((s) => {
          const orderById = new Map(destColumnOrderedIds.map((tid, i) => [tid, i]));
          return {
            tasks: s.tasks.map((t) => {
              if (t.id === id) return { ...t, status: destStatus, order: orderById.get(id) ?? t.order };
              return orderById.has(t.id) ? { ...t, order: orderById.get(t.id)! } : t;
            }),
          };
        }),
    }),
    { name: 'ledger-tasks-v2' },
  ),
);
