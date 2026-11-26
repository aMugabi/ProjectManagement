-- Ledger 0002: products, partners and their pairs, and the six item types (build plan Step 1b).
-- Products and partners link many-to-many. An item belongs to a product, a partner, both (then
-- that pair must exist), or neither; or, instead, to a plain project.

insert into item_types (type, label) values
  ('risk', 'Risk'), ('issue', 'Issue'), ('decision', 'Decision'), ('dependency', 'Dependency'), ('change_request', 'Change request');

-- Which statuses each type allows, in workflow order; done = finished (no longer open, no
-- reminders). src/shared/itemTypes.ts lists the same. A new status is a new row.
create table item_statuses (
  type text not null references item_types,
  status text not null check (status ~ '^[a-z][a-z_]*$'),
  label text not null,
  done boolean not null default false,
  sort_order int not null,
  primary key (type, status)
);
insert into item_statuses (type, status, label, done, sort_order) values
  ('task', 'todo', 'To do', false, 1), ('task', 'doing', 'Doing', false, 2), ('task', 'blocked', 'Blocked', false, 3), ('task', 'done', 'Done', true, 4),
  ('risk', 'open', 'Open', false, 1), ('risk', 'mitigating', 'Mitigating', false, 2), ('risk', 'closed', 'Closed', true, 3),
  ('issue', 'open', 'Open', false, 1), ('issue', 'in_progress', 'In progress', false, 2), ('issue', 'resolved', 'Resolved', true, 3),
  ('decision', 'proposed', 'Proposed', false, 1), ('decision', 'decided', 'Decided', true, 2), ('decision', 'superseded', 'Superseded', true, 3),
  ('dependency', 'waiting', 'Waiting', false, 1), ('dependency', 'at_risk', 'At risk', false, 2), ('dependency', 'met', 'Met', true, 3),
  ('change_request', 'draft', 'Draft', false, 1), ('change_request', 'submitted', 'Submitted', false, 2), ('change_request', 'approved', 'Approved', false, 3),
  ('change_request', 'rejected', 'Rejected', true, 4), ('change_request', 'implemented', 'Implemented', true, 5);

-- 0001 allowed only task statuses; now each type's own.
alter table items drop constraint items_check;
alter table items add constraint items_status_for_type foreign key (type, status) references item_statuses (type, status);

create table products (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces,
  owner_id uuid not null references users,
  client_id text not null check (length(client_id) > 0),
  name text not null check (length(btrim(name)) > 0),
  color text not null default '#b4674a' check (color ~ '^#[0-9a-fA-F]{6}$'),
  sort_order double precision not null default 0,
  edited_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, client_id),
  unique (workspace_id, id)
);

create table partners (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces,
  owner_id uuid not null references users,
  client_id text not null check (length(client_id) > 0),
  name text not null check (length(btrim(name)) > 0),
  color text not null default '#4f7a86' check (color ~ '^#[0-9a-fA-F]{6}$'),
  sort_order double precision not null default 0,
  edited_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, client_id),
  unique (workspace_id, id)
);

-- A product and a partner that work together (Step 3's releases will hang off these).
create table product_partners (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces,
  owner_id uuid not null references users,
  client_id text not null check (length(client_id) > 0),
  product_id uuid not null,
  partner_id uuid not null,
  edited_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, client_id),
  unique (workspace_id, product_id, partner_id),
  foreign key (workspace_id, product_id) references products (workspace_id, id),
  foreign key (workspace_id, partner_id) references partners (workspace_id, id)
);

alter table items
  add column product_id uuid,
  add column partner_id uuid,
  add constraint items_product_in_workspace foreign key (workspace_id, product_id) references products (workspace_id, id),
  add constraint items_partner_in_workspace foreign key (workspace_id, partner_id) references partners (workspace_id, id),
  -- With both set, they must be a pair (checked only when all three are set).
  add constraint items_pair_exists foreign key (workspace_id, product_id, partner_id) references product_partners (workspace_id, product_id, partner_id),
  add constraint items_one_home check (project_id is null or (product_id is null and partner_id is null));
create index items_product on items (workspace_id, product_id) where product_id is not null;
create index items_partner on items (workspace_id, partner_id) where partner_id is not null;

create trigger log_products after insert or update or delete on products
  for each row execute function app.log_change('workspace_id', 'id');
create trigger log_partners after insert or update or delete on partners
  for each row execute function app.log_change('workspace_id', 'id');
create trigger log_product_partners after insert or update or delete on product_partners
  for each row execute function app.log_change('workspace_id', 'id');
create trigger touch_products before update on products for each row execute function app.touch_updated_at();
create trigger touch_partners before update on partners for each row execute function app.touch_updated_at();
create trigger touch_product_partners before update on product_partners for each row execute function app.touch_updated_at();

alter table products enable row level security;
alter table partners enable row level security;
alter table product_partners enable row level security;
create policy member_rows on products
  using (workspace_id = any ((select app.workspace_ids())::uuid[])) with check (workspace_id = any ((select app.workspace_ids())::uuid[]));
create policy member_rows on partners
  using (workspace_id = any ((select app.workspace_ids())::uuid[])) with check (workspace_id = any ((select app.workspace_ids())::uuid[]));
create policy member_rows on product_partners
  using (workspace_id = any ((select app.workspace_ids())::uuid[])) with check (workspace_id = any ((select app.workspace_ids())::uuid[]));

grant select on item_statuses to ledger_app;
grant select, insert on products, partners, product_partners to ledger_app;
grant update (name, color, sort_order, edited_at, deleted_at) on products, partners to ledger_app;
grant update (edited_at, deleted_at) on product_partners to ledger_app;
grant update (product_id, partner_id) on items to ledger_app;

-- Deletions the old store remembered can now be of products, partners and pairs too (Step 1b may
-- reach devices before the move to Postgres).
alter table legacy_deletions drop constraint legacy_deletions_kind_check;
alter table legacy_deletions add constraint legacy_deletions_kind_check check (kind in ('task', 'project', 'product', 'partner', 'pair'));
