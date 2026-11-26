-- Ledger 0005: erasing personal data (the retention decision, build plan Step 1b, built with
-- Step 3). Items are kept and the change log is append-only, so a person's name is removed by the
-- owner role with app.redact(): it replaces the text in one workspace's items, sign-offs, names
-- and change-log entries, stamps the edited rows (so devices' older copies don't bring the text
-- back on sync), and records one 'redact' entry that says how many rows changed, never what.
-- The app role can't run it, and can't switch off the log: the marker table is the owner's.

create table app.redacting (txid bigint primary key);

alter table change_log drop constraint change_log_action_check;
alter table change_log add constraint change_log_action_check check (action in ('insert', 'update', 'delete', 'baseline', 'redact'));

-- The log stays append-only, except for the owner's redaction in its own transaction.
create or replace function app.refuse_change_log_edits() returns trigger
  language plpgsql
  as $$
begin
  if tg_op = 'UPDATE' and exists (select 1 from app.redacting where txid = txid_current()) then
    return new;
  end if;
  raise exception 'change_log is append-only' using errcode = '42501';
end $$;

-- As in 0001, but a redaction's own edits aren't logged (their 'before' would hold the text).
create or replace function app.log_change() returns trigger
  language plpgsql security definer set search_path = pg_catalog, public
as $$
declare
  old_row jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  new_row jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  row_data jsonb := coalesce(new_row, old_row);
  key text;
begin
  if exists (select 1 from app.redacting where txid = txid_current()) then
    return null;
  end if;
  -- A write that changed nothing but the write time isn't a change.
  if tg_op = 'UPDATE' and (new_row - 'updated_at') = (old_row - 'updated_at') then
    return null;
  end if;
  select string_agg(row_data ->> k, ':' order by n) into key
    from unnest(tg_argv[1:]) with ordinality as cols(k, n);
  insert into public.change_log (workspace_id, table_name, row_key, action, actor_id, before, after)
    values ((row_data ->> tg_argv[0])::uuid, tg_table_name, key, lower(tg_op), app.user_id(), old_row, new_row);
  return null;
end $$;

-- Replaces p_text with p_replacement throughout one workspace; returns the number of rows changed
-- (change-log entries not counted). Say a whole name: at least 3 characters, and not a bare
-- lower-case word, which could be a field name inside the logged rows.
create function app.redact(p_workspace uuid, p_text text, p_replacement text default '[removed]', p_reason text default '') returns integer
  language plpgsql security definer set search_path = pg_catalog, public
as $$
declare
  -- The text as it appears inside JSON (quotes and backslashes escaped).
  j_text text := substr(to_jsonb(p_text)::text, 2, length(to_jsonb(p_text)::text) - 2);
  j_repl text := substr(to_jsonb(p_replacement)::text, 2, length(to_jsonb(p_replacement)::text) - 2);
  changed integer := 0;
  logged integer := 0;
  c integer;
begin
  if length(btrim(coalesce(p_text, ''))) < 3 or p_text ~ '^[a-z_]+$' then
    raise exception 'say the whole name to remove (at least 3 characters, not a bare lower-case word)' using errcode = '22023';
  end if;
  if coalesce(p_replacement, '') = '' or strpos(p_replacement, p_text) > 0 then
    raise exception 'the replacement must be non-empty and must not contain the text' using errcode = '22023';
  end if;
  if not exists (select 1 from public.workspaces where id = p_workspace) then
    raise exception 'no such workspace' using errcode = '22023';
  end if;
  insert into app.redacting values (txid_current());

  update public.items set title = replace(title, p_text, p_replacement), notes = replace(notes, p_text, p_replacement),
         waiting_on = replace(waiting_on, p_text, p_replacement),
         details = replace(details::text, j_text, j_repl)::jsonb, subtasks = replace(subtasks::text, j_text, j_repl)::jsonb,
         edited_at = clock_timestamp()
   where workspace_id = p_workspace
     and (strpos(title, p_text) > 0 or strpos(notes, p_text) > 0 or strpos(waiting_on, p_text) > 0
          or strpos(details::text, j_text) > 0 or strpos(subtasks::text, j_text) > 0);
  get diagnostics c = row_count;
  changed := changed + c;
  update public.signoffs set approver = replace(approver, p_text, p_replacement), approver_role = replace(approver_role, p_text, p_replacement),
         note = replace(note, p_text, p_replacement)
   where workspace_id = p_workspace and (strpos(approver, p_text) > 0 or strpos(approver_role, p_text) > 0 or strpos(note, p_text) > 0);
  get diagnostics c = row_count;
  changed := changed + c;
  update public.releases set name = replace(name, p_text, p_replacement), edited_at = clock_timestamp()
   where workspace_id = p_workspace and strpos(name, p_text) > 0;
  get diagnostics c = row_count;
  changed := changed + c;
  update public.projects set name = replace(name, p_text, p_replacement), edited_at = clock_timestamp()
   where workspace_id = p_workspace and strpos(name, p_text) > 0;
  get diagnostics c = row_count;
  changed := changed + c;
  update public.products set name = replace(name, p_text, p_replacement), edited_at = clock_timestamp()
   where workspace_id = p_workspace and strpos(name, p_text) > 0;
  get diagnostics c = row_count;
  changed := changed + c;
  update public.partners set name = replace(name, p_text, p_replacement), edited_at = clock_timestamp()
   where workspace_id = p_workspace and strpos(name, p_text) > 0;
  get diagnostics c = row_count;
  changed := changed + c;

  update public.change_log set before = replace(before::text, j_text, j_repl)::jsonb, after = replace(after::text, j_text, j_repl)::jsonb
   where workspace_id = p_workspace and (strpos(coalesce(before::text, ''), j_text) > 0 or strpos(coalesce(after::text, ''), j_text) > 0);
  get diagnostics logged = row_count;

  delete from app.redacting where txid = txid_current();
  insert into public.change_log (workspace_id, table_name, row_key, action, actor_id, after)
    values (p_workspace, 'redaction', p_workspace::text, 'redact', null,
            jsonb_build_object('rows', changed, 'log_entries', logged, 'reason', coalesce(p_reason, '')));
  return changed;
end $$;
revoke all on function app.redact(uuid, text, text, text) from public;
