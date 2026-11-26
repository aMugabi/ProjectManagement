-- Workspace walls: no query by the app returns, changes or creates another workspace's data.
begin;
select plan(36);
\ir _fixture.sql

-- Fails closed: nothing is visible until a request says who the user is (first, while unset).
select is(pg_temp.as_app(null, 'select count(*)::text from items', false), '0', 'With no user set, the app sees no items');
select is(pg_temp.as_app(null, 'select count(*)::text from workspaces'), '0', 'With the user set to empty, it sees no workspaces');
select matches(pg_temp.as_app('not-a-uuid', 'select count(*)::text from items'), '^ERROR 22P02', 'A user id that is not a uuid is an error, not a guess');

-- Reading
select is(pg_temp.as_app('00000000-0000-0000-0000-00000000000a', 'select string_agg(client_id, '','' order by client_id) from items'), 'ia1,ia2', 'A sees only the items in A''s workspace');
select is(pg_temp.as_app('00000000-0000-0000-0000-00000000000b', 'select string_agg(client_id, '','' order by client_id) from items'), 'ib1,ib2', 'B sees only B''s');
select is(pg_temp.as_app('00000000-0000-0000-0000-00000000000a', 'select string_agg(client_id, '','') from workspaces'), 'wa', 'A sees only A''s workspace');
select is(pg_temp.as_app('00000000-0000-0000-0000-00000000000a', 'select string_agg(user_id::text, '','') from workspace_members'), '00000000-0000-0000-0000-00000000000a', 'and only its memberships');
select is(pg_temp.as_app('00000000-0000-0000-0000-00000000000a', 'select string_agg(client_id, '','') from projects'), 'pa', 'and only its projects');
select is(pg_temp.as_app('00000000-0000-0000-0000-00000000000a', 'select count(*)::text from item_links'), '1', 'and its links');
select is(pg_temp.as_app('00000000-0000-0000-0000-00000000000b', 'select count(*)::text from item_links'), '0', 'B doesn''t see A''s links');
select is(pg_temp.as_app('00000000-0000-0000-0000-00000000000a', 'select string_agg(client_id, '','') from legacy_deletions'), 'gone-a', 'Each sees only its own remembered deletions');
select is(pg_temp.as_app('00000000-0000-0000-0000-00000000000a',
  'select (count(*) > 0 and bool_and(workspace_id = ''00000000-0000-0000-0000-0000000000a1''))::text from change_log'), 'true',
  'The change log shows A only A''s workspace''s history');
select is(pg_temp.as_app('00000000-0000-0000-0000-00000000000a', 'select string_agg(reminders->>''digestTime'', '','') from user_settings'), '08:00', 'A sees only A''s own settings');
select is(pg_temp.as_app('00000000-0000-0000-0000-00000000000a', 'select string_agg(left(endpoint_hash, 1), '','') from push_subscriptions'), 'a', 'and only A''s push subscriptions');
select is(pg_temp.as_app('00000000-0000-0000-0000-00000000000a', 'select string_agg(reminder_key, '','') from reminders_sent'), 'digest:a', 'and only A''s sent reminders');
select is(pg_temp.as_app('00000000-0000-0000-0000-00000000000a', 'select string_agg(type, '','') from item_types'), 'task', 'Item types are shared reference data');

-- Changing and creating
select is(pg_temp.as_app('00000000-0000-0000-0000-00000000000a',
  'with u as (update items set title = ''x'' where client_id = ''ib1'' returning 1) select count(*)::text from u'), '0',
  'A can''t change B''s items (they aren''t there for A)');
select matches(pg_temp.as_app('00000000-0000-0000-0000-00000000000a',
  'insert into items (workspace_id, owner_id, client_id, title, status) values (''00000000-0000-0000-0000-0000000000b1'', ''00000000-0000-0000-0000-00000000000a'', ''sneak'', ''Sneak'', ''todo'') returning ''ok'''),
  '^ERROR 42501: new row violates row-level security', 'A can''t add an item to B''s workspace');
select matches(pg_temp.as_app('00000000-0000-0000-0000-00000000000a',
  'insert into projects (workspace_id, owner_id, client_id, name) values (''00000000-0000-0000-0000-0000000000b1'', ''00000000-0000-0000-0000-00000000000a'', ''sneak'', ''Sneak'') returning ''ok'''),
  '^ERROR 42501: new row violates row-level security', 'nor a project');
select matches(pg_temp.as_app('00000000-0000-0000-0000-00000000000a',
  'insert into item_links (workspace_id, owner_id, from_id, to_id) values (''00000000-0000-0000-0000-0000000000b1'', ''00000000-0000-0000-0000-00000000000a'', ''00000000-0000-0000-0000-0000000000b3'', ''00000000-0000-0000-0000-0000000000b4'') returning ''ok'''),
  '^ERROR 42501: new row violates row-level security', 'nor link two of B''s items');
select matches(pg_temp.as_app('00000000-0000-0000-0000-00000000000a',
  'with u as (update items set workspace_id = ''00000000-0000-0000-0000-0000000000b1'' where client_id = ''ia2'' returning 1) select count(*)::text from u'),
  '^ERROR 42501: permission denied', 'A can''t move an item into another workspace');
select matches(pg_temp.as_app('00000000-0000-0000-0000-00000000000a',
  'with u as (update items set owner_id = ''00000000-0000-0000-0000-00000000000b'' where client_id = ''ia2'' returning 1) select count(*)::text from u'),
  '^ERROR 42501: permission denied', 'or give it to another owner');
select matches(pg_temp.as_app('00000000-0000-0000-0000-00000000000a',
  'with u as (update workspaces set owner_id = ''00000000-0000-0000-0000-00000000000b'' returning 1) select count(*)::text from u'),
  '^ERROR 42501: permission denied', 'or hand its workspace to someone else');
select matches(pg_temp.as_app('00000000-0000-0000-0000-00000000000a',
  'with u as (update projects set workspace_id = ''00000000-0000-0000-0000-0000000000b1'' returning 1) select count(*)::text from u'),
  '^ERROR 42501: permission denied', 'nor move a project');
select matches(pg_temp.as_app('00000000-0000-0000-0000-00000000000a', 'delete from items where client_id = ''ia2'' returning ''x'''),
  '^ERROR 42501: permission denied', 'The app can''t delete items: deletion is soft');
select matches(pg_temp.as_app('00000000-0000-0000-0000-00000000000a',
  'insert into workspaces (owner_id, client_id, name) values (''00000000-0000-0000-0000-00000000000a'', ''w2'', ''W2'') returning ''ok'''),
  '^ERROR 42501: permission denied', 'The app can''t insert a workspace directly');
select matches(pg_temp.as_app('00000000-0000-0000-0000-00000000000a',
  'insert into workspace_members (workspace_id, user_id) values (''00000000-0000-0000-0000-0000000000b1'', ''00000000-0000-0000-0000-00000000000a'') returning ''ok'''),
  '^ERROR 42501: permission denied', 'nor join B''s workspace');
select matches(pg_temp.as_app('00000000-0000-0000-0000-00000000000a',
  'insert into items (workspace_id, owner_id, client_id, project_id, title, status) values (''00000000-0000-0000-0000-0000000000a1'', ''00000000-0000-0000-0000-00000000000a'', ''x1'', ''00000000-0000-0000-0000-0000000000b2'', ''X'', ''todo'') returning ''ok'''),
  '^ERROR 23503', 'A can''t file an item under B''s project');
select matches(pg_temp.as_app('00000000-0000-0000-0000-00000000000a',
  'insert into item_links (workspace_id, owner_id, from_id, to_id) values (''00000000-0000-0000-0000-0000000000a1'', ''00000000-0000-0000-0000-00000000000a'', ''00000000-0000-0000-0000-0000000000a3'', ''00000000-0000-0000-0000-0000000000b3'') returning ''ok'''),
  '^ERROR 23503', 'nor make an item depend on one of B''s');
select matches(pg_temp.as_app('00000000-0000-0000-0000-00000000000a',
  'insert into item_links (workspace_id, owner_id, from_id, to_id) values (''00000000-0000-0000-0000-0000000000a1'', ''00000000-0000-0000-0000-00000000000a'', ''00000000-0000-0000-0000-0000000000b3'', ''00000000-0000-0000-0000-0000000000a3'') returning ''ok'''),
  '^ERROR 23503', 'nor make one of B''s depend on one of A''s');

-- Creating a workspace through the one function that allows it
select matches(pg_temp.as_app('00000000-0000-0000-0000-00000000000a', 'select app.create_workspace(''w2'', ''Second'')::text'),
  '^[0-9a-f-]{36}$', 'A creates a workspace through app.create_workspace');
select is(pg_temp.as_app('00000000-0000-0000-0000-00000000000a', 'select string_agg(client_id, '','' order by client_id) from workspaces'),
  'w2,wa', 'and is its member at once, so A sees it');
select is(pg_temp.as_app('00000000-0000-0000-0000-00000000000b', 'select string_agg(client_id, '','' order by client_id) from workspaces'),
  'wb', 'B still sees only B''s');
select matches(pg_temp.as_app(null, 'select app.create_workspace(''w3'', ''Nobody'')::text'),
  '^ERROR 42501: no user', 'With no user set, no workspace can be created');

-- The app role itself
select is((select rolbypassrls from pg_roles where rolname = 'ledger_app'), false, 'ledger_app can''t bypass row-level security');
select is((select string_agg(relname, ',' order by relname) from pg_class
            where relkind = 'r' and relnamespace = 'public'::regnamespace and not relrowsecurity),
  'identities,item_types,login_attempts,mfa_factors,sessions,used_codes,users',
  'Every table has row-level security except the sign-in tables and shared reference data');

select * from finish();
rollback;
