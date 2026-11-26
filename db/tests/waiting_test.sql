-- Step 2: waiting on, chase date and snooze on items.
begin;
select plan(7);
\ir _fixture.sql

select col_default_is('items', 'waiting_on', '', 'An item waits on nobody unless set');
select is((select count(*)::int from items where waiting_on <> '' or chase_on is not null or snoozed_until is not null), 0,
  'Existing items are not waiting or snoozed');
select has_index('items', 'items_chase', 'Items to chase are found by date');

select is(pg_temp.as_app('00000000-0000-0000-0000-00000000000a',
  $$with u as (update items set waiting_on = 'Telco IT', chase_on = '2026-12-01', snoozed_until = '2026-11-30' where client_id = 'ia1' returning 1)
    select count(*)::text from u$$), '1', 'A can set who an item waits on, its chase date and a snooze');
select is((select waiting_on || ' ' || chase_on || ' ' || snoozed_until from items where client_id = 'ia1'),
  'Telco IT 2026-12-01 2026-11-30', 'and they are stored');
select is(pg_temp.as_app('00000000-0000-0000-0000-00000000000b',
  $$with u as (update items set waiting_on = 'Someone' where client_id = 'ia1' returning 1) select count(*)::text from u$$), '0',
  'B can''t change A''s item');
select is((select after ->> 'waiting_on' from change_log where table_name = 'items' and action = 'update' order by changed_at desc, id desc limit 1),
  'Telco IT', 'The change is logged with the new value');

select * from finish();
rollback;
