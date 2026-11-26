-- Ledger 0004: delivery tracking (build plan Step 3). Each workspace has its stage template
-- (by default SIT, UAT, UVT, InfoSec, Go-live); a release belongs to a product–partner pair; a
-- sign-off records one stage of one release: the outcome, who approved it and in what role, when,
-- and a link to the evidence (evidence stays in the bank's own systems: no uploads).
-- Sign-offs are never edited or deleted by the app: a correction is a new sign-off naming the one
-- it replaces.

create table stages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces,
  owner_id uuid not null references users,
  client_id text not null check (length(client_id) > 0),
  name text not null check (length(btrim(name)) > 0),
  sort_order double precision not null default 0,
  edited_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, client_id),
  unique (workspace_id, id)
);

create table releases (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces,
  owner_id uuid not null references users,
  client_id text not null check (length(client_id) > 0),
  product_id uuid not null,
  partner_id uuid not null,
  name text not null check (length(btrim(name)) > 0),
  target_date date,
  edited_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, client_id),
  unique (workspace_id, id),
  -- A release is for a product and partner that work together.
  foreign key (workspace_id, product_id, partner_id) references product_partners (workspace_id, product_id, partner_id)
);

create table signoffs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces,
  owner_id uuid not null references users,
  client_id text not null check (length(client_id) > 0),
  release_id uuid not null,
  stage_id uuid not null,
  -- The stage's name when signed, so the record reads the same after a rename.
  stage_name text not null check (length(btrim(stage_name)) > 0),
  outcome text not null check (outcome in ('passed', 'failed', 'waived')),
  approver text not null check (length(btrim(approver)) > 0),
  approver_role text not null default '',
  -- The approver's local date and time, as entered.
  signed_at timestamp not null,
  evidence_url text not null default '' check (evidence_url = '' or evidence_url ~ '^https?://[^[:space:]]+$'),
  note text not null default '',
  corrects_id uuid,
  created_at timestamptz not null default now(),
  unique (workspace_id, client_id),
  unique (workspace_id, id),
  foreign key (workspace_id, release_id) references releases (workspace_id, id),
  foreign key (workspace_id, stage_id) references stages (workspace_id, id),
  foreign key (workspace_id, corrects_id) references signoffs (workspace_id, id),
  check (corrects_id is null or corrects_id <> id)
);
create index signoffs_release on signoffs (workspace_id, release_id);

create trigger log_stages after insert or update or delete on stages
  for each row execute function app.log_change('workspace_id', 'id');
create trigger log_releases after insert or update or delete on releases
  for each row execute function app.log_change('workspace_id', 'id');
create trigger log_signoffs after insert or update or delete on signoffs
  for each row execute function app.log_change('workspace_id', 'id');
create trigger touch_stages before update on stages for each row execute function app.touch_updated_at();
create trigger touch_releases before update on releases for each row execute function app.touch_updated_at();

alter table stages enable row level security;
alter table releases enable row level security;
alter table signoffs enable row level security;
create policy member_rows on stages
  using (workspace_id = any ((select app.workspace_ids())::uuid[])) with check (workspace_id = any ((select app.workspace_ids())::uuid[]));
create policy member_rows on releases
  using (workspace_id = any ((select app.workspace_ids())::uuid[])) with check (workspace_id = any ((select app.workspace_ids())::uuid[]));
create policy member_rows on signoffs
  using (workspace_id = any ((select app.workspace_ids())::uuid[])) with check (workspace_id = any ((select app.workspace_ids())::uuid[]));

grant select, insert on stages, releases, signoffs to ledger_app;
grant update (name, sort_order, edited_at, deleted_at) on stages to ledger_app;
grant update (name, target_date, edited_at, deleted_at) on releases to ledger_app;
-- No update or delete on signoffs: they are append-only for the app.

alter table legacy_deletions drop constraint legacy_deletions_kind_check;
alter table legacy_deletions add constraint legacy_deletions_kind_check
  check (kind in ('task', 'project', 'product', 'partner', 'pair', 'stage', 'release'));
