/**
 * Reading and writing the rows of api/_lib/db/mapping.ts. Times cross as milliseconds
 * (to_timestamp(ms / 1000.0) in, round(extract(epoch) * 1000) out: exact to the millisecond), and
 * dates as 'YYYY-MM-DD' text, so no time zone on either side can move a due date.
 */
import type { Queryable } from './client.js';
import type { GroupRow, ItemRow, LegacyDeletionRow, LinkRow, PairRow, Rows, SettingsRow, WorkspaceRow } from './mapping.js';

const ms = (column: string) => `round(extract(epoch from ${column}) * 1000)::float8`;
const time = (field: string) => `to_timestamp(r.${field} / 1000.0)`;

/** The user's workspaces, as a subquery. Row-level security says the same for the app role. */
const MINE = 'select workspace_id from workspace_members where user_id = $1';

/** Everything one user's workspaces hold. Works as the owner (explicit filter) and as the app (also filtered by its policies). */
export async function readRows(db: Queryable, userId: string): Promise<Rows> {
  // One after another: a connection runs one query at a time (pg 9 will refuse overlapping ones).
  const workspaces = await db.query<WorkspaceRow>(
    `select id, owner_id, client_id, name, sort_order, ${ms('edited_at')} edited_ms, ${ms('deleted_at')} deleted_ms
       from workspaces where id in (${MINE})`,
    [userId],
  );
  const groups = (table: 'projects' | 'products' | 'partners') =>
    db.query<GroupRow>(
      `select id, workspace_id, owner_id, client_id, name, color, sort_order, ${ms('edited_at')} edited_ms, ${ms('deleted_at')} deleted_ms
         from ${table} where workspace_id in (${MINE})`,
      [userId],
    );
  const projects = await groups('projects');
  const products = await groups('products');
  const partners = await groups('partners');
  const pairs = await db.query<PairRow>(
    `select id, workspace_id, owner_id, client_id, product_id, partner_id, ${ms('edited_at')} edited_ms, ${ms('deleted_at')} deleted_ms
       from product_partners where workspace_id in (${MINE})`,
    [userId],
  );
  const items = await db.query<ItemRow>(
    `select id, workspace_id, owner_id, client_id, type, project_id, product_id, partner_id, title, status, priority, due_date::text due_date,
            start_date::text start_date, waiting_on, chase_on::text chase_on, snoozed_until::text snoozed_until, recurring, remind_days_before, remind_off, notes, sort_order, subtasks, details,
            ${ms('created_at')} created_ms, ${ms('edited_at')} edited_ms, ${ms('deleted_at')} deleted_ms
       from items where workspace_id in (${MINE})`,
    [userId],
  );
  const links = await db.query<LinkRow>(`select workspace_id, owner_id, from_id, to_id, kind from item_links where workspace_id in (${MINE})`, [userId]);
  const legacyDeletions = await db.query<LegacyDeletionRow>(
    `select workspace_id, kind, client_id, ${ms('deleted_at')} deleted_ms from legacy_deletions where workspace_id in (${MINE})`,
    [userId],
  );
  const settings = await db.query<SettingsRow>(`select user_id, reminders, ${ms('edited_at')} edited_ms from user_settings where user_id = $1`, [userId]);
  return {
    workspaces: workspaces.rows,
    projects: projects.rows,
    products: products.rows,
    partners: partners.rows,
    pairs: pairs.rows,
    items: items.rows,
    links: links.rows,
    legacyDeletions: legacyDeletions.rows,
    settings: settings.rows[0] ?? null,
  };
}

/** Inserts a whole set of rows (the import). Owner only: the app can't insert workspaces or memberships. */
export async function insertRows(db: Queryable, rows: Rows): Promise<void> {
  const json = (value: unknown) => JSON.stringify(value);
  await db.query(
    `insert into workspaces (id, owner_id, client_id, name, sort_order, edited_at, deleted_at)
     select r.id, r.owner_id, r.client_id, r.name, r.sort_order, ${time('edited_ms')}, ${time('deleted_ms')}
       from jsonb_to_recordset($1::jsonb) as r(id uuid, owner_id uuid, client_id text, name text, sort_order float8, edited_ms float8, deleted_ms float8)`,
    [json(rows.workspaces)],
  );
  await db.query(
    `insert into workspace_members (workspace_id, user_id, role)
     select r.id, r.owner_id, 'owner' from jsonb_to_recordset($1::jsonb) as r(id uuid, owner_id uuid)`,
    [json(rows.workspaces)],
  );
  for (const [table, list] of [['projects', rows.projects], ['products', rows.products], ['partners', rows.partners]] as const) {
    await db.query(
      `insert into ${table} (id, workspace_id, owner_id, client_id, name, color, sort_order, edited_at, deleted_at)
       select r.id, r.workspace_id, r.owner_id, r.client_id, r.name, r.color, r.sort_order, ${time('edited_ms')}, ${time('deleted_ms')}
         from jsonb_to_recordset($1::jsonb)
           as r(id uuid, workspace_id uuid, owner_id uuid, client_id text, name text, color text, sort_order float8, edited_ms float8, deleted_ms float8)`,
      [json(list)],
    );
  }
  await db.query(
    `insert into product_partners (id, workspace_id, owner_id, client_id, product_id, partner_id, edited_at, deleted_at)
     select r.id, r.workspace_id, r.owner_id, r.client_id, r.product_id, r.partner_id, ${time('edited_ms')}, ${time('deleted_ms')}
       from jsonb_to_recordset($1::jsonb)
         as r(id uuid, workspace_id uuid, owner_id uuid, client_id text, product_id uuid, partner_id uuid, edited_ms float8, deleted_ms float8)`,
    [json(rows.pairs)],
  );
  await db.query(
    `insert into items (id, workspace_id, owner_id, client_id, type, project_id, product_id, partner_id, title, status, priority, due_date, start_date,
                        waiting_on, chase_on, snoozed_until, recurring, remind_days_before, remind_off, notes, sort_order, subtasks, details, created_at, edited_at, deleted_at)
     select r.id, r.workspace_id, r.owner_id, r.client_id, r.type, r.project_id, r.product_id, r.partner_id, r.title, r.status, r.priority, r.due_date, r.start_date,
            r.waiting_on, r.chase_on, r.snoozed_until, r.recurring, r.remind_days_before, r.remind_off, r.notes, r.sort_order, r.subtasks, r.details,
            ${time('created_ms')}, ${time('edited_ms')}, ${time('deleted_ms')}
       from jsonb_to_recordset($1::jsonb)
         as r(id uuid, workspace_id uuid, owner_id uuid, client_id text, type text, project_id uuid, product_id uuid, partner_id uuid, title text, status text, priority text,
              due_date date, start_date date, waiting_on text, chase_on date, snoozed_until date, recurring text, remind_days_before int, remind_off boolean, notes text, sort_order float8,
              subtasks jsonb, details jsonb, created_ms float8, edited_ms float8, deleted_ms float8)`,
    [json(rows.items)],
  );
  await db.query(
    `insert into item_links (workspace_id, owner_id, from_id, to_id, kind)
     select r.workspace_id, r.owner_id, r.from_id, r.to_id, r.kind
       from jsonb_to_recordset($1::jsonb) as r(workspace_id uuid, owner_id uuid, from_id uuid, to_id uuid, kind text)`,
    [json(rows.links)],
  );
  await db.query(
    `insert into legacy_deletions (workspace_id, kind, client_id, deleted_at)
     select r.workspace_id, r.kind, r.client_id, ${time('deleted_ms')}
       from jsonb_to_recordset($1::jsonb) as r(workspace_id uuid, kind text, client_id text, deleted_ms float8)`,
    [json(rows.legacyDeletions)],
  );
  if (rows.settings) {
    await db.query(
      `insert into user_settings (user_id, reminders, edited_at) values ($1, $2, to_timestamp($3 / 1000.0))
       on conflict (user_id) do update set reminders = excluded.reminders, edited_at = excluded.edited_at`,
      [rows.settings.user_id, json(rows.settings.reminders), rows.settings.edited_ms],
    );
  }
}

/** The change-log triggers on workspace data, switched off during the import (which writes baselines instead). */
export const LOGGED_TABLES = ['workspaces', 'workspace_members', 'projects', 'products', 'partners', 'product_partners', 'items', 'item_links'] as const;

/**
 * "History starts here": one 'baseline' entry per imported row, keyed as the triggers key them.
 * Owner only (the app can't write the log).
 */
export async function writeBaseline(db: Queryable, workspaceIds: string[]): Promise<number> {
  const result = await db.query(
    `insert into change_log (workspace_id, table_name, row_key, action, after)
     select id, 'workspaces', id::text, 'baseline', to_jsonb(t) from workspaces t where id = any($1::uuid[])
     union all
     select workspace_id, 'workspace_members', workspace_id || ':' || user_id, 'baseline', to_jsonb(t) from workspace_members t where workspace_id = any($1::uuid[])
     union all
     select workspace_id, 'projects', id::text, 'baseline', to_jsonb(t) from projects t where workspace_id = any($1::uuid[])
     union all
     select workspace_id, 'products', id::text, 'baseline', to_jsonb(t) from products t where workspace_id = any($1::uuid[])
     union all
     select workspace_id, 'partners', id::text, 'baseline', to_jsonb(t) from partners t where workspace_id = any($1::uuid[])
     union all
     select workspace_id, 'product_partners', id::text, 'baseline', to_jsonb(t) from product_partners t where workspace_id = any($1::uuid[])
     union all
     select workspace_id, 'items', id::text, 'baseline', to_jsonb(t) from items t where workspace_id = any($1::uuid[])
     union all
     select workspace_id, 'item_links', from_id || ':' || to_id || ':' || kind, 'baseline', to_jsonb(t) from item_links t where workspace_id = any($1::uuid[])`,
    [workspaceIds],
  );
  return result.rowCount ?? 0;
}
