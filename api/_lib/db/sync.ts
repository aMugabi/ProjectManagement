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
import type { Project, Task } from '../../../src/types.js';
import { itemProblem } from '../../../src/shared/itemSchemas.js';
import { signOffProblem } from '../../../src/shared/delivery.js';
import { typeOf } from '../../../src/shared/itemTypes.js';
import { mergeStates } from '../../../src/shared/merge.js';
import { allWorkspaceData, emptySnapshot, normalizeState, ownEntry, type SyncedState } from '../../../src/shared/state.js';
import type { Queryable } from './client.js';
import { pairKey, partnerKey, productKey, projectKey, releaseKey, remindersKey, rowsToDocument, stageKey, taskKey, workspaceKey, type GroupRow, type Rows } from './mapping.js';
import { readRows } from './rows.js';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

type TaskFields = ReturnType<typeof taskFields>;
export type GroupTable = 'projects' | 'products' | 'partners';

/** What a sync writes. Pure: built from the current rows and the merged document. */
export interface SyncPlan {
  newWorkspaces: { client_id: string; name: string; sort_order: number; edited_ms: number }[];
  /** Renames, and deleted workspaces coming back for a newer edit. */
  workspaceUpdates: { id: string; name: string; edited_ms: number }[];
  /** Projects, products and partners. */
  newGroups: { table: GroupTable; workspace: string; client_id: string; name: string; color: string; sort_order: number; edited_ms: number }[];
  groupUpdates: { table: GroupTable; id: string; name: string; color: string; edited_ms: number }[];
  newPairs: { workspace: string; client_id: string; product: string; partner: string; edited_ms: number }[];
  /** A pair's newer edit (or its return after a deletion). */
  pairUpdates: { id: string; edited_ms: number }[];
  newItems: (TaskFields & { workspace: string; client_id: string; created_ms: number })[];
  itemUpdates: (TaskFields & { id: string; workspace: string })[];
  /** For each new or changed item: the full list of items it now depends on (client ids, same workspace). */
  dependencies: { workspace: string; item: string; dependsOn: string[] }[];
  /** Step 3: the stage template, releases and sign-offs (sign-offs are only ever added). */
  newStages: { workspace: string; client_id: string; name: string; sort_order: number; edited_ms: number }[];
  stageUpdates: { id: string; name: string; sort_order: number; edited_ms: number }[];
  newReleases: { workspace: string; client_id: string; product: string; partner: string; name: string; target_date: string | null; edited_ms: number }[];
  releaseUpdates: { id: string; name: string; target_date: string | null; edited_ms: number }[];
  newSignoffs: {
    workspace: string; client_id: string; release: string; stage: string; stage_name: string; outcome: string; approver: string; approver_role: string;
    signed_at: string; evidence_url: string; note: string; corrects: string | null; created_ms: number;
  }[];
  deletions: { table: 'workspaces' | GroupTable | 'product_partners' | 'items' | 'stages' | 'releases'; id: string; deleted_ms: number }[];
  /** Uploaded copies refused because the database holds a newer deletion: tombstone keys for the reply. */
  refused: string[];
  /** Uploaded items, releases and sign-offs not stored because they fail their checks. */
  invalid: { key: string; problem: string }[];
  settings: { reminders: Omit<SyncedState['reminders'], 'updatedAt'>; edited_ms: number } | null;
}

export function isEmptyPlan(plan: SyncPlan): boolean {
  return Object.entries(plan).every(([key, v]) => key === 'refused' || key === 'invalid' || (Array.isArray(v) ? v.length === 0 : v === null));
}

function taskFields(t: Task) {
  // The type's own fields from the device; `legacy_*` keys are the server's notes, never a device's.
  const details: Record<string, unknown> = Object.fromEntries(Object.entries(t.details ?? {}).filter(([k]) => !k.startsWith('legacy_')));
  const due_date = ISO_DATE.test(t.dueDate) ? t.dueDate : null;
  if (!due_date) details.legacy_due_date = t.dueDate;
  const start_date = t.startDate && ISO_DATE.test(t.startDate) ? t.startDate : null;
  if (t.startDate && !start_date) details.legacy_start_date = t.startDate;
  const chase_on = t.chaseOn && ISO_DATE.test(t.chaseOn) ? t.chaseOn : null;
  if (t.chaseOn && !chase_on) details.legacy_chase_on = t.chaseOn;
  const snoozed_until = t.snoozedUntil && ISO_DATE.test(t.snoozedUntil) ? t.snoozedUntil : null;
  if (t.snoozedUntil && !snoozed_until) details.legacy_snoozed_until = t.snoozedUntil;
  const completed_on = t.completedOn && ISO_DATE.test(t.completedOn) ? t.completedOn : null;
  if (t.completedOn && !completed_on) details.legacy_completed_on = t.completedOn;
  const completions = Array.isArray(t.completions) && t.completions.every((d) => ISO_DATE.test(d)) ? t.completions : [];
  if (t.completions !== undefined && completions !== t.completions) details.legacy_completions = t.completions;
  return {
    type: typeOf(t), project: t.project, product: t.product ?? '', partner: t.partner ?? '',
    title: t.title, status: t.status, priority: t.priority, due_date, start_date, recurring: t.recurring,
    remind_days_before: typeof t.remindDaysBefore === 'number' ? Math.max(0, Math.round(t.remindDaysBefore)) : null,
    remind_off: t.remindDaysBefore === null, notes: t.notes ?? '', sort_order: Number.isFinite(t.order) ? t.order : 0,
    subtasks: t.subs.map((s) => ({ text: s.text, done: s.done })), details, edited_ms: t.updatedAt,
    waiting_on: typeof t.waitingOn === 'string' ? t.waitingOn : '', chase_on, snoozed_until, completed_on, completions,
  };
}

/**
 * Lists the writes that make the rows match `merged`. A live row is written when its merged copy
 * differs (so a tie the merge settled is stored as settled); a deleted row comes back only for an
 * edit newer than its deletion; a live row the merge dropped is deleted at its tombstone's time.
 */
export function planSync(rows: Rows, merged: SyncedState, now = Date.now()): SyncPlan {
  const plan: SyncPlan = {
    newWorkspaces: [], workspaceUpdates: [], newGroups: [], groupUpdates: [], newPairs: [], pairUpdates: [], newItems: [], itemUpdates: [],
    dependencies: [], newStages: [], stageUpdates: [], newReleases: [], releaseUpdates: [], newSignoffs: [], deletions: [], refused: [], invalid: [],
    settings: null,
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
    const snap = ownEntry(mergedData, w.id) ?? emptySnapshot();
    const before = ownEntry(currentData, w.id) ?? emptySnapshot();
    const inWs = <T extends { workspace_id: string; client_id: string }>(list: T[]) => new Map(list.filter((r) => r.workspace_id === ws?.id).map((r) => [r.client_id, r]));
    const legacy = new Map(rows.legacyDeletions.filter((d) => d.workspace_id === ws?.id).map((d) => [`${d.kind}:${d.client_id}`, d.deleted_ms]));
    /** The deletion that applies to an uploaded copy, from its row or the old store's memory. */
    const deletedAt = (kind: string, id: string, row: { deleted_ms: number | null } | undefined) => (row ? row.deleted_ms : legacy.get(`${kind}:${id}`) ?? null);
    /** Live rows the merge dropped: deleted at their tombstone's time. */
    const dropped = (kind: string, table: SyncPlan['deletions'][number]['table'], live: Set<string>, rowsInWs: Map<string, { id: string; deleted_ms: number | null }>) => {
      for (const [clientId, row] of rowsInWs) {
        const at = merged.deleted[`${kind}:${w.id}:${clientId}`];
        if (row.deleted_ms === null && !live.has(clientId) && at !== undefined) plan.deletions.push({ table, id: row.id, deleted_ms: at });
      }
    };

    const groupKinds: [string, GroupTable, Project[], GroupRow[], Project[], (ws: string, p: Project) => string][] = [
      ['project', 'projects', snap.projects, rows.projects, before.projects, projectKey],
      ['product', 'products', snap.products, rows.products, before.products, productKey],
      ['partner', 'partners', snap.partners, rows.partners, before.partners, partnerKey],
    ];
    for (const [kind, table, list, allRows, currentList, key] of groupKinds) {
      const rowsInWs = inWs(allRows);
      const currentById = new Map(currentList.map((p) => [p.id, p]));
      list.forEach((p, index) => {
        const row = rowsInWs.get(p.id);
        const at = deletedAt(kind, p.id, row);
        if (at !== null && p.updatedAt <= at) plan.refused.push(`${kind}:${w.id}:${p.id}`);
        else if (!row) plan.newGroups.push({ table, workspace: w.id, client_id: p.id, name: p.name, color: p.color, sort_order: rowsInWs.size + index, edited_ms: p.updatedAt });
        else if (row.deleted_ms !== null || key(w.id, p) !== key(w.id, currentById.get(p.id)!)) {
          plan.groupUpdates.push({ table, id: row.id, name: p.name, color: p.color, edited_ms: p.updatedAt });
        }
      });
      dropped(kind, table, new Set(list.map((p) => p.id)), rowsInWs);
    }

    const pairRows = inWs(rows.pairs);
    const currentPairs = new Map(before.pairs.map((p) => [p.id, p]));
    for (const p of snap.pairs) {
      const row = pairRows.get(p.id);
      const at = deletedAt('pair', p.id, row);
      if (at !== null && p.updatedAt <= at) plan.refused.push(`pair:${w.id}:${p.id}`);
      else if (!row) plan.newPairs.push({ workspace: w.id, client_id: p.id, product: p.product, partner: p.partner, edited_ms: p.updatedAt });
      else if (row.deleted_ms !== null || pairKey(w.id, p) !== pairKey(w.id, currentPairs.get(p.id)!)) plan.pairUpdates.push({ id: row.id, edited_ms: p.updatedAt });
    }
    dropped('pair', 'product_partners', new Set(snap.pairs.map((p) => p.id)), pairRows);

    const itemRows = inWs(rows.items);
    const currentTasks = new Map(before.tasks.map((t) => [t.id, t]));
    for (const t of snap.tasks) {
      const row = itemRows.get(t.id);
      const at = deletedAt('task', t.id, row);
      const changed = !row || row.deleted_ms !== null || taskKey(w.id, t) !== taskKey(w.id, currentTasks.get(t.id)!);
      const problem = changed ? itemProblem(t) : null;
      if (at !== null && t.updatedAt <= at) {
        plan.refused.push(`task:${w.id}:${t.id}`);
      } else if (problem) {
        plan.invalid.push({ key: `task:${w.id}:${t.id}`, problem });
      } else if (!row) {
        // The merge keeps the device's order among new tasks, newest first: earlier means made later.
        plan.newItems.push({ workspace: w.id, client_id: t.id, created_ms: now - plan.newItems.length, ...taskFields(t) });
        plan.dependencies.push({ workspace: w.id, item: t.id, dependsOn: t.deps });
      } else if (changed) {
        plan.itemUpdates.push({ id: row.id, workspace: w.id, ...taskFields(t) });
        plan.dependencies.push({ workspace: w.id, item: t.id, dependsOn: t.deps });
      }
    }
    dropped('task', 'items', new Set(snap.tasks.map((t) => t.id)), itemRows);

    // Step 3. A stage or release: written when new or changed, like a project.
    const stageRows = inWs(rows.stages);
    const currentStages = new Map(before.stages.map((st) => [st.id, st]));
    for (const st of snap.stages) {
      const row = stageRows.get(st.id);
      const at = deletedAt('stage', st.id, row);
      const order = Number.isFinite(st.order) ? st.order : 0;
      if (at !== null && st.updatedAt <= at) plan.refused.push(`stage:${w.id}:${st.id}`);
      else if (!st.name.trim()) plan.invalid.push({ key: `stage:${w.id}:${st.id}`, problem: 'a stage needs a name' });
      else if (!row) plan.newStages.push({ workspace: w.id, client_id: st.id, name: st.name.trim(), sort_order: order, edited_ms: st.updatedAt });
      else if (row.deleted_ms !== null || stageKey(w.id, st) !== stageKey(w.id, currentStages.get(st.id)!)) {
        plan.stageUpdates.push({ id: row.id, name: st.name.trim(), sort_order: order, edited_ms: st.updatedAt });
      }
    }
    dropped('stage', 'stages', new Set(snap.stages.map((st) => st.id)), stageRows);

    const releaseRows = inWs(rows.releases);
    const currentReleases = new Map(before.releases.map((r) => [r.id, r]));
    const pairExists = (id: string) => pairRows.has(id) || plan.newPairs.some((p) => p.workspace === w.id && p.client_id === id);
    for (const r of snap.releases) {
      const row = releaseRows.get(r.id);
      const at = deletedAt('release', r.id, row);
      const key = `release:${w.id}:${r.id}`;
      const current = currentReleases.get(r.id);
      const target_date = r.targetDate && ISO_DATE.test(r.targetDate) ? r.targetDate : null;
      const problem = !r.name.trim()
        ? 'a release needs a name'
        : r.targetDate && !target_date
          ? `target date ${JSON.stringify(r.targetDate)} isn't YYYY-MM-DD`
          : !pairExists(`${r.product}+${r.partner}`)
            ? `${r.product} and ${r.partner} aren't a pair`
            : current && (current.product !== r.product || current.partner !== r.partner)
              ? "a release can't move to another product or partner"
              : null;
      if (at !== null && r.updatedAt <= at) plan.refused.push(key);
      else if (!row && problem) plan.invalid.push({ key, problem });
      else if (!row) plan.newReleases.push({ workspace: w.id, client_id: r.id, product: r.product, partner: r.partner, name: r.name.trim(), target_date, edited_ms: r.updatedAt });
      else if (row.deleted_ms !== null || releaseKey(w.id, r) !== releaseKey(w.id, current!)) {
        if (problem) plan.invalid.push({ key, problem });
        else plan.releaseUpdates.push({ id: row.id, name: r.name.trim(), target_date, edited_ms: r.updatedAt });
      }
    }
    dropped('release', 'releases', new Set(snap.releases.map((r) => r.id)), releaseRows);

    // A sign-off is written once and never changed; one the database holds is left as it is.
    const signoffRows = inWs(rows.signoffs);
    const stageKnown = (id: string) => stageRows.has(id) || plan.newStages.some((st) => st.workspace === w.id && st.client_id === id);
    const releaseKnown = (id: string) => releaseRows.has(id) || plan.newReleases.some((r) => r.workspace === w.id && r.client_id === id);
    const signoffKnown = (id: string) => signoffRows.has(id) || plan.newSignoffs.some((so) => so.workspace === w.id && so.client_id === id);
    for (const so of snap.signoffs) {
      if (signoffRows.has(so.id)) continue;
      const problem =
        signOffProblem(so) ??
        (!releaseKnown(so.release)
          ? 'its release is missing'
          : !stageKnown(so.stage)
            ? 'its stage is missing'
            : so.corrects && !signoffKnown(so.corrects)
              ? 'the sign-off it corrects is missing'
              : null);
      if (problem) {
        plan.invalid.push({ key: `signoff:${w.id}:${so.id}`, problem });
        continue;
      }
      plan.newSignoffs.push({
        workspace: w.id, client_id: so.id, release: so.release, stage: so.stage, stage_name: so.stageName, outcome: so.outcome, approver: so.approver,
        approver_role: so.role ?? '', signed_at: so.signedAt, evidence_url: so.evidence ?? '', note: so.note ?? '', corrects: so.corrects ?? null,
        created_ms: so.updatedAt,
      });
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
  for (const { key, problem } of plan.invalid) console.warn(`Sync: not stored, ${key}: ${problem}`);
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

  // Projects, products and partners: '<table>:<workspace uuid>:<client id>' → uuid.
  const groupIds = new Map<string, string>();
  for (const [table, list] of [['projects', rows.projects], ['products', rows.products], ['partners', rows.partners]] as const) {
    for (const r of list) groupIds.set(`${table}:${r.workspace_id}:${r.client_id}`, r.id);
  }
  for (const g of plan.newGroups) {
    const workspace = wsId.get(g.workspace)!;
    const made = await db.query<{ id: string }>(
      `insert into ${g.table} (workspace_id, owner_id, client_id, name, color, sort_order, edited_at) values ($1, $2, $3, $4, $5, $6, ${time('$7')}) returning id`,
      [workspace, userId, g.client_id, g.name, g.color, g.sort_order, g.edited_ms],
    );
    groupIds.set(`${g.table}:${workspace}:${g.client_id}`, made.rows[0].id);
  }
  for (const g of plan.groupUpdates) {
    await db.query(`update ${g.table} set name = $2, color = $3, edited_at = ${time('$4')}, deleted_at = null where id = $1`, [g.id, g.name, g.color, g.edited_ms]);
  }

  // Pairs: '<product uuid>|<partner uuid>', for checking that an item's product and partner are one.
  const pairIds = new Set(rows.pairs.map((p) => `${p.product_id}|${p.partner_id}`));
  for (const p of plan.newPairs) {
    const workspace = wsId.get(p.workspace)!;
    const product = groupIds.get(`products:${workspace}:${p.product}`)!;
    const partner = groupIds.get(`partners:${workspace}:${p.partner}`)!;
    await db.query(
      `insert into product_partners (workspace_id, owner_id, client_id, product_id, partner_id, edited_at) values ($1, $2, $3, $4, $5, ${time('$6')})`,
      [workspace, userId, p.client_id, product, partner, p.edited_ms],
    );
    pairIds.add(`${product}|${partner}`);
  }
  for (const p of plan.pairUpdates) {
    await db.query(`update product_partners set edited_at = ${time('$2')}, deleted_at = null where id = $1`, [p.id, p.edited_ms]);
  }

  /**
   * Where an item goes: a plain project, or a product and/or partner (both only as a pair), as
   * the database requires; whatever can't be placed is kept in the details as a note.
   */
  const place = (workspace: string, i: SyncPlan['newItems'][number] | SyncPlan['itemUpdates'][number]) => {
    const details = { ...i.details };
    const project_id = groupIds.get(`projects:${workspace}:${i.project}`) ?? null;
    let product_id = i.product ? (groupIds.get(`products:${workspace}:${i.product}`) ?? null) : null;
    let partner_id = i.partner ? (groupIds.get(`partners:${workspace}:${i.partner}`) ?? null) : null;
    if (!project_id && i.project) details.legacy_project = i.project;
    if (i.product && !product_id) details.legacy_product = i.product;
    if (i.partner && !partner_id) details.legacy_partner = i.partner;
    if (project_id && (product_id || partner_id)) {
      if (product_id) details.legacy_product = i.product;
      if (partner_id) details.legacy_partner = i.partner;
      product_id = partner_id = null;
    }
    if (product_id && partner_id && !pairIds.has(`${product_id}|${partner_id}`)) {
      details.legacy_partner = i.partner;
      partner_id = null;
    }
    return [i.type, project_id, product_id, partner_id, i.title, i.status, i.priority, i.due_date, i.start_date, i.recurring,
      i.remind_days_before, i.remind_off, i.notes, i.sort_order, JSON.stringify(i.subtasks), JSON.stringify(details), i.edited_ms,
      i.waiting_on, i.chase_on, i.snoozed_until, i.completed_on, i.completions];
  };
  const itemIds = new Map(rows.items.map((i) => [`${i.workspace_id}:${i.client_id}`, i.id]));
  for (const i of plan.newItems) {
    const workspace = wsId.get(i.workspace)!;
    const made = await db.query<{ id: string }>(
      `insert into items (type, project_id, product_id, partner_id, title, status, priority, due_date, start_date, recurring, remind_days_before,
                          remind_off, notes, sort_order, subtasks, details, edited_at, waiting_on, chase_on, snoozed_until, completed_on, completions,
                          workspace_id, owner_id, client_id, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, ${time('$17')}, $18, $19, $20, $21, $22,
               $23, $24, $25, ${time('$26')}) returning id`,
      [...place(workspace, i), workspace, userId, i.client_id, i.created_ms],
    );
    itemIds.set(`${workspace}:${i.client_id}`, made.rows[0].id);
  }
  for (const i of plan.itemUpdates) {
    await db.query(
      `update items set type = $1, project_id = $2, product_id = $3, partner_id = $4, title = $5, status = $6, priority = $7, due_date = $8,
              start_date = $9, recurring = $10, remind_days_before = $11, remind_off = $12, notes = $13, sort_order = $14, subtasks = $15,
              details = $16, edited_at = ${time('$17')}, waiting_on = $18, chase_on = $19, snoozed_until = $20, completed_on = $21,
              completions = $22, deleted_at = null
        where id = $23`,
      [...place(wsId.get(i.workspace)!, i), i.id],
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

  // Step 3: stages and releases (on pairs, which exist by now), then sign-offs in order.
  const stepIds = new Map<string, string>();
  for (const [table, list] of [['stages', rows.stages], ['releases', rows.releases], ['signoffs', rows.signoffs]] as const) {
    for (const r of list) stepIds.set(`${table}:${r.workspace_id}:${r.client_id}`, r.id);
  }
  for (const st of plan.newStages) {
    const workspace = wsId.get(st.workspace)!;
    const made = await db.query<{ id: string }>(
      `insert into stages (workspace_id, owner_id, client_id, name, sort_order, edited_at) values ($1, $2, $3, $4, $5, ${time('$6')}) returning id`,
      [workspace, userId, st.client_id, st.name, st.sort_order, st.edited_ms],
    );
    stepIds.set(`stages:${workspace}:${st.client_id}`, made.rows[0].id);
  }
  for (const st of plan.stageUpdates) {
    await db.query(`update stages set name = $2, sort_order = $3, edited_at = ${time('$4')}, deleted_at = null where id = $1`, [st.id, st.name, st.sort_order, st.edited_ms]);
  }
  for (const r of plan.newReleases) {
    const workspace = wsId.get(r.workspace)!;
    const made = await db.query<{ id: string }>(
      `insert into releases (workspace_id, owner_id, client_id, product_id, partner_id, name, target_date, edited_at)
       values ($1, $2, $3, $4, $5, $6, $7, ${time('$8')}) returning id`,
      [workspace, userId, r.client_id, groupIds.get(`products:${workspace}:${r.product}`), groupIds.get(`partners:${workspace}:${r.partner}`), r.name, r.target_date, r.edited_ms],
    );
    stepIds.set(`releases:${workspace}:${r.client_id}`, made.rows[0].id);
  }
  for (const r of plan.releaseUpdates) {
    await db.query(`update releases set name = $2, target_date = $3, edited_at = ${time('$4')}, deleted_at = null where id = $1`, [r.id, r.name, r.target_date, r.edited_ms]);
  }
  for (const so of plan.newSignoffs) {
    const workspace = wsId.get(so.workspace)!;
    const made = await db.query<{ id: string }>(
      `insert into signoffs (workspace_id, owner_id, client_id, release_id, stage_id, stage_name, outcome, approver, approver_role, signed_at, evidence_url,
                             note, corrects_id, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, ${time('$14')}) returning id`,
      [workspace, userId, so.client_id, stepIds.get(`releases:${workspace}:${so.release}`), stepIds.get(`stages:${workspace}:${so.stage}`), so.stage_name,
        so.outcome, so.approver, so.approver_role, so.signed_at, so.evidence_url, so.note,
        so.corrects ? stepIds.get(`signoffs:${workspace}:${so.corrects}`) : null, so.created_ms],
    );
    stepIds.set(`signoffs:${workspace}:${so.client_id}`, made.rows[0].id);
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
