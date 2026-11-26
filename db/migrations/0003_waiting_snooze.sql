-- Ledger 0003: who or what an item waits on, when to chase them, and snoozing (build plan Step 2).
-- An item waits on someone ('' = nobody) and may have a date to chase them; a snoozed item stays
-- out of reminders and the dashboard until its date. All three sync across devices like any edit.
alter table items
  add column waiting_on text not null default '',
  add column chase_on date,
  add column snoozed_until date;

grant update (waiting_on, chase_on, snoozed_until) on items to ledger_app;

-- The Waiting-on view and the digest find items to chase by date.
create index items_chase on items (workspace_id, chase_on) where deleted_at is null and chase_on is not null;
