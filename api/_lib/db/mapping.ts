/**
 * Between the synced JSON document (SyncedState) and the Postgres rows of db/migrations. Pure: no
 * database, so the import can be checked by a round trip (document → rows → document) before it
 * touches anything.
 *
 * Times are milliseconds here (the document's updatedAt and tombstone stamps) and timestamptz in
 * the database; the SQL layer converts at the boundary, exactly to the millisecond. Anything the
 * database can't hold exactly (a missing project, a date that isn't a date) is kept in the item's
 * details under a `legacy_` key, so the document comes back unchanged. Releases and sign-offs
 * (Step 3) are records with nowhere to keep such notes: one that can't be stored exactly is left
 * out with a note, so the before/after check fails and the import stops.
 */
import type { ItemType, Priority, Project, ProductPartner, Recurring, Release, ReminderSettings, SignOff, SignOffOutcome, Stage, Status, Task, Workspace } from '../../../src/types.js';
import { createHash } from 'node:crypto';
import { itemProblem } from '../../../src/shared/itemSchemas.js';
import { signOffProblem } from '../../../src/shared/delivery.js';
import { firstStatus, isDone, statusAllowed, typeOf } from '../../../src/shared/itemTypes.js';
import { mergeStates } from '../../../src/shared/merge.js';
import { DEFAULT_REMINDERS, allWorkspaceData, emptySnapshot, normalizeState, ownEntry, type SyncedState } from '../../../src/shared/state.js';

export interface WorkspaceRow {
  id: string;
  owner_id: string;
  client_id: string;
  name: string;
  sort_order: number;
  edited_ms: number;
  deleted_ms: number | null;
}
/** A project, product or partner: a name and a colour in a workspace. */
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
export type GroupRow = ProjectRow;
export interface PairRow {
  id: string;
  workspace_id: string;
  owner_id: string;
  /** As devices name it: `${product}+${partner}`. */
  client_id: string;
  product_id: string;
  partner_id: string;
  edited_ms: number;
  deleted_ms: number | null;
}
export interface ItemRow {
  id: string;
  workspace_id: string;
  owner_id: string;
  client_id: string;
  type: ItemType;
  project_id: string | null;
  product_id: string | null;
  partner_id: string | null;
  title: string;
  status: Status;
  priority: Priority;
  due_date: string | null;
  start_date: string | null;
  /** Step 2: '' = nobody. */
  waiting_on: string;
  chase_on: string | null;
  snoozed_until: string | null;
  recurring: Recurring;
  remind_days_before: number | null;
  remind_off: boolean;
  notes: string;
  sort_order: number;
  subtasks: Task['subs'];
  /** The type's own fields, plus `legacy_*` keys for what the columns couldn't hold. */
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
/** A stage of a workspace's delivery template (Step 3). */
export interface StageRow {
  id: string;
  workspace_id: string;
  owner_id: string;
  client_id: string;
  name: string;
  sort_order: number;
  edited_ms: number;
  deleted_ms: number | null;
}
export interface ReleaseRow {
  id: string;
  workspace_id: string;
  owner_id: string;
  client_id: string;
  product_id: string;
  partner_id: string;
  name: string;
  target_date: string | null;
  edited_ms: number;
  deleted_ms: number | null;
}
/** Never edited or deleted; `created_ms` is the app's updatedAt (when it was recorded). */
export interface SignOffRow {
  id: string;
  workspace_id: string;
  owner_id: string;
  client_id: string;
  release_id: string;
  stage_id: string;
  stage_name: string;
  outcome: SignOffOutcome;
  approver: string;
  approver_role: string;
  /** 'YYYY-MM-DDTHH:MM', as the app holds it. */
  signed_at: string;
  evidence_url: string;
  note: string;
  corrects_id: string | null;
  created_ms: number;
}
export type DeletionKind = 'task' | 'project' | 'product' | 'partner' | 'pair' | 'stage' | 'release';
export interface LegacyDeletionRow {
  workspace_id: string;
  kind: DeletionKind;
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
  products: GroupRow[];
  partners: GroupRow[];
  pairs: PairRow[];
  items: ItemRow[];
  links: LinkRow[];
  stages: StageRow[];
  releases: ReleaseRow[];
  signoffs: SignOffRow[];
  legacyDeletions: LegacyDeletionRow[];
  settings: SettingsRow | null;
}

export function emptyRows(): Rows {
  return {
    workspaces: [], projects: [], products: [], partners: [], pairs: [], items: [], links: [], stages: [], releases: [], signoffs: [],
    legacyDeletions: [], settings: null,
  };
}

/** Things the import changed or couldn't carry over exactly; the dry run prints them. */
export interface ImportNote {
  where: string;
  note: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const COLOR = /^#[0-9a-fA-F]{6}$/;
const PRIORITIES = new Set<Priority>(['high', 'med', 'low']);
const RECURRING = new Set(['weekly', 'monthly', 'yearly']);
const KINDS = new Set<string>(['task', 'project', 'product', 'partner', 'pair', 'stage', 'release']);
const LEGACY = 'legacy_';

/** Tombstone keys: '<kind>:<workspace>:<id>' or 'workspace:<id>'. Ids may contain ':'. */
function parseTombstone(key: string): { kind: string; workspace: string; id: string } | null {
  const [kind, ...rest] = key.split(':');
  if (kind === 'workspace' && rest.length) return { kind, workspace: rest.join(':'), id: rest.join(':') };
  if (KINDS.has(kind) && rest.length >= 2) return { kind, workspace: rest[0], id: rest.slice(1).join(':') };
  return null;
}

/** The type's own fields, without the import's `legacy_*` notes. */
function clientDetails(details: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(details).filter(([k]) => !k.startsWith(LEGACY)));
}

/**
 * The rows for one user's document. `newId` makes uuids (injected so tests are repeatable).
 * Keeps everything: every workspace, project, product, partner, pair and item with its edit time,
 * every dependency, every remembered deletion, and the reminder settings.
 */
export function documentToRows(raw: unknown, ownerId: string, newId: () => string, now = Date.now()): { rows: Rows; notes: ImportNote[] } {
  const state = normalizeState(raw);
  const notes: ImportNote[] = [];
  const rows = emptyRows();
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
    const snap = ownEntry(data, w.id) ?? emptySnapshot();

    const groups = (list: Project[], target: GroupRow[], defaultColor: string) => {
      const ids = new Map<string, string>();
      list.forEach((p, i) => {
        const id = newId();
        ids.set(p.id, id);
        let color = p.color;
        if (!COLOR.test(color)) {
          notes.push({ where: `${w.id}/${p.id}`, note: `colour ${JSON.stringify(color)} isn't #rrggbb; using the default` });
          color = defaultColor;
        }
        target.push({ id, workspace_id: wsId, owner_id: ownerId, client_id: p.id, name: p.name.trim() || p.id, color, sort_order: i, edited_ms: p.updatedAt, deleted_ms: null });
      });
      return ids;
    };
    const projectIds = groups(snap.projects, rows.projects, '#b4674a');
    const productIds = groups(snap.products, rows.products, '#b4674a');
    const partnerIds = groups(snap.partners, rows.partners, '#4f7a86');

    const pairIds = new Map<string, string>();
    for (const p of snap.pairs) {
      // normalizeState keeps only pairs whose product and partner exist here.
      const id = newId();
      pairIds.set(`${productIds.get(p.product)}|${partnerIds.get(p.partner)}`, id);
      rows.pairs.push({
        id, workspace_id: wsId, owner_id: ownerId, client_id: p.id, product_id: productIds.get(p.product)!, partner_id: partnerIds.get(p.partner)!,
        edited_ms: p.updatedAt, deleted_ms: null,
      });
    }

    const itemIds = new Map<string, string>();
    for (const [index, t] of snap.tasks.entries()) {
      const id = newId();
      itemIds.set(t.id, id);
      const where = `${w.id}/${t.id}`;
      const own = t.details && typeof t.details === 'object' ? clientDetails(t.details) : {};
      const details: Record<string, unknown> = { ...own };
      const type = typeOf(t);
      const problem = itemProblem(t);
      if (problem) notes.push({ where, note: `${problem}; kept as it is` });

      let projectId = projectIds.get(t.project) ?? null;
      let productId = t.product ? (productIds.get(t.product) ?? null) : null;
      let partnerId = t.partner ? (partnerIds.get(t.partner) ?? null) : null;
      // Kept so the document comes back exactly, though the project itself is gone.
      if (!projectId) {
        details.legacy_project = t.project;
        if (t.project) notes.push({ where, note: `project ${JSON.stringify(t.project)} doesn't exist; kept as a note on the item` });
      }
      if (t.product && !productId) {
        details.legacy_product = t.product;
        notes.push({ where, note: `product ${JSON.stringify(t.product)} doesn't exist; kept as a note` });
      }
      if (t.partner && !partnerId) {
        details.legacy_partner = t.partner;
        notes.push({ where, note: `partner ${JSON.stringify(t.partner)} doesn't exist; kept as a note` });
      }
      // The database allows a plain project or a product/partner, and both of those only as a pair.
      if (projectId && (productId || partnerId)) {
        if (productId) details.legacy_product = t.product;
        if (partnerId) details.legacy_partner = t.partner;
        productId = partnerId = null;
        notes.push({ where, note: 'in a plain project and a product or partner at once; the product and partner kept as notes' });
      }
      if (productId && partnerId && !pairIds.has(`${productId}|${partnerId}`)) {
        details.legacy_partner = t.partner;
        partnerId = null;
        notes.push({ where, note: `${t.product} and ${t.partner} aren't a pair; the partner kept as a note` });
      }

      const dueDate = ISO_DATE.test(t.dueDate) ? t.dueDate : null;
      if (!dueDate) {
        details.legacy_due_date = t.dueDate;
        notes.push({ where, note: `due date ${JSON.stringify(t.dueDate)} isn't YYYY-MM-DD; kept as a note` });
      }
      const status = statusAllowed(type, t.status) ? t.status : firstStatus(type);
      if (status !== t.status) notes.push({ where, note: `status ${JSON.stringify(t.status)} isn't one a ${type} can have; set to ${status}` });
      const priority = PRIORITIES.has(t.priority) ? t.priority : 'med';
      if (priority !== t.priority) notes.push({ where, note: `priority ${JSON.stringify(t.priority)} unknown; set to med` });
      const recurring = t.recurring && RECURRING.has(t.recurring) ? t.recurring : null;
      const startDate = t.startDate && ISO_DATE.test(t.startDate) ? t.startDate : null;
      if (t.startDate && !startDate) details.legacy_start_date = t.startDate;
      const chaseOn = t.chaseOn && ISO_DATE.test(t.chaseOn) ? t.chaseOn : null;
      if (t.chaseOn && !chaseOn) details.legacy_chase_on = t.chaseOn;
      const snoozedUntil = t.snoozedUntil && ISO_DATE.test(t.snoozedUntil) ? t.snoozedUntil : null;
      if (t.snoozedUntil && !snoozedUntil) details.legacy_snoozed_until = t.snoozedUntil;
      rows.items.push({
        id, workspace_id: wsId, owner_id: ownerId, client_id: t.id, type, project_id: projectId, product_id: productId, partner_id: partnerId,
        title: t.title, status, priority, due_date: dueDate, start_date: startDate, recurring,
        waiting_on: typeof t.waitingOn === 'string' ? t.waitingOn : '', chase_on: chaseOn, snoozed_until: snoozedUntil,
        remind_days_before: typeof t.remindDaysBefore === 'number' ? Math.max(0, Math.round(t.remindDaysBefore)) : null,
        remind_off: t.remindDaysBefore === null,
        notes: t.notes ?? '', sort_order: Number.isFinite(t.order) ? t.order : 0,
        subtasks: Array.isArray(t.subs) ? t.subs : [], details, created_ms: now - index, edited_ms: t.updatedAt, deleted_ms: null,
      });
    }
    for (const t of snap.tasks) {
      for (const dep of new Set(t.deps)) {
        const to = itemIds.get(dep);
        if (to && dep !== t.id) rows.links.push({ workspace_id: wsId, owner_id: ownerId, from_id: itemIds.get(t.id)!, to_id: to, kind: 'depends_on' });
      }
    }

    // Step 3: the stage template, releases (each on its pair) and sign-offs (each on a release and
    // stage, a correction after the one it corrects).
    const stageIds = new Map<string, string>();
    for (const st of snap.stages) {
      const id = newId();
      stageIds.set(st.id, id);
      if (!st.name.trim() || !Number.isFinite(st.order)) notes.push({ where: `${w.id}/stage ${st.id}`, note: 'stage without a name or order; stored with its id and order 0' });
      rows.stages.push({
        id, workspace_id: wsId, owner_id: ownerId, client_id: st.id, name: st.name.trim() || st.id, sort_order: Number.isFinite(st.order) ? st.order : 0,
        edited_ms: st.updatedAt, deleted_ms: null,
      });
    }
    const releaseIds = new Map<string, string>();
    for (const r of snap.releases) {
      const product = productIds.get(r.product);
      const partner = partnerIds.get(r.partner);
      const where = `${w.id}/release ${r.id}`;
      if (!product || !partner || !pairIds.has(`${product}|${partner}`)) {
        notes.push({ where, note: `${r.product} and ${r.partner} aren't a pair here; the release can't be stored` });
        continue;
      }
      if (r.targetDate && !ISO_DATE.test(r.targetDate)) notes.push({ where, note: `target date ${JSON.stringify(r.targetDate)} isn't YYYY-MM-DD; left out` });
      const id = newId();
      releaseIds.set(r.id, id);
      rows.releases.push({
        id, workspace_id: wsId, owner_id: ownerId, client_id: r.id, product_id: product, partner_id: partner, name: r.name.trim() || r.id,
        target_date: r.targetDate && ISO_DATE.test(r.targetDate) ? r.targetDate : null, edited_ms: r.updatedAt, deleted_ms: null,
      });
    }
    const signoffIds = new Map<string, string>();
    for (const so of snap.signoffs) {
      const where = `${w.id}/sign-off ${so.id}`;
      const release = releaseIds.get(so.release);
      const stage = stageIds.get(so.stage);
      const corrects = so.corrects ? signoffIds.get(so.corrects) : null;
      const problem = signOffProblem(so) ?? (!release ? 'its release is missing' : !stage ? 'its stage is missing' : corrects === undefined ? 'the sign-off it corrects is missing' : null);
      if (problem) {
        notes.push({ where, note: `${problem}; it can't be stored` });
        continue;
      }
      const id = newId();
      signoffIds.set(so.id, id);
      rows.signoffs.push({
        id, workspace_id: wsId, owner_id: ownerId, client_id: so.id, release_id: release!, stage_id: stage!, stage_name: so.stageName, outcome: so.outcome,
        approver: so.approver, approver_role: so.role ?? '', signed_at: so.signedAt, evidence_url: so.evidence ?? '', note: so.note ?? '',
        corrects_id: corrects ?? null, created_ms: so.updatedAt,
      });
    }

    // A deletion newer than the surviving copy wins (as in merge.ts); otherwise it is remembered.
    const liveRow = (kind: string, id: string): { edited_ms: number; deleted_ms: number | null } | undefined => {
      const list = { task: rows.items, project: rows.projects, product: rows.products, partner: rows.partners, pair: rows.pairs, stage: rows.stages, release: rows.releases }[kind] as
        { workspace_id: string; client_id: string; edited_ms: number; deleted_ms: number | null }[];
      return list.find((r) => r.workspace_id === wsId && r.client_id === id);
    };
    for (const { at, t } of tombstones) {
      if (!t || t.kind === 'workspace' || t.workspace !== w.id) continue;
      const live = liveRow(t.kind, t.id);
      if (live && at >= live.edited_ms) live.deleted_ms = at;
      else if (!live) rows.legacyDeletions.push({ workspace_id: wsId, kind: t.kind as DeletionKind, client_id: t.id, deleted_ms: at });
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
    const inWs = <T extends { workspace_id: string }>(list: T[]) => list.filter((r) => r.workspace_id === w.id);
    const projects = inWs(rows.projects);
    const products = inWs(rows.products);
    const partners = inWs(rows.partners);
    const pairs = inWs(rows.pairs);
    const items = inWs(rows.items);
    const stages = inWs(rows.stages);
    const releases = inWs(rows.releases);
    const signoffs = inWs(rows.signoffs);
    const client = (list: { id: string; client_id: string }[]) => new Map(list.map((r) => [r.id, r.client_id]));
    const projectClient = client(projects);
    const productClient = client(products);
    const partnerClient = client(partners);
    const itemClient = new Map(items.filter((i) => i.deleted_ms === null).map((i) => [i.id, i.client_id]));
    const deps = new Map<string, string[]>();
    for (const l of rows.links) {
      const to = itemClient.get(l.to_id);
      if (l.workspace_id === w.id && to) deps.set(l.from_id, [...(deps.get(l.from_id) ?? []), to]);
    }

    const tombstones = (kind: DeletionKind, list: { client_id: string; deleted_ms: number | null }[]) => {
      for (const r of list) if (r.deleted_ms !== null) deleted[`${kind}:${w.client_id}:${r.client_id}`] = r.deleted_ms;
    };
    tombstones('project', projects);
    tombstones('product', products);
    tombstones('partner', partners);
    tombstones('pair', pairs);
    tombstones('task', items);
    tombstones('stage', stages);
    tombstones('release', releases);
    for (const d of rows.legacyDeletions) {
      if (d.workspace_id === w.id) deleted[`${d.kind}:${w.client_id}:${d.client_id}`] = d.deleted_ms;
    }

    const groups = (list: GroupRow[]): Project[] =>
      list
        .filter((p) => p.deleted_ms === null)
        .sort(bySort)
        .map((p) => ({ id: p.client_id, name: p.name, color: p.color, updatedAt: p.edited_ms }));

    const stageClient = client(stages);
    const releaseClient = client(releases);
    const signoffClient = client(signoffs);
    workspaceData[w.client_id] = {
      stages: stages
        .filter((st) => st.deleted_ms === null)
        .sort(bySort)
        .map((st): Stage => ({ id: st.client_id, name: st.name, order: st.sort_order, updatedAt: st.edited_ms })),
      releases: releases
        .filter((r) => r.deleted_ms === null)
        .sort((a, b) => a.client_id.localeCompare(b.client_id))
        .map((r): Release => ({
          id: r.client_id, product: productClient.get(r.product_id)!, partner: partnerClient.get(r.partner_id)!, name: r.name,
          ...(r.target_date ? { targetDate: r.target_date } : {}), updatedAt: r.edited_ms,
        })),
      signoffs: [...signoffs]
        .sort((a, b) => a.created_ms - b.created_ms || a.client_id.localeCompare(b.client_id))
        .map((so): SignOff => ({
          id: so.client_id, release: releaseClient.get(so.release_id)!, stage: stageClient.get(so.stage_id)!, stageName: so.stage_name, outcome: so.outcome,
          approver: so.approver, role: so.approver_role, signedAt: so.signed_at, evidence: so.evidence_url, note: so.note,
          ...(so.corrects_id ? { corrects: signoffClient.get(so.corrects_id)! } : {}), updatedAt: so.created_ms,
        })),
      projects: groups(projects),
      products: groups(products),
      partners: groups(partners),
      pairs: pairs
        .filter((p) => p.deleted_ms === null)
        .sort((a, b) => a.client_id.localeCompare(b.client_id))
        .map((p): ProductPartner => ({ id: p.client_id, product: productClient.get(p.product_id)!, partner: partnerClient.get(p.partner_id)!, updatedAt: p.edited_ms })),
      tasks: items
        .filter((i) => i.deleted_ms === null)
        .sort((a, b) => b.created_ms - a.created_ms || a.client_id.localeCompare(b.client_id))
        .map((i): Task => {
          const task: Task = {
            id: i.client_id,
            project: (i.project_id && projectClient.get(i.project_id)) || String(i.details.legacy_project ?? ''),
            title: i.title,
            status: i.status,
            priority: i.priority,
            dueDate: i.due_date ?? String(i.details.legacy_due_date ?? ''),
            // jsonb keeps object keys in its own order; rebuild each subtask in the app's shape.
            subs: i.subtasks.map((sub) => ({ text: sub.text, done: sub.done })),
            recurring: i.recurring,
            deps: deps.get(i.id) ?? [],
            notes: i.notes,
            order: i.sort_order,
            updatedAt: i.edited_ms,
          };
          // Only what an item has: a task keeps exactly the shape it had before Step 1b.
          if (i.type !== 'task') task.type = i.type;
          const product = (i.product_id && productClient.get(i.product_id)) || (i.details.legacy_product as string | undefined);
          const partner = (i.partner_id && partnerClient.get(i.partner_id)) || (i.details.legacy_partner as string | undefined);
          if (product) task.product = product;
          if (partner) task.partner = partner;
          const own = clientDetails(i.details);
          if (Object.keys(own).length) task.details = own;
          const start = i.start_date ?? (i.details.legacy_start_date as string | undefined);
          if (start) task.startDate = start;
          if (i.waiting_on) task.waitingOn = i.waiting_on;
          const chase = i.chase_on ?? (i.details.legacy_chase_on as string | undefined);
          if (chase) task.chaseOn = chase;
          const snooze = i.snoozed_until ?? (i.details.legacy_snoozed_until as string | undefined);
          if (snooze) task.snoozedUntil = snooze;
          if (i.remind_off) task.remindDaysBefore = null;
          else if (i.remind_days_before !== null) task.remindDaysBefore = i.remind_days_before;
          return task;
        }),
    };
  }

  const workspaces = liveWorkspaces.map((w) => ({ id: w.client_id, name: w.name, updatedAt: w.edited_ms }));
  const active = workspaces.some((w) => w.id === activeWorkspaceId) ? activeWorkspaceId! : (workspaces[0]?.id ?? 'default');
  const activeData = ownEntry(workspaceData, active) ?? emptySnapshot();
  const reminders: ReminderSettings = rows.settings
    ? { ...DEFAULT_REMINDERS, ...rows.settings.reminders, updatedAt: rows.settings.edited_ms }
    : DEFAULT_REMINDERS;
  return normalizeState(
    {
      ...activeData,
      workspaces,
      activeWorkspaceId: active,
      workspaceData: Object.fromEntries(Object.entries(workspaceData).filter(([id]) => id !== active)),
      deleted,
      reminders,
    },
    now,
  );
}

/** JSON with object keys sorted, so equal data gives equal text (jsonb reorders keys). */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/**
 * One line per thing, holding every field the app shows or syncs: equal lines mean equal data.
 * Used by the before/after checksum and by sync to decide what changed.
 */
export const workspaceKey = (w: Workspace) => ['w', w.id, w.name, w.updatedAt].join('|');
export const projectKey = (workspace: string, p: Project) => ['p', workspace, p.id, p.name, p.color, p.updatedAt].join('|');
export const productKey = (workspace: string, p: Project) => ['P', workspace, p.id, p.name, p.color, p.updatedAt].join('|');
export const partnerKey = (workspace: string, p: Project) => ['Q', workspace, p.id, p.name, p.color, p.updatedAt].join('|');
export const pairKey = (workspace: string, p: ProductPartner) => ['PQ', workspace, p.id, p.product, p.partner, p.updatedAt].join('|');
export function taskKey(workspace: string, t: Task): string {
  const remind = t.remindDaysBefore === undefined ? 'default' : String(t.remindDaysBefore);
  const details = t.details && Object.keys(t.details).length ? canonical(t.details) : '';
  return ['t', workspace, t.id, typeOf(t), t.project, t.product ?? '', t.partner ?? '', t.title, t.status, t.priority, t.dueDate, t.startDate ?? '',
    t.waitingOn ?? '', t.chaseOn ?? '', t.snoozedUntil ?? '', t.recurring ?? '', remind, t.order, t.updatedAt, [...new Set(t.deps)].sort().join(','), JSON.stringify(t.subs.map((sub) => [sub.text, sub.done])),
    t.notes, details].join('|');
}
export const stageKey = (workspace: string, st: Stage) => ['S', workspace, st.id, st.name, st.order, st.updatedAt].join('|');
export const releaseKey = (workspace: string, r: Release) => ['R', workspace, r.id, r.product, r.partner, r.name, r.targetDate ?? '', r.updatedAt].join('|');
export const signoffKey = (workspace: string, so: SignOff) =>
  ['SO', workspace, so.id, so.release, so.stage, so.stageName, so.outcome, so.approver, so.role, so.signedAt, so.evidence, so.note, so.corrects ?? '', so.updatedAt].join('|');
export const remindersKey = (r: ReminderSettings) => `r|${JSON.stringify(Object.entries(r).sort())}`;

export interface WorkspaceSummary {
  workspace: string;
  projects: number;
  products: number;
  partners: number;
  pairs: number;
  /** Items of every type. */
  tasks: number;
  done: number;
  dependencies: number;
  stages: number;
  releases: number;
  signoffs: number;
  deletions: number;
}

/**
 * What the before/after comparison checks: counts per workspace, and one checksum over every
 * workspace, project, product, partner, pair and item (every field), every deletion and the
 * reminder settings. The app's own merge rule is applied first, so a deletion that a later edit
 * has overridden doesn't count. Equal summaries mean nothing was lost or changed. (Item order
 * within the list isn't compared: the views sort it.)
 */
export function summariseDocument(raw: unknown, now = Date.now()): { workspaces: WorkspaceSummary[]; checksum: string } {
  const normal = normalizeState(raw, now);
  const state = mergeStates(normal, normal, normal.activeWorkspaceId);
  const data = allWorkspaceData(state);
  const live = new Set<string>();
  for (const w of state.workspaces) {
    live.add(`workspace:${w.id}`);
    const snap = ownEntry(data, w.id) ?? emptySnapshot();
    for (const p of snap.projects) live.add(`project:${w.id}:${p.id}`);
    for (const p of snap.products) live.add(`product:${w.id}:${p.id}`);
    for (const p of snap.partners) live.add(`partner:${w.id}:${p.id}`);
    for (const p of snap.pairs) live.add(`pair:${w.id}:${p.id}`);
    for (const t of snap.tasks) live.add(`task:${w.id}:${t.id}`);
    for (const st of snap.stages) live.add(`stage:${w.id}:${st.id}`);
    for (const r of snap.releases) live.add(`release:${w.id}:${r.id}`);
  }
  // Deletions in workspaces the document doesn't have can't be filed anywhere: the import notes
  // and drops them, so they don't count here either.
  const workspaces = new Set(state.workspaces.map((w) => w.id));
  const filed = (key: string) => key.startsWith('workspace:') || workspaces.has(key.split(':')[1]);
  const deletions = Object.entries(state.deleted).filter(([key]) => !live.has(key) && filed(key));

  const lines: string[] = [];
  const perWorkspace = state.workspaces.map((w) => {
    const snap = ownEntry(data, w.id) ?? emptySnapshot();
    lines.push(workspaceKey(w));
    for (const p of snap.projects) lines.push(projectKey(w.id, p));
    for (const p of snap.products) lines.push(productKey(w.id, p));
    for (const p of snap.partners) lines.push(partnerKey(w.id, p));
    for (const p of snap.pairs) lines.push(pairKey(w.id, p));
    for (const t of snap.tasks) lines.push(taskKey(w.id, t));
    for (const st of snap.stages) lines.push(stageKey(w.id, st));
    for (const r of snap.releases) lines.push(releaseKey(w.id, r));
    for (const so of snap.signoffs) lines.push(signoffKey(w.id, so));
    const ws = `:${w.id}:`;
    return {
      workspace: w.id,
      projects: snap.projects.length,
      products: snap.products.length,
      partners: snap.partners.length,
      pairs: snap.pairs.length,
      tasks: snap.tasks.length,
      done: snap.tasks.filter((t) => isDone(t)).length,
      dependencies: snap.tasks.reduce((n, t) => n + new Set(t.deps).size, 0),
      stages: snap.stages.length,
      releases: snap.releases.length,
      signoffs: snap.signoffs.length,
      deletions: deletions.filter(([key]) => !key.startsWith('workspace:') && key.slice(key.indexOf(':'), key.indexOf(':') + ws.length) === ws).length,
    };
  });
  for (const [key, at] of deletions) lines.push(`d|${key}|${at}`);
  lines.push(remindersKey(state.reminders));
  lines.sort();
  return { workspaces: perWorkspace, checksum: createHash('sha256').update(lines.join('\n')).digest('hex') };
}
