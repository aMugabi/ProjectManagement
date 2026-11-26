-- The change log: every change is recorded with who, when, before and after, and nobody can
-- rewrite it.
begin;
select plan(18);
\ir _fixture.sql

-- A makes, edits, re-saves unchanged, and soft-deletes an item.
select is(pg_temp.as_app('00000000-0000-0000-0000-00000000000a',
  'insert into items (id, workspace_id, owner_id, client_id, title, status) values (''00000000-0000-0000-0000-0000000000a9'', ''00000000-0000-0000-0000-0000000000a1'', ''00000000-0000-0000-0000-00000000000a'', ''new'', ''New'', ''todo'') returning ''ok'''),
  'ok', 'A adds an item');
select pg_temp.as_app('00000000-0000-0000-0000-00000000000a', 'with u as (update items set title = ''Renamed'' where client_id = ''new'' returning 1) select count(*)::text from u');
select pg_temp.as_app('00000000-0000-0000-0000-00000000000a', 'with u as (update items set title = title where client_id = ''new'' returning 1) select count(*)::text from u');
select pg_temp.as_app('00000000-0000-0000-0000-00000000000a', 'with u as (update items set deleted_at = now() where client_id = ''new'' returning 1) select count(*)::text from u');

select is((select string_agg(action, ',' order by id) from change_log where row_key = '00000000-0000-0000-0000-0000000000a9'),
  'insert,update,update', 'Insert, rename and soft delete are logged; the unchanged re-save is not');
select is((select count(*) from change_log where row_key = '00000000-0000-0000-0000-0000000000a9' and actor_id = '00000000-0000-0000-0000-00000000000a'),
  3::bigint, 'each with A as the actor');
select is((select before->>'title' || ' -> ' || (after->>'title') from change_log
            where row_key = '00000000-0000-0000-0000-0000000000a9' and action = 'update' order by id limit 1),
  'New -> Renamed', 'with the row before and after');
select ok((select before is null and after->>'title' = 'New' and workspace_id = '00000000-0000-0000-0000-0000000000a1'
            from change_log where row_key = '00000000-0000-0000-0000-0000000000a9' and action = 'insert'),
  'An insert has no before, and is filed under its workspace');
select ok((select before->>'deleted_at' is null and after->>'deleted_at' is not null from change_log
            where row_key = '00000000-0000-0000-0000-0000000000a9' order by id desc limit 1),
  'The soft delete shows when it was deleted');
insert into items (workspace_id, owner_id, client_id, title, status, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000a', 'old', 'Old', 'todo', '2020-01-01', '2020-01-01');
select pg_temp.as_app('00000000-0000-0000-0000-00000000000a', 'with u as (update items set notes = ''n'' where client_id = ''old'' returning 1) select count(*)::text from u');
select ok((select updated_at > '2020-01-02' from items where client_id = 'old'), 'Each update stamps updated_at');
insert into items (workspace_id, owner_id, client_id, title, status, updated_at) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000a', 'old2', 'Old', 'todo', '2020-01-01');
select pg_temp.as_app('00000000-0000-0000-0000-00000000000a', 'with u as (update items set title = title where client_id = ''old2'' returning 1) select count(*)::text from u');
select is((select string_agg(action, ',') from change_log where table_name = 'items' and after->>'client_id' = 'old2'),
  'insert', 'A re-save that changes nothing but the write time is not logged');

-- Links, workspaces and memberships are logged too.
select pg_temp.as_app('00000000-0000-0000-0000-00000000000a', 'with d as (delete from item_links returning 1) select count(*)::text from d');
select is((select action || ' ' || row_key from change_log where table_name = 'item_links' order by id desc limit 1),
  'delete 00000000-0000-0000-0000-0000000000a3:00000000-0000-0000-0000-0000000000a4:depends_on',
  'Removing a dependency is logged, keyed by both items');
select pg_temp.as_app('00000000-0000-0000-0000-00000000000a', 'select app.create_workspace(''w2'', ''Second'')::text');
select is((select string_agg(table_name, ',' order by id) from change_log
            where actor_id = '00000000-0000-0000-0000-00000000000a' and table_name like 'workspace%'),
  'workspaces,workspace_members', 'A new workspace and its owner''s membership are logged');
select pg_temp.as_app('00000000-0000-0000-0000-00000000000a', 'with u as (update projects set name = ''House'' returning 1) select count(*)::text from u');
select is((select after->>'name' from change_log where table_name = 'projects' and action = 'update'), 'House', 'Project changes are logged');

-- Nobody rewrites history: the app can only read it, and not even the owner can edit it.
select matches(pg_temp.as_app('00000000-0000-0000-0000-00000000000a',
  'insert into change_log (workspace_id, table_name, row_key, action) values (''00000000-0000-0000-0000-0000000000a1'', ''items'', ''x'', ''insert'') returning ''ok'''),
  '^ERROR 42501: permission denied', 'The app can''t write log entries of its own');
select matches(pg_temp.as_app('00000000-0000-0000-0000-00000000000a',
  'with u as (update change_log set actor_id = null returning 1) select count(*)::text from u'),
  '^ERROR 42501: permission denied', 'nor change them');
select matches(pg_temp.as_app('00000000-0000-0000-0000-00000000000a', 'with d as (delete from change_log returning 1) select count(*)::text from d'),
  '^ERROR 42501: permission denied', 'nor delete them');
select throws_ok('update change_log set actor_id = null', '42501', 'change_log is append-only', 'The owner can''t change entries');
select throws_ok('delete from change_log', '42501', 'change_log is append-only', 'nor delete them');
select throws_ok('truncate change_log', '42501', 'change_log is append-only', 'nor empty the table');
select ok((select count(*) > 0 from change_log where actor_id is null), 'Changes made outside a request (the fixture) are logged with no actor');

select * from finish();
rollback;
