-- Step 4: finish dates and a recurring item's finished occurrences.
begin;
select plan(5);
\ir _fixture.sql

select col_default_is('items', 'completions', '{}', 'An item has no finished occurrences to begin with');
select has_index('items', 'items_completed', 'What was finished in a week is found by date');
select is(pg_temp.as_app('00000000-0000-0000-0000-00000000000a',
  $$with u as (update items set completed_on = '2026-11-27', completions = '{2026-11-20,2026-11-27}' where client_id = 'ia1' returning 1)
    select count(*)::text from u$$), '1', 'A can record when its item was finished');
select is((select completed_on || ' ' || completions::text from items where client_id = 'ia1'), '2026-11-27 {2026-11-20,2026-11-27}', 'and it is stored');
select is((select after ->> 'completions' from change_log where table_name = 'items' and action = 'update' order by changed_at desc, id desc limit 1),
  '["2026-11-20", "2026-11-27"]', 'The change is logged');

select * from finish();
rollback;
