-- Erasing a person's name: the owner's app.redact(), and the log's append-only rule around it.
begin;
select plan(16);
\ir _fixture.sql

-- A's workspace mentions Jane Okello in an item, a sign-off and (through the triggers) the log;
-- B's workspace mentions her too, and must keep it.
insert into products (id, workspace_id, owner_id, client_id, name) values
  ('00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000a', 'loans', 'Loans');
insert into partners (id, workspace_id, owner_id, client_id, name) values
  ('00000000-0000-0000-0000-0000000005a2', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000a', 'telco', 'Telco');
insert into product_partners (workspace_id, owner_id, client_id, product_id, partner_id) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000a', 'loans+telco', '00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-0000000005a2');
insert into stages (id, workspace_id, owner_id, client_id, name) values
  ('00000000-0000-0000-0000-0000000005a3', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000a', 'uat', 'UAT');
insert into releases (id, workspace_id, owner_id, client_id, product_id, partner_id, name) values
  ('00000000-0000-0000-0000-0000000005a4', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000a', 'r1',
   '00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-0000000005a2', 'v1');
select pg_temp.as_app('00000000-0000-0000-0000-00000000000a', $$with i as (insert into signoffs
    (workspace_id, owner_id, client_id, release_id, stage_id, stage_name, outcome, approver, approver_role, signed_at, note)
    values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000a', 's1', '00000000-0000-0000-0000-0000000005a4',
            '00000000-0000-0000-0000-0000000005a3', 'UAT', 'passed', 'Jane Okello', 'Head of QA', '2026-11-25 14:30', 'Checked with Jane Okello') returning 1)
    select count(*)::text from i$$);
select pg_temp.as_app('00000000-0000-0000-0000-00000000000a',
  $$with u as (update items set title = 'Call Jane Okello', waiting_on = 'Jane Okello', details = '{"onWhom": "Jane Okello"}',
                 subtasks = '[{"text": "Email Jane Okello", "done": false}]', edited_at = '2026-11-01'
                where client_id = 'ia1' returning 1) select count(*)::text from u$$);
update items set notes = 'Jane Okello said yes' where client_id = 'ib1';

select is(pg_temp.as_app('00000000-0000-0000-0000-00000000000a', $$select app.redact('00000000-0000-0000-0000-0000000000a1', 'Jane Okello')::text$$),
  'ERROR 42501: permission denied for function redact', 'The app can''t run a redaction');
select alike(pg_temp.as_app('00000000-0000-0000-0000-00000000000a', $$with i as (insert into app.redacting values (txid_current()) returning 1) select count(*)::text from i$$),
  'ERROR 42501%', 'nor switch off the log');
select throws_ok($$select app.redact('00000000-0000-0000-0000-0000000000a1', 'Jo')$$, '22023', null, 'A redaction needs a whole name');
select throws_ok($$select app.redact('00000000-0000-0000-0000-0000000000a1', 'approver')$$, '22023', null, 'not a word that could be a field name');
select throws_ok($$select app.redact('00000000-0000-0000-0000-0000000000a1', 'Jane Okello', 'Jane Okello Jr')$$, '22023', null,
  'and a replacement without the text');

select is(app.redact('00000000-0000-0000-0000-0000000000a1', 'Jane Okello', '[removed]', 'Request 2026-11-27'), 2,
  'The owner''s redaction changes the item and the sign-off');
select is((select title || ' | ' || waiting_on || ' | ' || (details ->> 'onWhom') || ' | ' || (subtasks -> 0 ->> 'text') from items where client_id = 'ia1'),
  'Call [removed] | [removed] | [removed] | Email [removed]', 'in every text of the item');
select is((select approver || ' | ' || note from signoffs where client_id = 's1'), '[removed] | Checked with [removed]', 'and of the sign-off');
select ok((select edited_at > '2026-11-02' from items where client_id = 'ia1'), 'The item is stamped, so older device copies lose to it');
select is((select count(*)::int from change_log where workspace_id = '00000000-0000-0000-0000-0000000000a1'
            and (coalesce(before::text, '') || coalesce(after::text, '')) like '%Jane Okello%'), 0, 'The log no longer holds the name');
select is((select count(*)::int from change_log where workspace_id = '00000000-0000-0000-0000-0000000000a1' and action = 'update'
            and changed_at >= (select max(changed_at) from change_log where action = 'redact')), 0, 'The redaction''s own edits aren''t logged as updates');
select is((select after from change_log where action = 'redact'), '{"rows": 2, "reason": "Request 2026-11-27", "log_entries": 2}'::jsonb,
  'One entry records the redaction: how many rows, never what');
select is((select notes from items where client_id = 'ib1'), 'Jane Okello said yes', 'Other workspaces keep the text');

select throws_ok($$update change_log set after = '{}'$$, '42501', null, 'Outside a redaction the log stays append-only, even for the owner');
select throws_ok($$delete from change_log$$, '42501', null, 'and can''t be deleted');
select is((select count(*)::int from app.redacting), 0, 'The marker is cleared when the redaction ends');

select * from finish();
rollback;
