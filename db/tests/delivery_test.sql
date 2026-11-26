-- Step 3: stage templates, releases on product–partner pairs, and append-only sign-offs.
begin;
select plan(26);
\ir _fixture.sql

-- A: product, partner, their pair, a stage and a release; B: the same in its own workspace.
insert into products (id, workspace_id, owner_id, client_id, name) values
  ('00000000-0000-0000-0000-0000000004a1', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000a', 'loans', 'Loans'),
  ('00000000-0000-0000-0000-0000000004b1', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000000b', 'cards', 'Cards');
insert into partners (id, workspace_id, owner_id, client_id, name) values
  ('00000000-0000-0000-0000-0000000004a2', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000a', 'telco', 'Telco'),
  ('00000000-0000-0000-0000-0000000004a3', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000a', 'bank2', 'Bank 2'),
  ('00000000-0000-0000-0000-0000000004b2', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000000b', 'visa', 'Visa');
insert into product_partners (workspace_id, owner_id, client_id, product_id, partner_id) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000a', 'loans+telco', '00000000-0000-0000-0000-0000000004a1', '00000000-0000-0000-0000-0000000004a2'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000000b', 'cards+visa', '00000000-0000-0000-0000-0000000004b1', '00000000-0000-0000-0000-0000000004b2');
insert into stages (id, workspace_id, owner_id, client_id, name, sort_order, updated_at) values
  ('00000000-0000-0000-0000-0000000004a4', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000a', 'uat', 'UAT', 2, now() - interval '1 day'),
  ('00000000-0000-0000-0000-0000000004b4', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000000b', 'uat', 'UAT', 2, now());
insert into releases (id, workspace_id, owner_id, client_id, product_id, partner_id, name, updated_at) values
  ('00000000-0000-0000-0000-0000000004a5', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000a', 'r1', '00000000-0000-0000-0000-0000000004a1', '00000000-0000-0000-0000-0000000004a2', 'v1', now() - interval '1 day'),
  ('00000000-0000-0000-0000-0000000004b5', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000000b', 'r1', '00000000-0000-0000-0000-0000000004b1', '00000000-0000-0000-0000-0000000004b2', 'v1', now());
insert into signoffs (id, workspace_id, owner_id, client_id, release_id, stage_id, stage_name, outcome, approver, signed_at) values
  ('00000000-0000-0000-0000-0000000004b6', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000000b', 's1',
   '00000000-0000-0000-0000-0000000004b5', '00000000-0000-0000-0000-0000000004b4', 'UAT', 'passed', 'B''s approver', '2026-11-20 10:00');

-- A signs off its release as the app.
select is(pg_temp.as_app('00000000-0000-0000-0000-00000000000a', $$with i as (insert into signoffs
    (id, workspace_id, owner_id, client_id, release_id, stage_id, stage_name, outcome, approver, approver_role, signed_at, evidence_url)
    values ('00000000-0000-0000-0000-0000000004a6', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000a', 's1',
            '00000000-0000-0000-0000-0000000004a5', '00000000-0000-0000-0000-0000000004a4', 'UAT', 'failed', 'Jane Okello', 'Head of QA',
            '2026-11-25 14:30', 'https://bank.example/uat/123') returning 1) select count(*)::text from i$$),
  '1', 'A can record a sign-off on its release');
select is((select signed_at::text from signoffs where id = '00000000-0000-0000-0000-0000000004a6'), '2026-11-25 14:30:00',
  'The date and time are stored as entered');
select is(pg_temp.as_app('00000000-0000-0000-0000-00000000000a', $$with i as (insert into signoffs
    (workspace_id, owner_id, client_id, release_id, stage_id, stage_name, outcome, approver, signed_at, corrects_id, note)
    values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000a', 's2', '00000000-0000-0000-0000-0000000004a5',
            '00000000-0000-0000-0000-0000000004a4', 'UAT', 'passed', 'Jane Okello', '2026-11-25 16:00', '00000000-0000-0000-0000-0000000004a6',
            'Wrong outcome entered') returning 1) select count(*)::text from i$$),
  '1', 'A correction is a new sign-off naming the one it replaces');

-- Append-only for the app.
select alike(pg_temp.as_app('00000000-0000-0000-0000-00000000000a', $$with u as (update signoffs set outcome = 'passed' returning 1) select count(*)::text from u$$),
  'ERROR 42501%', 'The app can''t edit a sign-off');
select alike(pg_temp.as_app('00000000-0000-0000-0000-00000000000a', $$with d as (delete from signoffs returning 1) select count(*)::text from d$$),
  'ERROR 42501%', 'or delete one');
select alike(pg_temp.as_app('00000000-0000-0000-0000-00000000000a', $$with u as (update releases set product_id = product_id returning 1) select count(*)::text from u$$),
  'ERROR 42501%', 'A release can''t be moved to another pair');
select is(pg_temp.as_app('00000000-0000-0000-0000-00000000000a',
  $$with u as (update releases set name = 'v1.1', target_date = '2026-12-15', deleted_at = now() returning 1) select count(*)::text from u$$),
  '1', 'A can rename, date and delete its release');
select is(pg_temp.as_app('00000000-0000-0000-0000-00000000000a',
  $$with u as (update stages set name = 'User testing', sort_order = 3 returning 1) select count(*)::text from u$$),
  '1', 'and rename and reorder its stage');
select ok((select updated_at = now() from releases where id = '00000000-0000-0000-0000-0000000004a5'), 'Updates stamp updated_at on releases');
select ok((select updated_at = now() from stages where id = '00000000-0000-0000-0000-0000000004a4'), 'and on stages');

-- Workspace walls.
select is(pg_temp.as_app('00000000-0000-0000-0000-00000000000b', $$select count(*)::text from signoffs$$), '1', 'B sees only its own sign-offs');
select is(pg_temp.as_app('00000000-0000-0000-0000-00000000000b', $$select count(*)::text from releases$$), '1', 'and releases');
select is(pg_temp.as_app('00000000-0000-0000-0000-00000000000b', $$select count(*)::text from stages$$), '1', 'and stages');
select alike(pg_temp.as_app('00000000-0000-0000-0000-00000000000b', $$with i as (insert into signoffs
    (workspace_id, owner_id, client_id, release_id, stage_id, stage_name, outcome, approver, signed_at)
    values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000b', 'x', '00000000-0000-0000-0000-0000000004a5',
            '00000000-0000-0000-0000-0000000004a4', 'UAT', 'passed', 'Mallory', '2026-11-25 10:00') returning 1) select count(*)::text from i$$),
  'ERROR 42501%', 'B can''t sign off in A''s workspace');
select alike(pg_temp.as_app('00000000-0000-0000-0000-00000000000b', $$with i as (insert into releases
    (workspace_id, owner_id, client_id, product_id, partner_id, name)
    values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000b', 'x', '00000000-0000-0000-0000-0000000004a1',
            '00000000-0000-0000-0000-0000000004a2', 'Sneaky') returning 1) select count(*)::text from i$$),
  'ERROR 42501%', 'or add a release there');
select alike(pg_temp.as_app('00000000-0000-0000-0000-00000000000b', $$with i as (insert into stages (workspace_id, owner_id, client_id, name)
    values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000b', 'x', 'Sneaky') returning 1) select count(*)::text from i$$),
  'ERROR 42501%', 'or a stage');

-- What a release and a sign-off must hold.
select throws_ok($$insert into releases (workspace_id, owner_id, client_id, product_id, partner_id, name) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000a', 'r9', '00000000-0000-0000-0000-0000000004a1', '00000000-0000-0000-0000-0000000004a3', 'v9')$$,
  '23503', null, 'A release is only for a product and partner that are a pair');
select throws_ok($$insert into signoffs (workspace_id, owner_id, client_id, release_id, stage_id, stage_name, outcome, approver, signed_at) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000a', 's9', '00000000-0000-0000-0000-0000000004a5',
   '00000000-0000-0000-0000-0000000004b4', 'UAT', 'passed', 'Jane', '2026-11-25 10:00')$$,
  '23503', null, 'A sign-off''s stage is in its own workspace');
select throws_ok($$insert into signoffs (workspace_id, owner_id, client_id, release_id, stage_id, stage_name, outcome, approver, signed_at, corrects_id) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000a', 's9', '00000000-0000-0000-0000-0000000004a5',
   '00000000-0000-0000-0000-0000000004a4', 'UAT', 'passed', 'Jane', '2026-11-25 10:00', '00000000-0000-0000-0000-0000000004b6')$$,
  '23503', null, 'and corrects only a sign-off there');
select throws_ok($$insert into signoffs (workspace_id, owner_id, client_id, release_id, stage_id, stage_name, outcome, approver, signed_at, evidence_url) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000a', 's9', '00000000-0000-0000-0000-0000000004a5',
   '00000000-0000-0000-0000-0000000004a4', 'UAT', 'passed', 'Jane', '2026-11-25 10:00', 'javascript:alert(1)')$$,
  '23514', null, 'Evidence is a web link, nothing else');
select throws_ok($$insert into signoffs (workspace_id, owner_id, client_id, release_id, stage_id, stage_name, outcome, approver, signed_at) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000a', 's9', '00000000-0000-0000-0000-0000000004a5',
   '00000000-0000-0000-0000-0000000004a4', 'UAT', 'maybe', 'Jane', '2026-11-25 10:00')$$,
  '23514', null, 'The outcome is passed, failed or waived');
select throws_ok($$insert into signoffs (workspace_id, owner_id, client_id, release_id, stage_id, stage_name, outcome, approver, signed_at) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000a', 's9', '00000000-0000-0000-0000-0000000004a5',
   '00000000-0000-0000-0000-0000000004a4', 'UAT', 'passed', '  ', '2026-11-25 10:00')$$,
  '23514', null, 'Every sign-off names its approver');

select throws_ok($$insert into signoffs (id, workspace_id, owner_id, client_id, release_id, stage_id, stage_name, outcome, approver, signed_at, corrects_id) values
  ('00000000-0000-0000-0000-0000000004a9', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000a', 's9', '00000000-0000-0000-0000-0000000004a5',
   '00000000-0000-0000-0000-0000000004a4', 'UAT', 'passed', 'Jane', '2026-11-25 10:00', '00000000-0000-0000-0000-0000000004a9')$$,
  '23514', null, 'A sign-off can''t correct itself');
select has_index('signoffs', 'signoffs_release', 'A release''s sign-offs are found by release');

select is((select string_agg(action || ' by ' || coalesce(actor_id::text, '-'), ',' order by id) from change_log where table_name = 'signoffs'
            and workspace_id = '00000000-0000-0000-0000-0000000000a1'),
  'insert by 00000000-0000-0000-0000-00000000000a,insert by 00000000-0000-0000-0000-00000000000a', 'Sign-offs are logged as the user who recorded them');
select lives_ok($$insert into legacy_deletions (workspace_id, kind, client_id, deleted_at) values
  ('00000000-0000-0000-0000-0000000000a1', 'release', 'old-r', now()), ('00000000-0000-0000-0000-0000000000a1', 'stage', 'old-s', now())$$,
  'Deletions the old store remembered can be of releases and stages');

select * from finish();
rollback;
