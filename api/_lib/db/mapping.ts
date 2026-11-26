/**
 * Between today's synced JSON document (SyncedState) and the Postgres rows of
 * db/migrations/0001_foundation.sql. Pure: no database, so the import can be checked by a round
 * trip (document → rows → document) before it touches anything.
 *
 * Times are milliseconds here (the document's updatedAt and tombstone stamps) and timestamptz in
 * the database; the SQL layer converts at the boundary, exactly to the millisecond.
 */
import type { Project, Recurring, ReminderSettings, Status, Task, Priority } from '../../../src/types.js';
import { createHash } from 'node:crypto';
import { mergeStates } from '../../../src/shared/merge.js';
import { DEFAULT_REMINDERS, allWorkspaceData, normalizeState, ownEntry, type SyncedState } from '../../../src/shared/state.js';

export interface WorkspaceRow {
  id: string;
  owner_id: string;
  client_id: string;
  name: string;
  sort_order: number;
  edited_ms: number;
  deleted_ms: number | null;
}
export interface ProjectRow {
  id: string;
  workspace_id: string;
  owner_id: string;
  client_id: string;
  name: string;
  color: string;
  sort_order: number;
  edited_ms: number;
  deleted_ms: number | null;
}
export interface ItemRow {
  id: string;
  workspace_id: string;
  owner_id: string;
  client_id: string;
  type: 'task';
  project_id: string | null;
  title: string;
  status: Status;
  priority: Priority;
  due_date: string | null;
  start_date: string | null;
  recurring: Recurring;
  remind_days_before: number | null;
  remind_off: boolean;
  notes: string;
  sort_order: number;
  subtasks: Task['subs'];
  details: Record<string, unknown>;
  /** Also the list order: newest first, as the app adds new tasks at the top. */
  created_ms: number;
  edited_ms: number;
  deleted_ms: number | null;
}
export interface LinkRow {
  workspace_id: string;
  owner_id: string;
  from_id: string;
  to_id: string;
  kind: 'depends_on';
}
export interface LegacyDeletionRow {
  workspace_id: string;
  kind: 'task' | 'project';
  client_id: string;
  deleted_ms: number;
}
export interface SettingsRow {
  user_id: string;
  reminders: Omit<ReminderSettings, 'updatedAt'>;
  edited_ms: number;
}

/** Everything one user's workspaces hold, as rows. */
export interface Rows {
  workspaces: WorkspaceRow[];
  projects: ProjectRow[];
  items: ItemRow[];
  links: LinkRow[];
  legacyDeletions: LegacyDeletionRow[];
  settings: SettingsRow | null;
}

/** Things the import changed or couldn't carry over exactly; the dry run prints them. */
export interface ImportNote {
  where: string;
  note: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const COLOR = /^#[0-9a-fA-F]{6}$/;
const STATUSES = new Set<Status>(['todo', 'doing', 'blocked', 'done']);
const PRIORITIES = new Set<Priority>(['high', 'med', 'low']);
const RECURRING = new Set(['weekly', 'monthly', 'yearly']);

/** Tombstone keys: 'task:<workspace>:<id>', 'project:<workspace>:<id>', 'workspace:<id>'. Ids may contain ':'. */
function parseTombstone(key: string): { kind: string; workspace: string; id: string } | null {
  const [kind, ...rest] = key.split(':');
  if (kind === 'workspace' && rest.length) return { kind, workspace: rest.join(':'), id: rest.join(':') };
  if ((kind === 'task' || kind === 'project') && rest.length >= 2) return { kind, workspace: rest[0], id: rest.slice(1).join(':') };
  return null;
}

/**
 * The rows for one user's document. `newId` makes uuids (injected so tests are repeatable).
 * Keeps everything: every workspace, project and task with its edit time, every dependency,
 * every remembered deletion, and the reminder settings.
 */
export function documentToRows(
  raw: unknown,
  ownerId: string,
  newId: () => string,
  now = Date.now(),
): { rows: Rows; notes: ImportNote[] } {
  const state = normalizeState(raw);
  const notes: ImportNote[] = [];
  const rows: Rows = { workspaces: [], projects: [], items: [], links: [], legacyDeletions: [], settings: null };
  const data = allWorkspaceData(state);
  const workspaceIds = new Map<string, string>();

  state.workspaces.forEach((w, i) => {
    const id = newId();
    workspaceIds.set(w.id, id);
    rows.workspaces.push({ id, owner_id: ownerId, client_id: w.id, name: w.name.trim() || w.id, sort_order: i, edited_ms: w.updatedAt, deleted_ms: null });
  });

  // Tombstones: a deleted workspace becomes a soft-deleted row (its name is gone, so the id stands in).
  const tombstones = Object.entries(state.deleted).map(([key, at]) => ({ key, at, t: parseTombstone(key) }));
  for (const { key, at, t } of tombstones) {
    if (!t) {
      notes.push({ where: key, note: 'unrecognised deletion record; not carried over' });
    } else if (t.kind === 'workspace' && workspaceIds.has(t.id)) {
      const live = rows.workspaces.find((r) => r.client_id === t.id)!;
      if (at >= live.edited_ms) live.deleted_ms = at;
    } else if (t.kind === 'workspace') {
      const id = newId();
      workspaceIds.set(t.id, id);
      rows.workspaces.push({ id, owner_id: ownerId, client_id: t.id, name: t.id, sort_order: rows.workspaces.length, edited_ms: at, deleted_ms: at });
    }
  }

  for (const w of state.workspaces) {
    const wsId = workspaceIds.get(w.id)!;
    const { projects = [], tasks = [] } = ownEntry(data, w.id) ?? {};
    const projectIds = new Map<string, string>();

    projects.forEach((p: Project, i: number) => {
      const id = newId();
      projectIds.set(p.id, id);
      let color = p.color;
      if (!COLOR.test(color)) {
        notes.push({ where: `${w.id}/${p.id}`, note: `colour ${JSON.stringify(color)} isn't #rrggbb; using the default` });
        color = '#b4674a';
      }
      rows.projects.push({
        id, workspace_id: wsId, owner_id: ownerId, client_id: p.id, name: p.name.trim() || p.id, color,
        sort_order: i, edited_ms: p.updatedAt, deleted_ms: null,
      });
    });

    const itemIds = new Map<string, string>();
    for (const [index, t] of tasks.entries()) {
      const id = newId();
      itemIds.set(t.id, id);
      const details: Record<string, unknown> = {};
      const projectId = projectIds.get(t.project) ?? null;
      // Kept so the document comes back exactly, though the project itself is gone.
      if (!projectId) {
        details.legacy_project = t.project;
        if (t.project) notes.push({ where: `${w.id}/${t.id}`, note: `project ${JSON.stringify(t.project)} doesn't exist; kept as a note on the item` });
      }
      const dueDate = ISO_DATE.test(t.dueDate) ? t.dueDate : null;
      if (!dueDate) {
        details.legacy_due_date = t.dueDate;
        notes.push({ where: `${w.id}/${t.id}`, note: `due date ${JSON.stringify(t.dueDate)} isn't YYYY-MM-DD; kept as a note` });
      }
      const status = STATUSES.has(t.status) ? t.status : 'todo';
      if (status !== t.status) notes.push({ where: `${w.id}/${t.id}`, note: `status ${JSON.stringify(t.status)} unknown; set to todo` });
      const priority = PRIORITIES.has(t.priority) ? t.priority : 'med';
      if (priority !== t.priority) notes.push({ where: `${w.id}/${t.id}`, note: `priority ${JSON.stringify(t.priority)} unknown; set to med` });
      const recurring = t.recurring && RECURRING.has(t.recurring) ? t.recurring : null;
      const startDate = t.startDate && ISO_DATE.test(t.startDate) ? t.startDate : null;
      if (t.startDate && !startDate) details.legacy_start_date = t.startDate;
      rows.items.push({
        id, workspace_id: wsId, owner_id: ownerId, client_id: t.id, type: 'task', project_id: projectId,
        title: t.title, status, priority, due_date: dueDate, start_date: startDate, recurring,
        remind_days_before: typeof t.remindDaysBefore === 'number' ? Math.max(0, Math.round(t.remindDaysBefore)) : null,
        remind_off: t.remindDaysBefore === null,
        notes: t.notes ?? '', sort_order: Number.isFinite(t.order) ? t.order : 0,
        subtasks: Array.isArray(t.subs) ? t.subs : [], details, created_ms: now - index, edited_ms: t.updatedAt, deleted_ms: null,
      });
    }
    for (const t of tasks) {
      for (const dep of new Set(t.deps)) {
        const to = itemIds.get(dep);
        if (to && dep !== t.id) rows.links.push({ workspace_id: wsId, owner_id: ownerId, from_id: itemIds.get(t.id)!, to_id: to, kind: 'depends_on' });
      }
    }

    // A deletion newer than the surviving copy wins (as in merge.ts); otherwise it is remembered.
    for (const { at, t } of tombstones) {
      if (!t || t.kind === 'workspace' || t.workspace !== w.id) continue;
      const live = t.kind === 'task' ? rows.items.find((r) => r.workspace_id === wsId && r.client_id === t.id)
        : rows.projects.find((r) => r.workspace_id === wsId && r.client_id === t.id);
      if (live && at >= live.edited_ms) live.deleted_ms = at;
      else if (!live) rows.legacyDeletions.push({ workspace_id: wsId, kind: t.kind as 'task' | 'project', client_id: t.id, deleted_ms: at });
    }
  }

  // Deletions for workspaces the document no longer lists can't be filed anywhere.
  for (const { key, t } of tombstones) {
    if (t && t.kind !== 'workspace' && !workspaceIds.has(t.workspace)) notes.push({ where: key, note: 'deletion in a workspace that no longer exists; not carried over' });
  }

  const { updatedAt, ...reminders } = state.reminders;
  rows.settings = { user_id: ownerId, reminders, edited_ms: updatedAt };
  return { rows, notes };
}

/**
 * The document a device expects, from one user's rows. `activeWorkspaceId` is the device's own
 * choice (it isn't stored). Deletions older than the app keeps (TOMBSTONE_TTL_MS before `now`)
 * are left out by normalizeState, as on a device; the database keeps them all.
 */
export function rowsToDocument(rows: Rows, activeWorkspaceId?: string, now = Date.now()): SyncedState {
  const bySort = <T extends { sort_order: number; client_id: string }>(a: T, b: T) =>
    a.sort_order - b.sort_order || a.client_id.localeCompare(b.client_id);
  const liveWorkspaces = rows.workspaces.filter((w) => w.deleted_ms === null).sort(bySort);
  const deleted: Record<string, number> = {};
  const workspaceData: SyncedState['workspaceData'] = {};

  for (const w of rows.workspaces) {
    if (w.deleted_ms !== null) deleted[`workspace:${w.client_id}`] = w.deleted_ms;
  }

  for (const w of liveWorkspaces) {
    const projects = rows.projects.filter((p) => p.workspace_id === w.id);
    const items = rows.items.filter((i) => i.workspace_id === w.id);
    const projectClient = new Map(projects.map((p) => [p.id, p.client_id]));
    const itemClient = new Map(items.filter((i) => i.deleted_ms === null).map((i) => [i.id, i.client_id]));
    const deps = new Map<string, string[]>();
    for (const l of rows.links) {
      const to = itemClient.get(l.to_id);
      if (l.workspace_id === w.id && to) deps.set(l.from_id, [...(deps.get(l.from_id) ?? []), to]);
    }

    for (const p of projects) {
      if (p.deleted_ms !== null) deleted[`project:${w.client_id}:${p.client_id}`] = p.deleted_ms;
    }
    for (const i of items) {
      if (i.deleted_ms !== null) deleted[`task:${w.client_id}:${i.client_id}`] = i.deleted_ms;
    }
    for (const d of rows.legacyDeletions) {
      if (d.workspace_id === w.id) deleted[`${d.kind}:${w.client_id}:${d.client_id}`] = d.deleted_ms;
    }

    workspaceData[w.client_id] = {
      projects: projects
        .filter((p) => p.deleted_ms === null)
        .sort(bySort)
        .map((p) => ({ id: p.client_id, name: p.name, color: p.color, updatedAt: p.edited_ms })),
      tasks: items
        .filter((i) => i.deleted_ms === null && i.type === 'task')
        .sort((a, b) => b.created_ms - a.created_ms || a.client_id.localeCompare(b.client_id))
        .map((i): Task => {
          const task: Task = {
            id: i.client_id,
            project: (i.project_id && projectClient.get(i.project_id)) || String(i.details.legacy_project ?? ''),
            title: i.title,
            status: i.status,
            priority: i.priority,
            dueDate: i.due_date ?? String(i.details.legacy_due_date ?? ''),
            subs: i.subtasks,
            recurring: i.recurring,
            deps: deps.get(i.id) ?? [],
            notes: i.notes,
            order: i.sort_order,
            updatedAt: i.edited_ms,
          };
          const start = i.start_date ?? (i.details.legacy_start_date as string | undefined);
          if (start) task.startDate = start;
          if (i.remind_off) task.remindDaysBefore = null;
          else if (i.remind_days_before !== null) task.remindDaysBefore = i.remind_days_before;
          return task;
        }),
    };
  }

  const workspaces = liveWorkspaces.map((w) => ({ id: w.client_id, name: w.name, updatedAt: w.edited_ms }));
  const active = workspaces.some((w) => w.id === activeWorkspaceId) ? activeWorkspaceId! : (workspaces[0]?.id ?? 'default');
  const activeData = ownEntry(workspaceData, active) ?? { projects: [], tasks: [] };
  const reminders: ReminderSettings = rows.settings
    ? { ...DEFAULT_REMINDERS, ...rows.settings.reminders, updatedAt: rows.settings.edited_ms }
    : DEFAULT_REMINDERS;
  return normalizeState(
    {
      tasks: activeData.tasks,
      projects: activeData.projects,
      workspaces,
      activeWorkspaceId: active,
      workspaceData: Object.fromEntries(Object.entries(workspaceData).filter(([id]) => id !== active)),
      deleted,
      reminders,
    },
    now,
  );
}

export interface WorkspaceSummary {
  workspace: string;
  projects: number;
  tasks: number;
  done: number;
  dependencies: number;
  deletions: number;
}

/**
 * What the before/after comparison checks: counts per workspace, and one checksum over every
 * workspace, project and task (title, status, dates, reminder, order, edit time, dependencies,
 * subtasks, notes), every deletion and the reminder settings. The app's own merge rule is applied
 * first, so a deletion that a later edit has overridden doesn't count. Equal summaries mean
 * nothing was lost or changed. (Task order within the list isn't compared: the views sort it.)
 */
export function summariseDocument(raw: unknown): { workspaces: WorkspaceSummary[]; checksum: string } {
  const normal = normalizeState(raw);
  const state = mergeStates(normal, normal, normal.activeWorkspaceId);
  const data = allWorkspaceData(state);
  const live = new Set<string>();
  for (const w of state.workspaces) {
    live.add(`workspace:${w.id}`);
    const { projects = [], tasks = [] } = ownEntry(data, w.id) ?? {};
    for (const p of projects) live.add(`project:${w.id}:${p.id}`);
    for (const t of tasks) live.add(`task:${w.id}:${t.id}`);
  }
  const deletions = Object.entries(state.deleted).filter(([key]) => !live.has(key));

  const lines: string[] = [];
  const workspaces = state.workspaces.map((w) => {
    const { projects = [], tasks = [] } = ownEntry(data, w.id) ?? {};
    lines.push(`w|${w.id}|${w.name}|${w.updatedAt}`);
    for (const p of projects) lines.push(`p|${w.id}|${p.id}|${p.name}|${p.color}|${p.updatedAt}`);
    for (const t of tasks) {
      const remind = t.remindDaysBefore === undefined ? 'default' : String(t.remindDaysBefore);
      lines.push(['t', w.id, t.id, t.project, t.title, t.status, t.priority, t.dueDate, t.startDate ?? '', t.recurring ?? '', remind,
        t.order, t.updatedAt, [...t.deps].sort().join(','), JSON.stringify(t.subs), t.notes].join('|'));
    }
    const prefixes = [`task:${w.id}:`, `project:${w.id}:`];
    return {
      workspace: w.id,
      projects: projects.length,
      tasks: tasks.length,
      done: tasks.filter((t) => t.status === 'done').length,
      dependencies: tasks.reduce((n, t) => n + t.deps.length, 0),
      deletions: deletions.filter(([key]) => prefixes.some((p) => key.startsWith(p))).length,
    };
  });
  for (const [key, at] of deletions) lines.push(`d|${key}|${at}`);
  lines.push(`r|${JSON.stringify(Object.entries(state.reminders).sort())}`);
  lines.sort();
  return { workspaces, checksum: createHash('sha256').update(lines.join('\n')).digest('hex') };
}
