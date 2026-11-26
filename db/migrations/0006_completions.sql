-- Ledger 0006: when items were finished (build plan Step 4, reports). An item has the date it was
-- last finished (cleared when reopened); a recurring item keeps the dates of its finished
-- occurrences, which otherwise vanish when it rolls over to the next one.
alter table items
  add column completed_on date,
  add column completions date[] not null default '{}';

grant update (completed_on, completions) on items to ledger_app;

-- Reports look for what was finished in a week.
create index items_completed on items (workspace_id, completed_on) where deleted_at is null and completed_on is not null;
