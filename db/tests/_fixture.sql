-- Included by each *_test.sql (\ir _fixture.sql), inside its transaction: two users, each with a
-- workspace, a project, items, a link, a legacy deletion, settings and a push subscription; and
-- as_app(), which runs one statement as the app role for a user.
--   A = ...0a  workspace wa  project pa  items ia1 (in pa), ia2; ia1 depends on ia2
--   B = ...0b  workspace wb  project pb  items ib1 (in pb), ib2

-- Runs p_sql as ledger_app with app.user_id = p_user and returns its single value as text, or
-- 'ERROR <sqlstate>: <message>'. pgTAP keeps running as the test's own role. p_set = false
-- leaves app.user_id untouched (for the "never set" case).
create function pg_temp.as_app(p_user text, p_sql text, p_set boolean default true) returns text
  language plpgsql as $$
declare
  result text;
begin
  execute 'set local role ledger_app';
  if p_set then
    perform set_config('app.user_id', coalesce(p_user, ''), true);
  end if;
  begin
    execute p_sql into result;
  exception when others then
    result := 'ERROR ' || sqlstate || ': ' || sqlerrm;
  end;
  execute format('set local role %I', session_user);
  return result;
end $$;

insert into users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'a@example.org'),
  ('00000000-0000-0000-0000-00000000000b', 'b@example.org');
insert into workspaces (id, owner_id, client_id, name) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000a', 'wa', 'A''s'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000000b', 'wb', 'B''s');
insert into workspace_members (workspace_id, user_id) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000a'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000000b');
insert into projects (id, workspace_id, owner_id, client_id, name) values
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000a', 'pa', 'Home'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000000b', 'pb', 'Work');
insert into items (id, workspace_id, owner_id, client_id, project_id, title, status, due_date) values
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000a', 'ia1', '00000000-0000-0000-0000-0000000000a2', 'A one', 'todo', '2026-12-01'),
  ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000a', 'ia2', null, 'A two', 'doing', '2026-12-02'),
  ('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000000b', 'ib1', '00000000-0000-0000-0000-0000000000b2', 'B one', 'todo', '2026-12-03'),
  ('00000000-0000-0000-0000-0000000000b4', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000000b', 'ib2', null, 'B two', 'todo', '2026-12-04');
insert into item_links (workspace_id, owner_id, from_id, to_id) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000a4');
insert into legacy_deletions (workspace_id, kind, client_id, deleted_at) values
  ('00000000-0000-0000-0000-0000000000a1', 'task', 'gone-a', now()),
  ('00000000-0000-0000-0000-0000000000b1', 'task', 'gone-b', now());
insert into user_settings (user_id, reminders) values
  ('00000000-0000-0000-0000-00000000000a', '{"digestTime": "08:00"}'),
  ('00000000-0000-0000-0000-00000000000b', '{"digestTime": "09:00"}');
insert into push_subscriptions (user_id, endpoint_hash, subscription) values
  ('00000000-0000-0000-0000-00000000000a', repeat('a', 64), '{}'),
  ('00000000-0000-0000-0000-00000000000b', repeat('b', 64), '{}');
insert into reminders_sent (user_id, reminder_key) values
  ('00000000-0000-0000-0000-00000000000a', 'digest:a'),
  ('00000000-0000-0000-0000-00000000000b', 'digest:b');
