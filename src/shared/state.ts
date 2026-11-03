/** The synced data shape, shared by the app's store and the /api functions. Pure — no DOM, no React. */
import type { Project, ReminderSettings, Task, Workspace, WorkspaceSnapshot } from '../types.js';

/** Persisted store version. 3 adds updatedAt stamps, deletion tombstones and reminder settings. */
export const STATE_VERSION = 3;

/** Tombstones older than this are dropped; a device offline longer than this could resurrect a deleted item. */
const TOMBSTONE_TTL_MS = 60 * 24 * 60 * 60 * 1000;

export interface SyncedState {
  tasks: Task[];
  projects: Project[];
  workspaces: Workspace[];
  activeWorkspaceId: string;
  workspaceData: Record<string, WorkspaceSnapshot>;
  /** Deletion tombstones: 'task:<workspaceId>:<id>' | 'project:<workspaceId>:<id>' | 'workspace:<id>' → deletion time (ms). */
  deleted: Record<string, number>;
  reminders: ReminderSettings;
}

/** The { state, version } envelope zustand's persist middleware stores, and /api/state holds. */
export interface StoredState {
  state: SyncedState;
  version: number;
}

export const DEFAULT_REMINDERS: ReminderSettings = {
  enabled: true,
  digestTime: '08:00',
  defaultLeadDays: 1,
  includeOverdue: true,
  timezone: 'UTC',
  updatedAt: 0,
};

export const DEFAULT_WORKSPACE: Workspace = { id: 'default', name: 'My Workspace', updatedAt: 0 };

/** Removes deleted task ids from every remaining task's deps, so nothing stays blocked on a ghost. */
export function stripDeps(tasks: Task[], deletedIds: Set<string>): Task[] {
  return tasks.map((t) =>
    t.deps.some((d) => deletedIds.has(d)) ? { ...t, deps: t.deps.filter((d) => !deletedIds.has(d)) } : t,
  );
}

/** Drops deps on tasks that don't exist in the same workspace (e.g. deleted on another device). */
export function stripMissingDeps(tasks: Task[]): Task[] {
  const ids = new Set(tasks.map((t) => t.id));
  const missing = new Set(tasks.flatMap((t) => t.deps.filter((d) => !ids.has(d))));
  return missing.size ? stripDeps(tasks, missing) : tasks;
}

function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

function stamped<T extends { updatedAt?: number }>(items: T[]): (T & { updatedAt: number })[] {
  return items.map((x) => (typeof x.updatedAt === 'number' ? (x as T & { updatedAt: number }) : { ...x, updatedAt: 0 }));
}

function snapshot(raw: unknown): WorkspaceSnapshot {
  const s = (raw ?? {}) as Partial<WorkspaceSnapshot>;
  return { projects: stamped(asArray<Project>(s.projects)), tasks: stripMissingDeps(stamped(asArray<Task>(s.tasks))) };
}

/**
 * Brings any persisted state (older versions, other devices, partial blobs) up to the current
 * shape: missing stamps become 0 (older than any real edit), missing fields get defaults, deps on
 * missing tasks are dropped and expired tombstones pruned. Idempotent.
 */
export function normalizeState(raw: unknown, now = Date.now()): SyncedState {
  const s = (raw ?? {}) as Partial<SyncedState>;
  const workspaces = stamped(asArray<Workspace>(s.workspaces));
  if (!workspaces.length) workspaces.push(DEFAULT_WORKSPACE);
  const activeWorkspaceId = workspaces.some((w) => w.id === s.activeWorkspaceId)
    ? (s.activeWorkspaceId as string)
    : workspaces[0].id;

  const workspaceData: Record<string, WorkspaceSnapshot> = {};
  for (const [id, data] of Object.entries(s.workspaceData ?? {})) {
    if (id !== activeWorkspaceId && workspaces.some((w) => w.id === id)) workspaceData[id] = snapshot(data);
  }

  const deleted: Record<string, number> = {};
  for (const [key, at] of Object.entries(s.deleted ?? {})) {
    if (typeof at === 'number' && now - at < TOMBSTONE_TTL_MS) deleted[key] = at;
  }

  const active = snapshot({ projects: s.projects, tasks: s.tasks });
  return {
    tasks: active.tasks,
    projects: active.projects,
    workspaces,
    activeWorkspaceId,
    workspaceData,
    deleted,
    reminders: { ...DEFAULT_REMINDERS, ...(s.reminders ?? {}) },
  };
}

/**
 * Own-property lookup for workspace-keyed records. Workspace ids come from user-typed names, so a
 * plain `record[id]` would return built-ins for ids like 'constructor' instead of undefined.
 */
export function ownEntry<T>(record: Record<string, T>, key: string): T | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

/** Every workspace's data keyed by workspace id, regardless of which one is active. */
export function allWorkspaceData(s: SyncedState): Record<string, WorkspaceSnapshot> {
  return { ...s.workspaceData, [s.activeWorkspaceId]: { projects: s.projects, tasks: s.tasks } };
}
