-- Ledger 0001: the foundation (build plan Step 1a). Plain PostgreSQL 15 or later, nothing
-- vendor-specific, so it can run on any host, including a bank's own servers.
--
-- Run by the owner role (the one that runs migrations and owns every table). The app connects
-- as a login role that is a member of ledger_app: it owns nothing and can't bypass row-level
-- security. Each request first says who the user is (SET LOCAL app.user_id = '<uuid>'), and the
-- policies then show only the workspaces that user belongs to, even to a query that forgets to
-- filter. With no user set, they show nothing.
--
-- Two kinds of table:
--   * workspace data (workspaces, members, projects, items, links, change log, legacy deletions):
--     workspace_id on every row, row-level security, and every change written to change_log;
--   * account data (users, identities, sessions, MFA, settings, push, reminders sent): per user.
--     Sign-in reads these before anyone is signed in, so the identity tables have no policies;
--     only the sign-in module touches them.

do $$
begin
  if not exists (select from pg_roles where rolname = 'ledger_app') then
    create role ledger_app nologin nobypassrls;
  end if;
end $$;

create schema app;
revoke all on schema app from public;
grant usage on schema app to ledger_app;
grant usage on schema public to ledger_app;

-- Who this request is for: NULL when unset or empty, so every policy then shows nothing. A value
-- that isn't a uuid is an error (fails closed).
create function app.user_id() returns uuid
  language sql stable
  as $$ select nullif(current_setting('app.user_id', true), '')::uuid $$;

-- ---------------------------------------------------------------------------------------------
-- Accounts
-- ---------------------------------------------------------------------------------------------

create table users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(btrim(email)) and email like '_%@_%'),
  display_name text not null default '',
  time_zone text not null default 'Africa/Kampala',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- How someone proves who they are. Matched by (provider, subject) only, never by email, so a
-- single sign-on account added later can't take over a user just by sharing an address.
create table identities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users on delete cascade,
  provider text not null check (provider ~ '^[a-z][a-z0-9-]*$'),
  subject text not null check (length(subject) > 0),
  secret_hash text,
  created_at timestamptz not null default now(),
  unique (provider, subject)
);

create table sessions (
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  user_id uuid not null references users on delete cascade,
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index sessions_user on sessions (user_id);

create table mfa_factors (
  user_id uuid primary key references users on delete cascade,
  totp_secret_encrypted text not null,
  recovery_code_hashes text[] not null default '{}',
  created_at timestamptz not null default now()
);

-- Authenticator time steps and recovery codes already used, so each signs in once.
create table used_codes (
  user_id uuid not null references users on delete cascade,
  code_key text not null,
  used_at timestamptz not null default now(),
  primary key (user_id, code_key)
);

create table login_attempts (
  id bigint generated always as identity primary key,
  limit_key text not null,
  at timestamptz not null default now()
);
create index login_attempts_key_at on login_attempts (limit_key, at);

create table user_settings (
  user_id uuid primary key references users on delete cascade,
  reminders jsonb not null default '{}' check (jsonb_typeof(reminders) = 'object'),
  edited_at timestamptz not null default to_timestamp(0),
  updated_at timestamptz not null default now()
);

create table push_subscriptions (
  user_id uuid not null references users on delete cascade,
  endpoint_hash text not null check (endpoint_hash ~ '^[0-9a-f]{64}$'),
  subscription jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, endpoint_hash)
);

create table reminders_sent (
  user_id uuid not null references users on delete cascade,
  reminder_key text not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, reminder_key)
);

-- ---------------------------------------------------------------------------------------------
-- Workspace data
-- ---------------------------------------------------------------------------------------------
-- client_id: the id devices use. During the move it is the old id (a slug such as 'default', or
-- 't1730000000000'); new items can use a uuid string. edited_at: when the edit was made on the
-- device, so sync keeps the newest edit. updated_at: when the server wrote it. deleted_at: soft
-- delete; rows are never removed by the app.

create table workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references users,
  client_id text not null check (length(client_id) > 0),
  name text not null check (length(btrim(name)) > 0),
  edited_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (owner_id, client_id)
);

create table workspace_members (
  workspace_id uuid not null references workspaces on delete cascade,
  user_id uuid not null references users on delete cascade,
  role text not null default 'owner' check (role ~ '^[a-z]+$'),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index workspace_members_user on workspace_members (user_id);

-- The workspaces this request's user belongs to. Security definer so the policies can read
-- memberships without the members table's own policy hiding them; it reveals only the user's own.
create function app.workspace_ids() returns uuid[]
  language sql stable security definer set search_path = pg_catalog, public
  as $$ select coalesce(array_agg(workspace_id), '{}') from public.workspace_members where user_id = app.user_id() $$;

create table projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces,
  owner_id uuid not null references users,
  client_id text not null check (length(client_id) > 0),
  name text not null check (length(btrim(name)) > 0),
  color text not null default '#b4674a' check (color ~ '^#[0-9a-fA-F]{6}$'),
  edited_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, client_id),
  unique (workspace_id, id)
);

-- A new kind of item is a new row here, not a schema change. Step 1b adds the other five.
create table item_types (
  type text primary key check (type ~ '^[a-z][a-z_]*$'),
  label text not null
);
insert into item_types values ('task', 'Task');

create table items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces,
  owner_id uuid not null references users,
  client_id text not null check (length(client_id) > 0),
  type text not null default 'task' references item_types,
  project_id uuid,
  title text not null,
  status text not null,
  priority text not null default 'med' check (priority in ('high', 'med', 'low')),
  due_date date,
  start_date date,
  recurring text check (recurring in ('weekly', 'monthly', 'yearly')),
  -- NULL: use the settings default; remind_off: never; otherwise this many days before.
  remind_days_before integer check (remind_days_before >= 0),
  remind_off boolean not null default false,
  notes text not null default '',
  sort_order double precision not null default 0,
  subtasks jsonb not null default '[]' check (jsonb_typeof(subtasks) = 'array'),
  -- Type-specific fields (Step 1b), checked by the app; any field a report filters on becomes a column.
  details jsonb not null default '{}' check (jsonb_typeof(details) = 'object'),
  edited_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, client_id),
  unique (workspace_id, id),
  -- A project from another workspace can't be attached.
  foreign key (workspace_id, project_id) references projects (workspace_id, id),
  check (type <> 'task' or status in ('todo', 'doing', 'blocked', 'done'))
);
create index items_due on items (workspace_id, due_date) where deleted_at is null;

-- from_id depends on to_id (it waits for it). Both in the same workspace.
create table item_links (
  workspace_id uuid not null references workspaces,
  owner_id uuid not null references users,
  from_id uuid not null,
  to_id uuid not null,
  kind text not null default 'depends_on' check (kind in ('depends_on')),
  created_at timestamptz not null default now(),
  primary key (from_id, to_id, kind),
  foreign key (workspace_id, from_id) references items (workspace_id, id),
  foreign key (workspace_id, to_id) references items (workspace_id, id),
  check (from_id <> to_id)
);

-- Deletions remembered by the old store whose items no longer exist, so a device that was
-- offline during the move can't bring them back. Dropped once the move is settled.
create table legacy_deletions (
  workspace_id uuid not null references workspaces,
  kind text not null check (kind in ('task', 'project')),
  client_id text not null,
  deleted_at timestamptz not null,
  primary key (workspace_id, kind, client_id)
);

-- ---------------------------------------------------------------------------------------------
-- Change log: who changed what, when, with the row before and after. Append-only for everyone:
-- the app can only read it (its own workspaces), a trigger owned by the owner role writes it,
-- and no role can update, delete or truncate it. History starts with one 'baseline' entry per
-- row, written by the import.
-- ---------------------------------------------------------------------------------------------

create table change_log (
  id bigint generated always as identity primary key,
  workspace_id uuid not null,
  table_name text not null,
  row_key text not null,
  action text not null check (action in ('insert', 'update', 'delete', 'baseline')),
  actor_id uuid,
  changed_at timestamptz not null default clock_timestamp(),
  before jsonb,
  after jsonb
);
create index change_log_row on change_log (table_name, row_key, changed_at);
create index change_log_workspace on change_log (workspace_id, changed_at);

create function app.refuse_change_log_edits() returns trigger
  language plpgsql
  as $$ begin raise exception 'change_log is append-only' using errcode = '42501'; end $$;
create trigger change_log_append_only before update or delete on change_log
  for each row execute function app.refuse_change_log_edits();
create trigger change_log_no_truncate before truncate on change_log
  for each statement execute function app.refuse_change_log_edits();

-- TG_ARGV[0]: the column holding the workspace id; TG_ARGV[1..]: the row's key columns.
create function app.log_change() returns trigger
  language plpgsql security definer set search_path = pg_catalog, public
as $$
declare
  old_row jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  new_row jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  row_data jsonb := coalesce(new_row, old_row);
  key text;
begin
  -- A write that changed nothing but the write time isn't a change.
  if tg_op = 'UPDATE' and (new_row - 'updated_at') = (old_row - 'updated_at') then
    return null;
  end if;
  select string_agg(row_data ->> k, ':' order by n) into key
    from unnest(tg_argv[1:]) with ordinality as cols(k, n);
  insert into public.change_log (workspace_id, table_name, row_key, action, actor_id, before, after)
    values ((row_data ->> tg_argv[0])::uuid, tg_table_name, key, lower(tg_op), app.user_id(), old_row, new_row);
  return null;
end $$;

create trigger log_workspaces after insert or update or delete on workspaces
  for each row execute function app.log_change('id', 'id');
create trigger log_workspace_members after insert or update or delete on workspace_members
  for each row execute function app.log_change('workspace_id', 'workspace_id', 'user_id');
create trigger log_projects after insert or update or delete on projects
  for each row execute function app.log_change('workspace_id', 'id');
create trigger log_items after insert or update or delete on items
  for each row execute function app.log_change('workspace_id', 'id');
create trigger log_item_links after insert or update or delete on item_links
  for each row execute function app.log_change('workspace_id', 'from_id', 'to_id', 'kind');

create function app.touch_updated_at() returns trigger
  language plpgsql
  as $$ begin new.updated_at := now(); return new; end $$;
create trigger touch_users before update on users for each row execute function app.touch_updated_at();
create trigger touch_user_settings before update on user_settings for each row execute function app.touch_updated_at();
create trigger touch_workspaces before update on workspaces for each row execute function app.touch_updated_at();
create trigger touch_projects before update on projects for each row execute function app.touch_updated_at();
create trigger touch_items before update on items for each row execute function app.touch_updated_at();

-- A user makes a workspace and becomes its owner in one step (the app can't insert either row
-- directly, so it can't join someone else's workspace).
create function app.create_workspace(p_client_id text, p_name text, p_edited_at timestamptz default now())
  returns uuid
  language plpgsql security definer set search_path = pg_catalog, public
as $$
declare
  me uuid := app.user_id();
  ws uuid;
begin
  if me is null then
    raise exception 'no user for this request' using errcode = '42501';
  end if;
  insert into public.workspaces (owner_id, client_id, name, edited_at)
    values (me, p_client_id, p_name, p_edited_at) returning id into ws;
  insert into public.workspace_members (workspace_id, user_id, role) values (ws, me, 'owner');
  return ws;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------------------------

alter table workspaces enable row level security;
alter table workspace_members enable row level security;
alter table projects enable row level security;
alter table items enable row level security;
alter table item_links enable row level security;
alter table legacy_deletions enable row level security;
alter table change_log enable row level security;
alter table user_settings enable row level security;
alter table push_subscriptions enable row level security;
alter table reminders_sent enable row level security;

create policy member_workspaces on workspaces
  using (id = any ((select app.workspace_ids())::uuid[])) with check (id = any ((select app.workspace_ids())::uuid[]));
create policy member_rows on workspace_members
  using (workspace_id = any ((select app.workspace_ids())::uuid[]));
create policy member_rows on projects
  using (workspace_id = any ((select app.workspace_ids())::uuid[])) with check (workspace_id = any ((select app.workspace_ids())::uuid[]));
create policy member_rows on items
  using (workspace_id = any ((select app.workspace_ids())::uuid[])) with check (workspace_id = any ((select app.workspace_ids())::uuid[]));
create policy member_rows on item_links
  using (workspace_id = any ((select app.workspace_ids())::uuid[])) with check (workspace_id = any ((select app.workspace_ids())::uuid[]));
create policy member_rows on legacy_deletions
  using (workspace_id = any ((select app.workspace_ids())::uuid[]));
create policy member_rows on change_log
  using (workspace_id = any ((select app.workspace_ids())::uuid[]));
create policy own_rows on user_settings
  using (user_id = app.user_id()) with check (user_id = app.user_id());
create policy own_rows on push_subscriptions
  using (user_id = app.user_id()) with check (user_id = app.user_id());
create policy own_rows on reminders_sent
  using (user_id = app.user_id()) with check (user_id = app.user_id());

-- ---------------------------------------------------------------------------------------------
-- What the app may do. No DELETE on workspace data (soft delete only), and the change log is
-- read-only to it.
-- ---------------------------------------------------------------------------------------------

revoke all on all functions in schema app from public;
grant execute on function app.user_id(), app.workspace_ids(), app.create_workspace(text, text, timestamptz) to ledger_app;

grant select, insert, update on users, identities, mfa_factors to ledger_app;
grant select, insert, update, delete on sessions to ledger_app;
grant delete on mfa_factors to ledger_app;
grant select, insert, delete on used_codes, login_attempts to ledger_app;
grant select, insert, update on user_settings to ledger_app;
grant select, insert, update, delete on push_subscriptions to ledger_app;
grant select, insert, delete on reminders_sent to ledger_app;

-- Updates are limited to the columns an edit can change: a row can't be moved to another
-- workspace or given to another owner.
grant select on workspaces to ledger_app;
grant update (name, edited_at, deleted_at) on workspaces to ledger_app;
grant select on workspace_members to ledger_app;
grant select, insert on projects, items to ledger_app;
grant update (name, color, edited_at, deleted_at) on projects to ledger_app;
grant update (type, project_id, title, status, priority, due_date, start_date, recurring, remind_days_before,
  remind_off, notes, sort_order, subtasks, details, edited_at, deleted_at) on items to ledger_app;
grant select, insert, delete on item_links to ledger_app;
grant select on legacy_deletions, change_log, item_types to ledger_app;
grant usage on sequence login_attempts_id_seq to ledger_app;
