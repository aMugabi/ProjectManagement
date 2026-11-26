-- 0002: item types and their statuses, products, partners and pairs, and where an item belongs.
begin;
select plan(34);
\ir _fixture.sql

-- A: product pa-prod, partners pa-part and pa-part2, paired pa-prod+pa-part. B: product pb-prod.
insert into products (id, workspace_id, owner_id, client_id, name, updated_at) values
  ('00000000-0000-0000-0000-0000000000a5', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000a', 'pa-prod', 'Loans', '2020-01-01'),
  ('00000000-0000-0000-0000-0000000000b5', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000000b', 'pb-prod', 'Cards', '2020-01-01');
insert into partners (id, workspace_id, owner_id, client_id, name) values
  ('00000000-0000-0000-0000-0000000000a6', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000a', 'pa-part', 'Telco'),
  ('00000000-0000-0000-0000-0000000000a7', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000a', 'pa-part2', 'Fintech'),
  ('00000000-0000-0000-0000-0000000000b6', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000000b', 'pb-part', 'Bureau');
insert into product_partners (workspace_id, owner_id, client_id, product_id, partner_id) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000a', 'pa-prod+pa-part', '00000000-0000-0000-0000-0000000000a5', '00000000-0000-0000-0000-0000000000a6');

-- A helper: insert one item for A in A's workspace with the given extra columns and values.
create function pg_temp.item_sql(cols text, vals text) returns text language sql as $$
  select format('insert into items (workspace_id, owner_id, client_id, title, %s) values (''00000000-0000-0000-0000-0000000000a1'', ''00000000-0000-0000-0000-00000000000a'', %L, ''X'', %s) returning ''ok''',
                cols, 'c-' || md5(vals), vals) $$;

-- Types and statuses
select is((select string_agg(type, ',' order by type) from item_types), 'change_request,decision,dependency,issue,risk,task', 'The six item types');
select is((select count(*)::int from item_statuses), 21, 'with their statuses');
select is(pg_temp.as_app('00000000-0000-0000-0000-00000000000a', pg_temp.item_sql('type, status', '''risk'', ''open''')), 'ok', 'A risk can be open');
select matches(pg_temp.as_app('00000000-0000-0000-0000-00000000000a', pg_temp.item_sql('type, status', '''risk'', ''todo''')), '^ERROR 23503', 'but not "to do" (a task status)');
select matches(pg_temp.as_app('00000000-0000-0000-0000-00000000000a', pg_temp.item_sql('status', '''open''')), '^ERROR 23503', 'and a task can''t be open (a risk status)');
select is(pg_temp.as_app('00000000-0000-0000-0000-00000000000a', pg_temp.item_sql('type, status', '''change_request'', ''approved''')), 'ok', 'Each type has its own statuses');
select is(pg_temp.as_app('00000000-0000-0000-0000-00000000000a', 'select string_agg(status, '','' order by sort_order) from item_statuses where done and type = ''decision'''), 'decided,superseded', 'and knows which are finished');

-- Where an item belongs
select is(pg_temp.as_app('00000000-0000-0000-0000-00000000000a', pg_temp.item_sql('status, product_id', '''todo'', ''00000000-0000-0000-0000-0000000000a5''')), 'ok', 'An item can belong to a product');
select is(pg_temp.as_app('00000000-0000-0000-0000-00000000000a', pg_temp.item_sql('status, partner_id', '''todo'', ''00000000-0000-0000-0000-0000000000a7''')), 'ok', 'or a partner');
select is(pg_temp.as_app('00000000-0000-0000-0000-00000000000a', pg_temp.item_sql('status, product_id, partner_id', '''todo'', ''00000000-0000-0000-0000-0000000000a5'', ''00000000-0000-0000-0000-0000000000a6''')), 'ok', 'or both, when they are a pair');
select matches(pg_temp.as_app('00000000-0000-0000-0000-00000000000a', pg_temp.item_sql('status, product_id, partner_id', '''todo'', ''00000000-0000-0000-0000-0000000000a5'', ''00000000-0000-0000-0000-0000000000a7''')), '^ERROR 23503', 'but not both when they aren''t a pair');
select matches(pg_temp.as_app('00000000-0000-0000-0000-00000000000a', pg_temp.item_sql('status, project_id, product_id', '''todo'', ''00000000-0000-0000-0000-0000000000a2'', ''00000000-0000-0000-0000-0000000000a5''')), '^ERROR 23514', 'An item in a plain project can''t also have a product');
select matches(pg_temp.as_app('00000000-0000-0000-0000-00000000000a', pg_temp.item_sql('status, project_id, partner_id', '''todo'', ''00000000-0000-0000-0000-0000000000a2'', ''00000000-0000-0000-0000-0000000000a6''')), '^ERROR 23514', 'nor a partner');
select matches(pg_temp.as_app('00000000-0000-0000-0000-00000000000a', pg_temp.item_sql('status, product_id', '''todo'', ''00000000-0000-0000-0000-0000000000b5''')), '^ERROR 23503', 'A can''t file an item under B''s product');
select matches(pg_temp.as_app('00000000-0000-0000-0000-00000000000a', pg_temp.item_sql('status, partner_id', '''todo'', ''00000000-0000-0000-0000-0000000000b6''')), '^ERROR 23503', 'nor B''s partner');

-- Walls around products, partners and pairs
select is(pg_temp.as_app('00000000-0000-0000-0000-00000000000a', 'select string_agg(client_id, '','' order by client_id) from products'), 'pa-prod', 'A sees only A''s products');
select is(pg_temp.as_app('00000000-0000-0000-0000-00000000000a', 'select string_agg(client_id, '','' order by client_id) from partners'), 'pa-part,pa-part2', 'and partners');
select is(pg_temp.as_app('00000000-0000-0000-0000-00000000000b', 'select count(*)::text from product_partners'), '0', 'B doesn''t see A''s pairs');
select matches(pg_temp.as_app('00000000-0000-0000-0000-00000000000a',
  'insert into products (workspace_id, owner_id, client_id, name) values (''00000000-0000-0000-0000-0000000000b1'', ''00000000-0000-0000-0000-00000000000a'', ''sneak'', ''S'') returning ''ok'''),
  '^ERROR 42501: new row violates row-level security', 'A can''t add a product to B''s workspace');
select matches(pg_temp.as_app('00000000-0000-0000-0000-00000000000a',
  'insert into partners (workspace_id, owner_id, client_id, name) values (''00000000-0000-0000-0000-0000000000b1'', ''00000000-0000-0000-0000-00000000000a'', ''sneak'', ''S'') returning ''ok'''),
  '^ERROR 42501: new row violates row-level security', 'nor a partner');
select matches(pg_temp.as_app('00000000-0000-0000-0000-00000000000b',
  'insert into product_partners (workspace_id, owner_id, client_id, product_id, partner_id) values (''00000000-0000-0000-0000-0000000000b1'', ''00000000-0000-0000-0000-00000000000b'', ''x'', ''00000000-0000-0000-0000-0000000000b5'', ''00000000-0000-0000-0000-0000000000a6'') returning ''ok'''),
  '^ERROR 23503', 'A pair can''t join a product to another workspace''s partner');
select matches(pg_temp.as_app('00000000-0000-0000-0000-00000000000b',
  'insert into product_partners (workspace_id, owner_id, client_id, product_id, partner_id) values (''00000000-0000-0000-0000-0000000000b1'', ''00000000-0000-0000-0000-00000000000b'', ''y'', ''00000000-0000-0000-0000-0000000000a5'', ''00000000-0000-0000-0000-0000000000b6'') returning ''ok'''),
  '^ERROR 23503', 'nor a partner to another workspace''s product');
select matches(pg_temp.as_app('00000000-0000-0000-0000-00000000000a',
  'insert into product_partners (workspace_id, owner_id, client_id, product_id, partner_id) values (''00000000-0000-0000-0000-0000000000b1'', ''00000000-0000-0000-0000-00000000000a'', ''x'', ''00000000-0000-0000-0000-0000000000b5'', ''00000000-0000-0000-0000-0000000000b6'') returning ''ok'''),
  '^ERROR 42501: new row violates row-level security', 'nor be made in someone else''s workspace');
select matches(pg_temp.as_app('00000000-0000-0000-0000-00000000000a',
  'with u as (update products set workspace_id = ''00000000-0000-0000-0000-0000000000b1'' returning 1) select count(*)::text from u'),
  '^ERROR 42501: permission denied', 'Products can''t be moved to another workspace');
select matches(pg_temp.as_app('00000000-0000-0000-0000-00000000000a',
  'with u as (update partners set owner_id = ''00000000-0000-0000-0000-00000000000b'' returning 1) select count(*)::text from u'),
  '^ERROR 42501: permission denied', 'nor partners given away');
select matches(pg_temp.as_app('00000000-0000-0000-0000-00000000000a',
  'with u as (update product_partners set product_id = ''00000000-0000-0000-0000-0000000000a5'' returning 1) select count(*)::text from u'),
  '^ERROR 42501: permission denied', 'A pair can''t be changed into another pair');
select matches(pg_temp.as_app('00000000-0000-0000-0000-00000000000a', 'delete from products returning ''x'''), '^ERROR 42501: permission denied', 'Products are deleted softly only');
select matches(pg_temp.as_app('00000000-0000-0000-0000-00000000000a', 'delete from product_partners returning ''x'''), '^ERROR 42501: permission denied', 'and pairs');
select is(pg_temp.as_app('00000000-0000-0000-0000-00000000000a',
  'with u as (update products set name = ''Loans 2'', deleted_at = now() returning 1) select count(*)::text from u'), '1', 'A can rename and delete its product');
select is(pg_temp.as_app('00000000-0000-0000-0000-00000000000a',
  'with u as (update product_partners set deleted_at = now() returning 1) select count(*)::text from u'), '1', 'and end a pair');
select is(pg_temp.as_app('00000000-0000-0000-0000-00000000000a',
  'with u as (update items set product_id = null where client_id = ''ia1'' returning 1) select count(*)::text from u'), '1', 'and move an item off a product');

-- The change log
select is((select string_agg(distinct table_name || ' ' || action, ',' order by table_name || ' ' || action) from change_log
            where table_name in ('products', 'partners', 'product_partners') and actor_id = '00000000-0000-0000-0000-00000000000a'),
  'product_partners update,products update', 'Changes to products and pairs are logged as the user');
select is((select count(*)::int from change_log where table_name in ('products', 'partners', 'product_partners') and action = 'insert'),
  6, 'and so are the ones made outside a request');
select ok((select updated_at = now() from products where client_id = 'pa-prod'), 'Updates stamp updated_at');

select * from finish();
rollback;
