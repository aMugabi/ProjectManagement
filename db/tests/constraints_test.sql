-- Column rules: values the app must never be able to store.
begin;
select plan(8);
\ir _fixture.sql

select throws_ok($$insert into items (workspace_id, owner_id, client_id, title, status) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000a', 'c1', 'C', 'maybe')$$,
  '23503', null, 'A task''s status is one of todo, doing, blocked, done');
select throws_ok($$insert into items (workspace_id, owner_id, client_id, title, status, priority) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000a', 'c2', 'C', 'todo', 'urgent')$$,
  '23514', null, 'Priority is high, med or low');
select throws_ok($$insert into items (workspace_id, owner_id, client_id, title, status, type) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000a', 'c3', 'C', 'todo', 'idea')$$,
  '23503', null, 'An item''s type must be a known one');
select throws_ok($$insert into items (workspace_id, owner_id, client_id, title, status) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000a', 'ia1', 'Dup', 'todo')$$,
  '23505', null, 'A device id is unique within its workspace');
select throws_ok($$insert into item_links (workspace_id, owner_id, from_id, to_id) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000a3')$$,
  '23514', null, 'An item can''t depend on itself');
select throws_ok($$insert into users (email) values ('Someone@Example.org')$$, '23514', null, 'Emails are stored in lower case');
select throws_ok($$insert into identities (user_id, provider, subject) values
  ('00000000-0000-0000-0000-00000000000a', 'password', 'a@example.org'),
  ('00000000-0000-0000-0000-00000000000b', 'password', 'a@example.org')$$,
  '23505', null, 'One identity belongs to one user (matched by provider and subject, never email)');
select throws_ok($$insert into sessions (token_hash, user_id, expires_at) values ('not-a-hash', '00000000-0000-0000-0000-00000000000a', now())$$,
  '23514', null, 'Sessions store a SHA-256 hash, never a token');

select * from finish();
rollback;
