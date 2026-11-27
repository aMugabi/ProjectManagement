import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ItemType, Priority, Project, Recurring, ReminderSettings, Status, Task, Workspace, WorkspaceSnapshot } from '../types';
import { buildSeedTasks, PROJECTS } from '../data/seed';
import { advanceRecurrence, dateToIso, today } from '../shared/date';
import { activeSnapshot, DEFAULT_REMINDERS, DEFAULT_WORKSPACE, emptySnapshot, normalizeState, ownEntry, STATE_VERSION, stripDeps, type SyncedState } from '../shared/state';
import { CLOUD_ENABLED } from '../lib/cloud';
import { createCloudStorage, onRemoteState } from '../lib/cloudStorage';
import { STORE_KEY } from '../lib/deviceData';
import { wouldCreateCycle } from '../lib/selectors';
import { newItemId, parseHome, sortProjects, uniqueId, withCompletion, withDate, withDetail, withOccurrenceDone, withWaiting, withHome, withoutGroup, withType, type HomeValue, type ProjectTarget } from '../lib/items';
import { completeStatus, firstStatus, isDone, statusForPhase, typeOf, type Phase } from '../shared/itemTypes';
import * as rel from '../lib/releases';

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

function nextProjectColor(existing: Project[]): string {
  const used = new Set(existing.map((p) => p.color));
  return PROJECT_COLORS.find((c) => !used.has(c)) ?? PROJECT_COLORS[existing.length % PROJECT_COLORS.length];
}

/**
 * Finishing an item sets its type's complete status (a task done, a risk closed, an issue
 * resolved...), or `status` when given (e.g. a decision superseded). A recurring item rolls to its
 * next occurrence instead, back at its type's first status.
 */
function completeTask(task: Task, status: Status = completeStatus(task)): Task {
  if (task.recurring) {
    // The occurrence is remembered (for reports) before the item rolls over to the next one.
    return {
      ...withOccurrenceDone(task, dateToIso(today())),
      status: firstStatus(typeOf(task)),
      dueDate: advanceRecurrence(task.dueDate, task.recurring),
      subs: task.subs.map((sub) => ({ ...sub, done: false })),
    };
  }
  return { ...task, status };
}

/** Which list a project, product or partner lives in. */
const GROUP_LIST = { project: 'projects', product: 'products', partner: 'partners' } as const;
export type GroupKind = keyof typeof GROUP_LIST;

/**
 * Applies `change` to one task and stamps it, so sync keeps this edit over older copies on
 * other devices. Every task mutation goes through here (or stamps updatedAt itself).
 */
function updateTask(tasks: Task[], id: string, change: (t: Task) => Task): Task[] {
  return tasks.map((t) => (t.id === id ? { ...withCompletion(t, change(t), dateToIso(today())), updatedAt: Date.now() } : t));
}

interface TaskStore extends SyncedState {
  addWorkspace: (name: string) => void;
  renameWorkspace: (id: string, name: string) => void;
  setActiveWorkspace: (id: string) => void;
  addProject: (name: string) => void;
  renameProject: (id: string, name: string) => void;
  deleteProject: (id: string) => void;
  /** Adds a project, product or partner (returns its id, or '' for an empty name). */
  addGroup: (kind: GroupKind, name: string) => string;
  renameGroup: (kind: GroupKind, id: string, name: string) => void;
  /** A project goes with its tasks; a product or partner goes with its pairs, and its items stay. */
  deleteGroup: (kind: GroupKind, id: string) => void;
  /** Step 3: a release of a product with a partner (their pair and the stage template made if needed); returns its id. */
  addRelease: (input: { product: string; partner: string; name: string; targetDate?: string }) => string;
  updateRelease: (id: string, patch: { name?: string; targetDate?: string }) => void;
  /** False, and nothing changes, if the release has sign-offs. */
  deleteRelease: (id: string) => boolean;
  addStage: (name: string) => void;
  renameStage: (id: string, name: string) => void;
  moveStage: (id: string, direction: -1 | 1) => void;
  /** False, and nothing changes, if a sign-off names the stage. */
  deleteStage: (id: string) => boolean;
  /** Records a sign-off (or a correction); returns why it couldn't, or null. */
  signOff: (input: rel.SignOffInput) => string | null;
  /** Turns projects of the active workspace into products, partners or pairs (the sorting tool). */
  sortProjects: (choices: Record<string, ProjectTarget>) => void;
  /** Moves an item to a plain project, a product, a partner, a pair (made if new) or nothing. */
  setHome: (id: string, home: HomeValue) => void;
  setType: (id: string, type: ItemType) => void;
  setDetail: (id: string, key: string, value: string) => void;
  toggleDone: (id: string) => void;
  setStatus: (id: string, status: Status) => void;
  setPriority: (id: string, priority: Priority) => void;
  setProject: (id: string, project: string) => void;
  setDueDate: (id: string, dueDate: string) => void;
  setRecurring: (id: string, recurring: Recurring) => void;
  setRemindDaysBefore: (id: string, days: number | null | undefined) => void;
  /** Who the item waits on ('' = nobody, which also clears the chase date). */
  setWaitingOn: (id: string, waitingOn: string) => void;
  /** When to chase them: an ISO date, or '' for none. */
  setChaseOn: (id: string, date: string) => void;
  /** Keeps the item out of reminders and the dashboard until an ISO date; '' wakes it. */
  snooze: (id: string, until: string) => void;
  setTitle: (id: string, title: string) => void;
  setNotes: (id: string, notes: string) => void;
  addSubtask: (id: string, text: string) => void;
  toggleSubtask: (id: string, index: number) => void;
  deleteTask: (id: string) => void;
  addTask: (input: { title: string; project?: string; home?: HomeValue; type?: ItemType; priority: Priority; dueDate: string }) => void;
  addDependency: (id: string, dependsOnId: string) => void;
  removeDependency: (id: string, dependsOnId: string) => void;
  /** Move an item into a board column (a phase) at a specific position, renumbering that column's order. */
  moveTask: (id: string, destPhase: Exclude<Phase, 'blocked'>, destColumnOrderedIds: string[]) => void;
  updateReminders: (patch: Partial<Omit<ReminderSettings, 'updatedAt'>>) => void;
}

export const useTaskStore = create<TaskStore>()(
  persist(
    (set, get) => ({
      tasks: buildSeedTasks(),
      projects: PROJECTS,
      products: [],
      partners: [],
      pairs: [],
      stages: [],
      releases: [],
      signoffs: [],
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
            workspaceData: { ...s.workspaceData, [id]: emptySnapshot() },
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

      // Swaps the top-level data (tasks, projects, products, partners, pairs) for another
      // workspace's, stashing the outgoing workspace's in workspaceData so it's the only place a
      // non-active workspace lives.
      setActiveWorkspace: (id) =>
        set((s) => {
          if (id === s.activeWorkspaceId || !s.workspaces.some((w) => w.id === id)) return s;
          const incoming: WorkspaceSnapshot = ownEntry(s.workspaceData, id) ?? emptySnapshot();
          const workspaceData = { ...s.workspaceData };
          delete workspaceData[id];
          workspaceData[s.activeWorkspaceId] = activeSnapshot(s);
          return { activeWorkspaceId: id, ...activeSnapshot({ ...emptySnapshot(), ...incoming }), workspaceData };
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

      // Reopening goes back to the type's first status; finishing to its complete status.
      toggleDone: (id) =>
        set((s) => ({
          tasks: updateTask(s.tasks, id, (t) => (isDone(t) ? { ...t, status: firstStatus(typeOf(t)) } : completeTask(t))),
        })),

      setStatus: (id, status) =>
        set((s) => ({
          tasks: updateTask(s.tasks, id, (t) => (isDone({ type: t.type, status }) ? completeTask(t, status) : { ...t, status })),
        })),

      addGroup: (kind, name) => {
        const trimmed = name.trim();
        if (!trimmed) return '';
        let id = '';
        set((s) => {
          const list = s[GROUP_LIST[kind]];
          id = uniqueId(trimmed, list.map((g) => g.id));
          const group: Project = { id, name: trimmed, color: nextProjectColor(list), updatedAt: Date.now() };
          return { [GROUP_LIST[kind]]: [...list, group] } as Partial<TaskStore>;
        });
        return id;
      },

      renameGroup: (kind, id, name) =>
        set((s) => {
          const trimmed = name.trim();
          if (!trimmed) return s;
          return {
            [GROUP_LIST[kind]]: s[GROUP_LIST[kind]].map((g) => (g.id === id ? { ...g, name: trimmed, updatedAt: Date.now() } : g)),
          } as Partial<TaskStore>;
        }),

      deleteGroup: (kind, id) => {
        if (kind === 'project') return get().deleteProject(id);
        if (rel.releasesOf(get(), kind, id)) return; // its releases' sign-offs keep it
        set((s) => {
          const { snap, deleted } = withoutGroup(activeSnapshot(s), kind, id, s.activeWorkspaceId, Date.now());
          return { ...snap, deleted: { ...s.deleted, ...deleted } };
        });
      },

      addRelease: (input) => {
        const { snap, id } = rel.addRelease(activeSnapshot(get()), input, Date.now());
        set(snap);
        return id;
      },

      updateRelease: (id, patch) => set((s) => rel.updateRelease(activeSnapshot(s), id, patch, Date.now())),

      deleteRelease: (id) => {
        const s = get();
        const done = rel.deleteRelease(activeSnapshot(s), id, s.activeWorkspaceId, Date.now());
        if (done) set({ ...done.snap, deleted: { ...s.deleted, ...done.deleted } });
        return Boolean(done);
      },

      addStage: (name) => set((s) => rel.addStage(activeSnapshot(s), name, Date.now())),

      renameStage: (id, name) => set((s) => rel.renameStage(activeSnapshot(s), id, name, Date.now())),

      moveStage: (id, direction) => set((s) => rel.moveStage(activeSnapshot(s), id, direction, Date.now())),

      deleteStage: (id) => {
        const s = get();
        const done = rel.deleteStage(activeSnapshot(s), id, s.activeWorkspaceId, Date.now());
        if (done) set({ ...done.snap, deleted: { ...s.deleted, ...done.deleted } });
        return Boolean(done);
      },

      signOff: (input) => {
        const done = rel.addSignOff(activeSnapshot(get()), input, Date.now());
        if ('problem' in done) return done.problem;
        set(done.snap);
        return null;
      },

      sortProjects: (choices) =>
        set((s) => {
          const { snap, deleted } = sortProjects(activeSnapshot(s), choices, s.activeWorkspaceId, Date.now());
          return { ...snap, deleted: { ...s.deleted, ...deleted } };
        }),

      setHome: (id, home) =>
        set((s) => {
          const now = Date.now();
          const t = s.tasks.find((x) => x.id === id);
          if (!t) return s;
          const { task, newPair } = withHome(t, parseHome(home), s.pairs, now);
          return {
            tasks: s.tasks.map((x) => (x.id === id ? { ...task, updatedAt: now } : x)),
            ...(newPair ? { pairs: [...s.pairs, newPair] } : {}),
          };
        }),

      setType: (id, type) => set((s) => ({ tasks: updateTask(s.tasks, id, (t) => withType(t, type)) })),

      setDetail: (id, key, value) => set((s) => ({ tasks: updateTask(s.tasks, id, (t) => withDetail(t, key, value)) })),

      setPriority: (id, priority) => set((s) => ({ tasks: updateTask(s.tasks, id, (t) => ({ ...t, priority })) })),

      setProject: (id, project) => get().setHome(id, project ? `project:${project}` : ''),

      setDueDate: (id, dueDate) => set((s) => ({ tasks: updateTask(s.tasks, id, (t) => ({ ...t, dueDate })) })),

      setRecurring: (id, recurring) => set((s) => ({ tasks: updateTask(s.tasks, id, (t) => ({ ...t, recurring })) })),

      setRemindDaysBefore: (id, days) =>
        set((s) => ({ tasks: updateTask(s.tasks, id, (t) => ({ ...t, remindDaysBefore: days })) })),

      setWaitingOn: (id, waitingOn) => set((s) => ({ tasks: updateTask(s.tasks, id, (t) => withWaiting(t, waitingOn)) })),

      setChaseOn: (id, date) => set((s) => ({ tasks: updateTask(s.tasks, id, (t) => withDate(t, 'chaseOn', date)) })),

      snooze: (id, until) => set((s) => ({ tasks: updateTask(s.tasks, id, (t) => withDate(t, 'snoozedUntil', until)) })),

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

      addTask: ({ title, project, home, type = 'task', priority, dueDate }) =>
        set((s) => {
          const now = Date.now();
          const blank: Task = {
            id: newItemId(),
            project: project ?? '',
            title,
            status: firstStatus(type),
            priority,
            dueDate,
            subs: [],
            recurring: null,
            deps: [],
            notes: '',
            order: Math.min(0, ...s.tasks.map((t) => t.order)) - 1,
            updatedAt: now,
          };
          if (type !== 'task') blank.type = type;
          const { task, newPair } = home === undefined ? { task: blank, newPair: null } : withHome(blank, parseHome(home), s.pairs, now);
          return { tasks: [task, ...s.tasks], ...(newPair ? { pairs: [...s.pairs, newPair] } : {}) };
        }),

      // Refuses dependencies that would close a loop — every task in a loop would stay blocked forever.
      addDependency: (id, dependsOnId) =>
        set((s) => {
          const task = s.tasks.find((t) => t.id === id);
          if (!task || task.deps.includes(dependsOnId) || wouldCreateCycle(s.tasks, id, dependsOnId)) return s;
          return { tasks: updateTask(s.tasks, id, (t) => ({ ...t, deps: [...t.deps, dependsOnId] })) };
        }),

      removeDependency: (id, dependsOnId) =>
        set((s) => ({ tasks: updateTask(s.tasks, id, (t) => ({ ...t, deps: t.deps.filter((d) => d !== dependsOnId) })) })),

      moveTask: (id, destPhase, destColumnOrderedIds) =>
        set((s) => {
          const now = Date.now();
          const orderById = new Map(destColumnOrderedIds.map((tid, i) => [tid, i]));
          return {
            tasks: s.tasks.map((t) => {
              if (t.id === id) {
                // Each type has its own status for a column: a risk dropped in "In progress" is mitigating.
                const moved = { ...t, status: statusForPhase(typeOf(t), destPhase), order: orderById.get(id) ?? t.order, updatedAt: now };
                return withCompletion(t, moved, dateToIso(today()));
              }
              if (!orderById.has(t.id) || orderById.get(t.id) === t.order) return t;
              return { ...t, order: orderById.get(t.id)!, updatedAt: now };
            }),
          };
        }),

      updateReminders: (patch) => set((s) => ({ reminders: { ...s.reminders, ...patch, updatedAt: Date.now() } })),
    }),
    {
      name: STORE_KEY,
      version: STATE_VERSION,
      storage: createCloudStorage(),
      // Older versions get stamps of 0 (older than any real edit), tombstones and default reminder settings.
      migrate: (persisted) => normalizeState(persisted) as unknown as TaskStore,
      // Same-version data skips migrate, so reminder settings added since it was saved (such as
      // privateNotifications) get their defaults here instead of reading as undefined.
      merge: (persisted, current) => {
        const saved = persisted as Partial<SyncedState> | undefined;
        if (!saved) return current;
        return { ...current, ...saved, reminders: { ...DEFAULT_REMINDERS, ...saved.reminders } };
      },
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
