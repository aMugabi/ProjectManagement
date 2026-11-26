/**
 * Sync on Postgres: a device uploads its copy of the document; the server merges it with what it
 * holds using the app's own rule (src/shared/merge.ts: newest edit wins, item by item; a deletion
 * at least as new as an edit wins), writes the rows whose merged copy differs from the stored
 * one, as the user (so row-level security and the change log apply), and returns the result.
 *
 * The database remembers every deletion for good (soft delete), while the merge, like a device,
 * forgets deletions after 60 days. So a stale copy of a deleted item is refused here, against
 * the deleted row, and the reply marks it deleted now so the device drops it too.
 */
import type { Task } from '../../../src/types.js';
import { mergeStates } from '../../../src/shared/merge.js';
import { allWorkspaceData, normalizeState, ownEntry, type SyncedState } from '../../../src/shared/state.js';
import type { Queryable } from './client.js';
import { projectKey, remindersKey, rowsToDocument, taskKey, workspaceKey, type Rows } from './mapping.js';
import { readRows } from './rows.js';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

type TaskFields = ReturnType<typeof taskFields>;

/** What a sync writes. Pure: built from the current rows and the merged document. */
export interface SyncPlan {
  newWorkspaces: { client_id: string; name: string; sort_order: number; edited_ms: number }[];
  /** Renames, and deleted workspaces coming back for a newer edit. */
  workspaceUpdates: { id: string; name: string; edited_ms: number }[];
  newProjects: { workspace: string; client_id: string; name: string; color: string; sort_order: number; edited_ms: number }[];
  projectUpdates: { id: string; name: string; color: string; edited_ms: number }[];
  newItems: (TaskFields & { workspace: string; client_id: string; project: string; created_ms: number })[];
  itemUpdates: (TaskFields & { id: string; workspace: string; project: string })[];
  /** For each new or changed item: the full list of items it now depends on (client ids, same workspace). */
  dependencies: { workspace: string; item: string; dependsOn: string[] }[];
  deletions: { table: 'workspaces' | 'projects' | 'items'; id: string; deleted_ms: number }[];
  /** Uploaded copies refused because the database holds a newer deletion: tombstone keys for the reply. */
  refused: string[];
  settings: { reminders: Omit<SyncedState['reminders'], 'updatedAt'>; edited_ms: number } | null;
}

export function isEmptyPlan(plan: SyncPlan): boolean {
  return Object.entries(plan).every(([key, v]) => key === 'refused' || (Array.isArray(v) ? v.length === 0 : v === null));
}

function taskFields(t: Task) {
  const details: Record<string, unknown> = {};
  const due_date = ISO_DATE.test(t.dueDate) ? t.dueDate : null;
  if (!due_date) details.legacy_due_date = t.dueDate;
  const start_date = t.startDate && ISO_DATE.test(t.startDate) ? t.startDate : null;
  if (t.startDate && !start_date) details.legacy_start_date = t.startDate;
  return {
    title: t.title, status: t.status, priority: t.priority, due_date, start_date, recurring: t.recurring,
    remind_days_before: typeof t.remindDaysBefore === 'number' ? Math.max(0, Math.round(t.remindDaysBefore)) : null,
    remind_off: t.remindDaysBefore === null, notes: t.notes ?? '', sort_order: Number.isFinite(t.order) ? t.order : 0,
    subtasks: t.subs.map((s) => ({ text: s.text, done: s.done })), details, edited_ms: t.updatedAt,
  };
}

/**
 * Lists the writes that make the rows match `merged`. A live row is written when its merged copy
 * differs (so a tie the merge settled is stored as settled); a deleted row comes back only for an
 * edit newer than its deletion; a live row the merge dropped is deleted at its tombstone's time.
 */
export function planSync(rows: Rows, merged: SyncedState, now = Date.now()): SyncPlan {
  const plan: SyncPlan = {
    newWorkspaces: [], workspaceUpdates: [], newProjects: [], projectUpdates: [], newItems: [], itemUpdates: [],
    dependencies: [], deletions: [], refused: [], settings: null,
  };
  const current = rowsToDocument(rows, merged.activeWorkspaceId, now);
  const currentData = allWorkspaceData(current);
  const mergedData = allWorkspaceData(merged);
  const wsRow = new Map(rows.workspaces.map((w) => [w.client_id, w]));
  const currentWorkspaces = new Map(current.workspaces.map((w) => [w.id, w]));

  merged.workspaces.forEach((w, index) => {
    const row = wsRow.get(w.id);
    if (!row) plan.newWorkspaces.push({ client_id: w.id, name: w.name, sort_order: rows.workspaces.length + index, edited_ms: w.updatedAt });
    else if (row.deleted_ms !== null) {
      if (w.updatedAt > row.deleted_ms) plan.workspaceUpdates.push({ id: row.id, name: w.name, edited_ms: w.updatedAt });
      else plan.refused.push(`workspace:${w.id}`);
    } else if (workspaceKey(w) !== workspaceKey(currentWorkspaces.get(w.id)!)) {
      plan.workspaceUpdates.push({ id: row.id, name: w.name, edited_ms: w.updatedAt });
    }
  });
  for (const row of rows.workspaces) {
    const at = merged.deleted[`workspace:${row.client_id}`];
    if (row.deleted_ms === null && !merged.workspaces.some((w) => w.id === row.client_id) && at !== undefined) {
      plan.deletions.push({ table: 'workspaces', id: row.id, deleted_ms: at });
    }
  }

  for (const w of merged.workspaces) {
    const ws = wsRow.get(w.id);
    const { projects = [], tasks = [] } = ownEntry(mergedData, w.id) ?? {};
    const before = ownEntry(currentData, w.id) ?? { projects: [], tasks: [] };
    const projectRows = new Map(rows.projects.filter((p) => p.workspace_id === ws?.id).map((p) => [p.client_id, p]));
    const itemRows = new Map(rows.items.filter((i) => i.workspace_id === ws?.id).map((i) => [i.client_id, i]));
    const legacy = new Map(rows.legacyDeletions.filter((d) => d.workspace_id === ws?.id).map((d) => [`${d.kind}:${d.client_id}`, d.deleted_ms]));
    const currentProjects = new Map(before.projects.map((p) => [p.id, p]));
    const currentTasks = new Map(before.tasks.map((t) => [t.id, t]));

    projects.forEach((p, index) => {
      const row = projectRows.get(p.id);
      const deletedAt = row ? row.deleted_ms : legacy.get(`project:${p.id}`) ?? null;
      if (deletedAt !== null && p.updatedAt <= deletedAt) plan.refused.push(`project:${w.id}:${p.id}`);
      else if (!row) plan.newProjects.push({ workspace: w.id, client_id: p.id, name: p.name, color: p.color, sort_order: projectRows.size + index, edited_ms: p.updatedAt });
      else if (row.deleted_ms !== null || projectKey(w.id, p) !== projectKey(w.id, currentProjects.get(p.id)!)) {
        plan.projectUpdates.push({ id: row.id, name: p.name, color: p.color, edited_ms: p.updatedAt });
      }
    });

    tasks.forEach((t) => {
      const row = itemRows.get(t.id);
      const deletedAt = row ? row.deleted_ms : legacy.get(`task:${t.id}`) ?? null;
      if (deletedAt !== null && t.updatedAt <= deletedAt) {
        plan.refused.push(`task:${w.id}:${t.id}`);
      } else if (!row) {
        // The merge keeps the device's order among new tasks, newest first: earlier means made later.
        plan.newItems.push({ workspace: w.id, client_id: t.id, project: t.project, created_ms: now - plan.newItems.length, ...taskFields(t) });
        plan.dependencies.push({ workspace: w.id, item: t.id, dependsOn: t.deps });
      } else if (row.deleted_ms !== null || taskKey(w.id, t) !== taskKey(w.id, currentTasks.get(t.id)!)) {
        plan.itemUpdates.push({ id: row.id, workspace: w.id, project: t.project, ...taskFields(t) });
        plan.dependencies.push({ workspace: w.id, item: t.id, dependsOn: t.deps });
      }
    });

    // Live rows the merge dropped: deleted at their tombstone's time.
    const liveProjects = new Set(projects.map((p) => p.id));
    const liveTasks = new Set(tasks.map((t) => t.id));
    for (const row of projectRows.values()) {
      const at = merged.deleted[`project:${w.id}:${row.client_id}`];
      if (row.deleted_ms === null && !liveProjects.has(row.client_id) && at !== undefined) plan.deletions.push({ table: 'projects', id: row.id, deleted_ms: at });
    }
    for (const row of itemRows.values()) {
      const at = merged.deleted[`task:${w.id}:${row.client_id}`];
      if (row.deleted_ms === null && !liveTasks.has(row.client_id) && at !== undefined) plan.deletions.push({ table: 'items', id: row.id, deleted_ms: at });
    }
  }

  if (remindersKey(merged.reminders) !== remindersKey(current.reminders)) {
    const { updatedAt, ...reminders } = merged.reminders;
    plan.settings = { reminders, edited_ms: updatedAt };
  }
  return plan;
}

/**
 * The whole sync, inside the caller's withUser() transaction: take this user's sync lock (a
 * second device waits instead of overwriting), read, merge, write, and return the document as
 * stored, with refused stale copies marked deleted now so the device drops them.
 */
export async function syncDocument(db: Queryable, userId: string, incomingRaw: unknown, now = Date.now()): Promise<SyncedState> {
  const incoming = normalizeState(incomingRaw, now);
  await db.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`ledger-sync:${userId}`]);
  const rows = await readRows(db, userId);
  const merged = mergeStates(rowsToDocument(rows, incoming.activeWorkspaceId, now), incoming, incoming.activeWorkspaceId);
  const plan = planSync(rows, merged, now);
  const stored = isEmptyPlan(plan) ? rows : (await applyPlan(db, userId, rows, plan), await readRows(db, userId));
  const reply = rowsToDocument(stored, incoming.activeWorkspaceId, now);
  for (const key of plan.refused) reply.deleted[key] = now;
  return reply;
}

const time = (param: string) => `to_timestamp(${param} / 1000.0)`;

async function applyPlan(db: Queryable, userId: string, rows: Rows, plan: SyncPlan): Promise<void> {
  const wsId = new Map(rows.workspaces.map((w) => [w.client_id, w.id]));
  for (const w of plan.newWorkspaces) {
    const made = await db.query<{ id: string }>(`select app.create_workspace($1, $2, ${time('$3')}) id`, [w.client_id, w.name, w.edited_ms]);
    await db.query('update workspaces set sort_order = $2 where id = $1', [made.rows[0].id, w.sort_order]);
    wsId.set(w.client_id, made.rows[0].id);
  }
  for (const w of plan.workspaceUpdates) {
    await db.query(`update workspaces set name = $2, edited_at = ${time('$3')}, deleted_at = null where id = $1`, [w.id, w.name, w.edited_ms]);
  }

  const projectIds = new Map(rows.projects.map((p) => [`${p.workspace_id}:${p.client_id}`, p.id]));
  for (const p of plan.newProjects) {
    const workspace = wsId.get(p.workspace)!;
    const made = await db.query<{ id: string }>(
      `insert into projects (workspace_id, owner_id, client_id, name, color, sort_order, edited_at) values ($1, $2, $3, $4, $5, $6, ${time('$7')}) returning id`,
      [workspace, userId, p.client_id, p.name, p.color, p.sort_order, p.edited_ms],
    );
    projectIds.set(`${workspace}:${p.client_id}`, made.rows[0].id);
  }
  for (const p of plan.projectUpdates) {
    await db.query(`update projects set name = $2, color = $3, edited_at = ${time('$4')}, deleted_at = null where id = $1`, [p.id, p.name, p.color, p.edited_ms]);
  }

  // A task's project: its row in the same workspace, or a note on the item when there is none.
  const projectFor = (workspace: string, project: string, details: Record<string, unknown>) => {
    const id = projectIds.get(`${workspace}:${project}`) ?? null;
    return { project_id: id, details: id || !project ? details : { ...details, legacy_project: project } };
  };
  const itemIds = new Map(rows.items.map((i) => [`${i.workspace_id}:${i.client_id}`, i.id]));
  const values = (workspace: string, i: SyncPlan['itemUpdates'][number] | SyncPlan['newItems'][number]) => {
    const { project_id, details } = projectFor(workspace, i.project, i.details);
    return [project_id, i.title, i.status, i.priority, i.due_date, i.start_date, i.recurring, i.remind_days_before, i.remind_off,
      i.notes, i.sort_order, JSON.stringify(i.subtasks), JSON.stringify(details), i.edited_ms];
  };
  for (const i of plan.newItems) {
    const workspace = wsId.get(i.workspace)!;
    const made = await db.query<{ id: string }>(
      `insert into items (project_id, title, status, priority, due_date, start_date, recurring, remind_days_before, remind_off, notes,
                          sort_order, subtasks, details, edited_at, workspace_id, owner_id, client_id, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, ${time('$14')}, $15, $16, $17, ${time('$18')}) returning id`,
      [...values(workspace, i), workspace, userId, i.client_id, i.created_ms],
    );
    itemIds.set(`${workspace}:${i.client_id}`, made.rows[0].id);
  }
  for (const i of plan.itemUpdates) {
    await db.query(
      `update items set project_id = $1, title = $2, status = $3, priority = $4, due_date = $5, start_date = $6, recurring = $7,
              remind_days_before = $8, remind_off = $9, notes = $10, sort_order = $11, subtasks = $12, details = $13,
              edited_at = ${time('$14')}, deleted_at = null
        where id = $15`,
      [...values(wsId.get(i.workspace)!, i), i.id],
    );
  }

  for (const d of plan.dependencies) {
    const workspace = wsId.get(d.workspace)!;
    const from = itemIds.get(`${workspace}:${d.item}`)!;
    const wanted = new Set(d.dependsOn.map((c) => itemIds.get(`${workspace}:${c}`)).filter((id): id is string => Boolean(id) && id !== from));
    const have = new Set(rows.links.filter((l) => l.from_id === from).map((l) => l.to_id));
    for (const to of have) if (!wanted.has(to)) await db.query("delete from item_links where from_id = $1 and to_id = $2 and kind = 'depends_on'", [from, to]);
    for (const to of wanted) {
      if (!have.has(to)) await db.query('insert into item_links (workspace_id, owner_id, from_id, to_id) values ($1, $2, $3, $4)', [workspace, userId, from, to]);
    }
  }

  for (const d of plan.deletions) {
    await db.query(`update ${d.table} set deleted_at = ${time('$2')} where id = $1`, [d.id, d.deleted_ms]);
  }

  if (plan.settings) {
    await db.query(
      `insert into user_settings (user_id, reminders, edited_at) values ($1, $2, ${time('$3')})
       on conflict (user_id) do update set reminders = excluded.reminders, edited_at = excluded.edited_at`,
      [userId, JSON.stringify(plan.settings.reminders), plan.settings.edited_ms],
    );
  }
}
