import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Priority, Project, Recurring, ReminderSettings, Status, Task, Workspace, WorkspaceSnapshot } from '../types';
import { buildSeedTasks, PROJECTS } from '../data/seed';
import { advanceRecurrence } from '../shared/date';
import { DEFAULT_REMINDERS, DEFAULT_WORKSPACE, normalizeState, ownEntry, STATE_VERSION, stripDeps, type SyncedState } from '../shared/state';
import { CLOUD_ENABLED } from '../lib/cloud';
import { createCloudStorage, onRemoteState } from '../lib/cloudStorage';
import { wouldCreateCycle } from '../lib/selectors';

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

/**
 * Applies `change` to one task and stamps it, so sync keeps this edit over older copies on
 * other devices. Every task mutation goes through here (or stamps updatedAt itself).
 */
function updateTask(tasks: Task[], id: string, change: (t: Task) => Task): Task[] {
  return tasks.map((t) => (t.id === id ? { ...change(t), updatedAt: Date.now() } : t));
}

interface TaskStore extends SyncedState {
  addWorkspace: (name: string) => void;
  renameWorkspace: (id: string, name: string) => void;
  setActiveWorkspace: (id: string) => void;
  addProject: (name: string) => void;
  renameProject: (id: string, name: string) => void;
  deleteProject: (id: string) => void;
  toggleDone: (id: string) => void;
  setStatus: (id: string, status: Status) => void;
  setPriority: (id: string, priority: Priority) => void;
  setProject: (id: string, project: string) => void;
  setDueDate: (id: string, dueDate: string) => void;
  setRecurring: (id: string, recurring: Recurring) => void;
  setRemindDaysBefore: (id: string, days: number | null | undefined) => void;
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
  updateReminders: (patch: Partial<Omit<ReminderSettings, 'updatedAt'>>) => void;
}

export const useTaskStore = create<TaskStore>()(
  persist(
    (set) => ({
      tasks: buildSeedTasks(),
      projects: PROJECTS,
      workspaces: [DEFAULT_WORKSPACE],
      activeWorkspaceId: DEFAULT_WORKSPACE.id,
      workspaceData: {},
      deleted: {},
      reminders: DEFAULT_REMINDERS,

      addWorkspace: (name) =>
        set((s) => {
          const trimmed = name.trim();
          if (!trimmed) return s;
          const id = uniqueId(
            trimmed,
            s.workspaces.map((w) => w.id),
          );
          const workspace: Workspace = { id, name: trimmed, updatedAt: Date.now() };
          return {
            workspaces: [...s.workspaces, workspace],
            workspaceData: { ...s.workspaceData, [id]: { projects: [], tasks: [] } },
          };
        }),

      renameWorkspace: (id, name) =>
        set((s) => {
          const trimmed = name.trim();
          if (!trimmed) return s;
          return {
            workspaces: s.workspaces.map((w) => (w.id === id ? { ...w, name: trimmed, updatedAt: Date.now() } : w)),
          };
        }),

      // Swaps the top-level tasks/projects for another workspace's data, stashing the outgoing
      // workspace's data in workspaceData so it's the only place a non-active workspace lives.
      setActiveWorkspace: (id) =>
        set((s) => {
          if (id === s.activeWorkspaceId || !s.workspaces.some((w) => w.id === id)) return s;
          const incoming: WorkspaceSnapshot = ownEntry(s.workspaceData, id) ?? { projects: [], tasks: [] };
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
            updatedAt: Date.now(),
          };
          return { projects: [...s.projects, project] };
        }),

      renameProject: (id, name) =>
        set((s) => {
          const trimmed = name.trim();
          if (!trimmed) return s;
          return {
            projects: s.projects.map((p) => (p.id === id ? { ...p, name: trimmed, updatedAt: Date.now() } : p)),
          };
        }),

      // Deleting a project also deletes its tasks, and strips them from any
      // remaining task's dependencies so nothing is left blocked on a ghost.
      // Tombstones stop another device's copy from bringing them back on sync.
      deleteProject: (id) =>
        set((s) => {
          const now = Date.now();
          const ws = s.activeWorkspaceId;
          const deletedIds = new Set(s.tasks.filter((t) => t.project === id).map((t) => t.id));
          const deleted = { ...s.deleted, [`project:${ws}:${id}`]: now };
          for (const taskId of deletedIds) deleted[`task:${ws}:${taskId}`] = now;
          return {
            projects: s.projects.filter((p) => p.id !== id),
            tasks: stripDeps(
              s.tasks.filter((t) => t.project !== id),
              deletedIds,
            ),
            deleted,
          };
        }),

      toggleDone: (id) =>
        set((s) => ({
          tasks: updateTask(s.tasks, id, (t) => (t.status === 'done' ? { ...t, status: 'todo' } : completeTask(t))),
        })),

      setStatus: (id, status) =>
        set((s) => ({
          tasks: updateTask(s.tasks, id, (t) => (status === 'done' ? completeTask(t) : { ...t, status })),
        })),

      setPriority: (id, priority) => set((s) => ({ tasks: updateTask(s.tasks, id, (t) => ({ ...t, priority })) })),

      setProject: (id, project) => set((s) => ({ tasks: updateTask(s.tasks, id, (t) => ({ ...t, project })) })),

      setDueDate: (id, dueDate) => set((s) => ({ tasks: updateTask(s.tasks, id, (t) => ({ ...t, dueDate })) })),

      setRecurring: (id, recurring) => set((s) => ({ tasks: updateTask(s.tasks, id, (t) => ({ ...t, recurring })) })),

      setRemindDaysBefore: (id, days) =>
        set((s) => ({ tasks: updateTask(s.tasks, id, (t) => ({ ...t, remindDaysBefore: days })) })),

      setTitle: (id, title) => set((s) => ({ tasks: updateTask(s.tasks, id, (t) => ({ ...t, title })) })),

      setNotes: (id, notes) => set((s) => ({ tasks: updateTask(s.tasks, id, (t) => ({ ...t, notes })) })),

      addSubtask: (id, text) =>
        set((s) => ({ tasks: updateTask(s.tasks, id, (t) => ({ ...t, subs: [...t.subs, { text, done: false }] })) })),

      toggleSubtask: (id, index) =>
        set((s) => ({
          tasks: updateTask(s.tasks, id, (t) => ({
            ...t,
            subs: t.subs.map((sub, i) => (i === index ? { ...sub, done: !sub.done } : sub)),
          })),
        })),

      // Like deleteProject, strip the task from other tasks' deps so they aren't blocked on it forever.
      deleteTask: (id) =>
        set((s) => ({
          tasks: stripDeps(
            s.tasks.filter((t) => t.id !== id),
            new Set([id]),
          ),
          deleted: { ...s.deleted, [`task:${s.activeWorkspaceId}:${id}`]: Date.now() },
        })),

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
              updatedAt: Date.now(),
            },
            ...s.tasks,
          ],
        })),

      // Refuses dependencies that would close a loop — every task in a loop would stay blocked forever.
      addDependency: (id, dependsOnId) =>
        set((s) => {
          const task = s.tasks.find((t) => t.id === id);
          if (!task || task.deps.includes(dependsOnId) || wouldCreateCycle(s.tasks, id, dependsOnId)) return s;
          return { tasks: updateTask(s.tasks, id, (t) => ({ ...t, deps: [...t.deps, dependsOnId] })) };
        }),

      removeDependency: (id, dependsOnId) =>
        set((s) => ({ tasks: updateTask(s.tasks, id, (t) => ({ ...t, deps: t.deps.filter((d) => d !== dependsOnId) })) })),

      moveTask: (id, destStatus, destColumnOrderedIds) =>
        set((s) => {
          const now = Date.now();
          const orderById = new Map(destColumnOrderedIds.map((tid, i) => [tid, i]));
          return {
            tasks: s.tasks.map((t) => {
              if (t.id === id) return { ...t, status: destStatus, order: orderById.get(id) ?? t.order, updatedAt: now };
              if (!orderById.has(t.id) || orderById.get(t.id) === t.order) return t;
              return { ...t, order: orderById.get(t.id)!, updatedAt: now };
            }),
          };
        }),

      updateReminders: (patch) => set((s) => ({ reminders: { ...s.reminders, ...patch, updatedAt: Date.now() } })),
    }),
    {
      name: 'ledger-tasks-v2',
      version: STATE_VERSION,
      storage: createCloudStorage(),
      // Older versions get stamps of 0 (older than any real edit), tombstones and default reminder settings.
      migrate: (persisted) => normalizeState(persisted) as unknown as TaskStore,
    },
  ),
);

// Apply other devices' changes the server merged in after an upload.
onRemoteState((state) => useTaskStore.setState(state));

// Pull and merge the cloud copy again whenever the app comes back into view or back online, so
// edits from other devices appear without a reload and any unsynced local edits get uploaded.
if (CLOUD_ENABLED && typeof window !== 'undefined') {
  const refresh = () => {
    if (document.visibilityState === 'visible') void useTaskStore.persist.rehydrate();
  };
  window.addEventListener('online', refresh);
  document.addEventListener('visibilitychange', refresh);
}
