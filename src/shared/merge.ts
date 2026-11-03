/**
 * Item-by-item merge of two copies of the synced state (this device's and the cloud's), so
 * offline edits and edits on other devices both survive instead of one blob overwriting the other.
 * Used by the app on load and by /api/state on every upload.
 */
import type { WorkspaceSnapshot } from '../types.js';
import { allWorkspaceData, normalizeState, ownEntry, stripMissingDeps, type SyncedState } from './state.js';

interface Stamped {
  id: string;
  updatedAt: number;
}

/** Newer updatedAt wins; ties go to `incoming`. Items whose tombstone is at least as new are dropped. */
function mergeItems<T extends Stamped>(kind: string, base: T[], incoming: T[], deleted: Record<string, number>): T[] {
  const byId = new Map<string, T>();
  for (const item of base) byId.set(item.id, item);
  for (const item of incoming) {
    const existing = byId.get(item.id);
    if (!existing || item.updatedAt >= existing.updatedAt) byId.set(item.id, item);
  }
  return [...byId.values()].filter((item) => !((deleted[`${kind}:${item.id}`] ?? -1) >= item.updatedAt));
}

/**
 * @param activeWorkspaceId which workspace's data goes in the top-level tasks/projects — a
 *   per-device choice, so callers pass the local device's.
 */
export function mergeStates(baseRaw: unknown, incomingRaw: unknown, activeWorkspaceId?: string): SyncedState {
  const base = normalizeState(baseRaw);
  const incoming = normalizeState(incomingRaw);

  const deleted = { ...base.deleted };
  for (const [key, at] of Object.entries(incoming.deleted)) deleted[key] = Math.max(deleted[key] ?? 0, at);

  const workspaces = mergeItems('workspace', base.workspaces, incoming.workspaces, deleted);
  const baseData = allWorkspaceData(base);
  const incomingData = allWorkspaceData(incoming);
  const empty: WorkspaceSnapshot = { projects: [], tasks: [] };

  const data: Record<string, WorkspaceSnapshot> = {};
  for (const w of workspaces) {
    const b = ownEntry(baseData, w.id) ?? empty;
    const i = ownEntry(incomingData, w.id) ?? empty;
    data[w.id] = {
      projects: mergeItems(`project:${w.id}`, b.projects, i.projects, deleted),
      tasks: stripMissingDeps(mergeItems(`task:${w.id}`, b.tasks, i.tasks, deleted)),
    };
  }

  const wanted = activeWorkspaceId ?? incoming.activeWorkspaceId;
  const active = workspaces.some((w) => w.id === wanted) ? wanted : (workspaces[0]?.id ?? base.activeWorkspaceId);
  const activeData = ownEntry(data, active) ?? empty;
  const workspaceData = Object.fromEntries(Object.entries(data).filter(([id]) => id !== active));

  return normalizeState({
    tasks: activeData.tasks,
    projects: activeData.projects,
    workspaces,
    activeWorkspaceId: active,
    workspaceData,
    deleted,
    reminders: incoming.reminders.updatedAt >= base.reminders.updatedAt ? incoming.reminders : base.reminders,
  });
}
