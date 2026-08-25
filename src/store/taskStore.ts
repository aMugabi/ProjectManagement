import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Priority, Project, Recurring, Status, Task, Workspace } from '../types';
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

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'item';
}

function uniqueId(name: string, existingIds: Iterable<string>): string {
  const ids = new Set(existingIds);
  const base = slugify(name);
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

/** Data for a workspace that isn't currently active — the active workspace's data lives in the top-level tasks/projects fields. */
interface WorkspaceSnapshot {
  projects: Project[];
  tasks: Task[];
}

interface TaskStore {
  tasks: Task[];
  projects: Project[];
  workspaces: Workspace[];
  activeWorkspaceId: string;
  workspaceData: Record<string, WorkspaceSnapshot>;
  addWorkspace: (name: string) => void;
  renameWorkspace: (id: string, name: string) => void;
  setActiveWorkspace: (id: string) => void;
  addProject: (name: string) => void;
  renameProject: (id: string, name: string) => void;
  toggleDone: (id: string) => void;
  setStatus: (id: string, status: Status) => void;
  setPriority: (id: string, priority: Priority) => void;
  setProject: (id: string, project: string) => void;
  setDueDate: (id: string, dueDate: string) => void;
  setRecurring: (id: string, recurring: Recurring) => void;
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
      workspaces: [{ id: 'default', name: 'My Workspace' }],
      activeWorkspaceId: 'default',
      workspaceData: {},

      addWorkspace: (name) =>
        set((s) => {
          const trimmed = name.trim();
          if (!trimmed) return s;
          const id = uniqueId(
            trimmed,
            s.workspaces.map((w) => w.id),
          );
          return {
            workspaces: [...s.workspaces, { id, name: trimmed }],
            workspaceData: { ...s.workspaceData, [id]: { projects: [], tasks: [] } },
          };
        }),

      renameWorkspace: (id, name) =>
        set((s) => {
          const trimmed = name.trim();
          if (!trimmed) return s;
          return { workspaces: s.workspaces.map((w) => (w.id === id ? { ...w, name: trimmed } : w)) };
        }),

      // Swaps the top-level tasks/projects for another workspace's data, stashing the outgoing
      // workspace's data in workspaceData so it's the only place a non-active workspace lives.
      setActiveWorkspace: (id) =>
        set((s) => {
          if (id === s.activeWorkspaceId || !s.workspaces.some((w) => w.id === id)) return s;
          const incoming = s.workspaceData[id] ?? { projects: [], tasks: [] };
          const workspaceData = { ...s.workspaceData };
          delete workspaceData[id];
          workspaceData[s.activeWorkspaceId] = { projects: s.projects, tasks: s.tasks };
          return {
            activeWorkspaceId: id,
            projects: incoming.projects,
            tasks: incoming.tasks,
            workspaceData,
          };
        }),

      addProject: (name) =>
        set((s) => {
          const trimmed = name.trim();
          if (!trimmed) return s;
          const project: Project = {
            id: uniqueId(
              trimmed,
              s.projects.map((p) => p.id),
            ),
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

      setDueDate: (id, dueDate) =>
        set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? { ...t, dueDate } : t)) })),

      setRecurring: (id, recurring) =>
        set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? { ...t, recurring } : t)) })),

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
