/** The synced data shape, shared by the app's store and the /api functions. Pure — no DOM, no React. */
import type { Partner, Product, ProductPartner, Project, Release, ReminderSettings, SignOff, Stage, Task, Workspace, WorkspaceSnapshot } from '../types.js';

/**
 * Persisted store version. 3 adds updatedAt stamps, deletion tombstones and reminder settings;
 * 4 adds products, partners and their pairs (build plan Step 1b); 5 adds stages, releases and
 * sign-offs (Step 3). Older saved data is upgraded.
 */
export const STATE_VERSION = 5;

/** Tombstones older than this are dropped; a device offline longer than this could resurrect a deleted item. */
export const TOMBSTONE_TTL_MS = 60 * 24 * 60 * 60 * 1000;

/** The active workspace's data sits at the top level (tasks, projects, products, partners, pairs); the others in workspaceData. */
export interface SyncedState extends WorkspaceSnapshot {
  workspaces: Workspace[];
  activeWorkspaceId: string;
  workspaceData: Record<string, WorkspaceSnapshot>;
  /**
   * Deletion tombstones → deletion time (ms): 'task:<workspaceId>:<id>' (any item),
   * 'project:…', 'product:…', 'partner:…', 'pair:<workspaceId>:<product>+<partner>', 'stage:…',
   * 'release:…', 'workspace:<id>'. Sign-offs are never deleted.
   */
  deleted: Record<string, number>;
  reminders: ReminderSettings;
}

/** A workspace with nothing in it yet. */
export function emptySnapshot(): WorkspaceSnapshot {
  return { projects: [], tasks: [], products: [], partners: [], pairs: [], stages: [], releases: [], signoffs: [] };
}

/** The active workspace's data, from the top level of the state. */
export function activeSnapshot(s: WorkspaceSnapshot): WorkspaceSnapshot {
  return {
    projects: s.projects,
    tasks: s.tasks,
    products: s.products,
    partners: s.partners,
    pairs: s.pairs,
    stages: s.stages,
    releases: s.releases,
    signoffs: s.signoffs,
  };
}

export const pairId = (product: string, partner: string) => `${product}+${partner}`;

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
  emailDigest: false,
  email: '',
  // On by default (and for data saved before the setting existed): names stay out of other
  // companies' systems unless the owner chooses otherwise.
  privateNotifications: true,
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
  const products = stamped(asArray<Product>(s.products));
  const partners = stamped(asArray<Partner>(s.partners));
  const productIds = new Set(products.map((p) => p.id));
  const partnerIds = new Set(partners.map((p) => p.id));
  // A pair needs both ends in this workspace; its id is always product+partner.
  const pairs = stamped(asArray<ProductPartner>(s.pairs))
    .filter((p) => productIds.has(p.product) && partnerIds.has(p.partner))
    .map((p) => (p.id === pairId(p.product, p.partner) ? p : { ...p, id: pairId(p.product, p.partner) }));
  return {
    projects: stamped(asArray<Project>(s.projects)),
    tasks: stripMissingDeps(stamped(asArray<Task>(s.tasks))),
    products,
    partners,
    pairs,
    // Releases and sign-offs are records: kept even if what they name has gone.
    stages: stamped(asArray<Stage>(s.stages)),
    releases: stamped(asArray<Release>(s.releases)),
    signoffs: stamped(asArray<SignOff>(s.signoffs)),
  };
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

  const active = snapshot(activeSnapshot(s as WorkspaceSnapshot));
  return {
    ...active,
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
  return { ...s.workspaceData, [s.activeWorkspaceId]: activeSnapshot(s) };
}
