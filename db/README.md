# Ledger's Postgres database (build plan Step 1a)

Plain PostgreSQL 15 or later. Not used by the app yet: the current deploy still stores everything
in Upstash Redis. The move is planned in the build plan (Step 1a), with a dry run on a copy first.

- `migrations/`: applied in order by the owner role (the role that owns every table).
- `tests/*_test.sql`: pgTAP tests, each in its own rolled-back transaction, sharing
  `tests/_fixture.sql` (two users, two workspaces, and `as_app()`, which runs one statement as the
  app role for a given user).
- `breaks.json`: one deliberate break per rule in `0001_foundation.sql`. Every one must make a test
  fail (61 of 61 at the time of writing).

## Rules the database enforces
- **Workspace walls.** The app connects as a member of `ledger_app`, which owns nothing and can't
  bypass row-level security. Each request sets `app.user_id`; the policies then show only that
  user's workspaces. With no user set, the app sees nothing.
- **Soft delete only.** The app can't delete workspaces, projects or items, can't move rows to
  another workspace or owner (column-level update grants), and can't join a workspace except
  through `app.create_workspace`.
- **Append-only change log.** A trigger owned by the owner role records every insert, update and
  delete of workspace data, with the actor, the time, and the row before and after. The app can
  only read its own workspaces' entries; no role can update, delete or truncate the log.
- **Account tables** (users, identities, sessions, MFA) have no policies: sign-in reads them before
  anyone is signed in, and only the sign-in module touches them.

## Running the tests (offline, in a throwaway container)
Uses the `offline-database-tests` skill's scripts and a local image with Postgres 17 and pgTAP
(nothing is pulled; no network):

```bash
export DB_IMAGE=public.ecr.aws/supabase/postgres:17.12.0.002
bash ~/.claude/skills/offline-database-tests/scripts/db-test.sh db
python3 ~/.claude/skills/offline-database-tests/scripts/mutate.py db migrations/0001_foundation.sql db/breaks.json --jobs 4
```

## Setting up a real database (when the host is chosen)
1. Create the database; run the migrations as its owner.
2. Create the app's login role, a member of `ledger_app` and nothing else:
   `create role ledger_app_login login password '<long random>' in role ledger_app;`
3. Give the app only that role's connection string (`DATABASE_URL`); keep the owner's for
   migrations and the import.
