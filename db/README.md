# Ledger's Postgres database (build plan Step 1a)

Plain PostgreSQL 15 or later. Not used by the app yet: the current deploy still stores everything
in Upstash Redis. The move is planned in the build plan (Step 1a), with a dry run on a copy first.

- `migrations/`: applied in order by the owner role (the role that owns every table).
- `tests/*_test.sql`: pgTAP tests, each in its own rolled-back transaction, sharing
  `tests/_fixture.sql` (two users, two workspaces, and `as_app()`, which runs one statement as the
  app role for a given user).
- `breaks.json` (0001), `breaks-0002.json` (0002), `breaks-0003.json` (0003, Step 2: waiting on,
  chase date, snooze) and `breaks-0004.json` (0004, Step 3: stages, releases, append-only
  sign-offs) and `breaks-0005.json` (0005: the redaction, and the change-log trigger 0005 redefines,
  whose five breaks moved there from `breaks.json`): one deliberate break per rule. Every one must
  make a test fail. Two 0001 rules are left out because 0002 replaces or shadows them: the task-only
  status check (dropped by 0002) and the known-type check (0002's status table refuses unknown
  types too).

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

The app's own database code (`api/_lib/db/`) has tests that need a running database:
`api/_lib/db/db.test.ts` is skipped unless `TEST_DB_OWNER_URL` and `TEST_DB_APP_URL` are set. Serve
the same throwaway database over a socket and run them with no network:

```bash
SOCK=<scratch folder>/dbsock
DB_IMAGE=public.ecr.aws/supabase/postgres:17.12.0.002 DB_LOGIN_ROLES=ledger_app \
  bash ~/.claude/skills/offline-database-tests/scripts/db-serve.sh db "$SOCK" &   # wait for $SOCK/ready
unshare --user --net --mount --map-current-user --keep-caps bash -c "ip link set lo up; mount --bind '$SOCK' /mnt;
  TEST_DB_OWNER_URL='postgres://postgres@localhost/postgres?host=/mnt' \
  TEST_DB_APP_URL='postgres://ledger_app@localhost/postgres?host=/mnt' npx vitest run api/_lib/db/db.test.ts"
touch "$SOCK/stop"
```
Each run uses its own users, so runs can share one served database. `db/code-breaks.json` (the
converter), `db/code-breaks-db.json` (reading, writing, the import), `db/code-breaks-step2.json`
(the Step 2 fields end to end) and `db/code-breaks-step3.json` (releases and sign-offs) break the
code on purpose;
run them with the skill's `break-code.py` (the second inside the namespace above). Left out as
shadowed: sync stripping `legacy_*` keys from uploads (each type's schema already refuses unknown
fields).

## Moving the data (Step 1a)
1. `npm run backup`, then `npm run backup -- --verify FILE`.
2. `DATABASE_OWNER_URL=<owner> npm run db:migrate` (applies each migration once; records them in
   `migrations.applied`, which the app role can't see).
3. `DATABASE_OWNER_URL=<owner> npm run db:import -- --email you@example.org --from FILE --dry-run`:
   does everything, prints counts per workspace and the before/after checksums, rolls back.
4. The same without `--dry-run`, with `DATABASE_URL=<app role>` (checks it again through the app's
   policies). Sign-in on Postgres requires MFA, so the import also needs `AUTH_PASSWORD_HASH`,
   `AUTH_TOTP_SECRET` and `AUTH_RECOVERY_CODES` (the values set in Vercel today) and
   `MFA_ENCRYPTION_KEY` (32 random bytes, base64: `openssl rand -base64 32`), which encrypts the
   authenticator key in the database. One "baseline" change-log entry per row marks where history
   starts. A second import for the same email is refused.
5. In Vercel (Production), set `DATABASE_URL` (the app role's connection string) and the same
   `MFA_ENCRYPTION_KEY`, and redeploy. With `DATABASE_URL` set, every /api function uses Postgres
   (`api/_lib/store.ts`): sign-in asks for email, password and code; sessions, push subscriptions
   and reminder claims live in Postgres too. Every device signs in again once (old sessions were
   in Redis). Unset `DATABASE_URL` and redeploy to go back to Redis, which the move never changes.

## Setting up a real database (when the host is chosen)
1. Create the database; run the migrations as its owner.
2. Create the app's login role, a member of `ledger_app` and nothing else:
   `create role ledger_app_login login password '<long random>' in role ledger_app;`
3. Give the app only that role's connection string (`DATABASE_URL`); keep the owner's for
   migrations and the import.

## Erasing a person's name (retention)
Decided in Step 1b: items are kept (soft delete, never purged); change-log entries are archived
after 3 years (not due before 2029); a person's name is erased with the owner-only
`app.redact()` (migration 0005), which replaces it in one workspace's items, sign-offs, names and
change-log entries, stamps the edited rows so devices' older copies don't bring it back, and
records one `redact` entry (counts and a reason, never the text):

```bash
DATABASE_OWNER_URL=<owner> npm run db:redact -- --email you@example.org --workspace <workspace id> --reason "..." --dry-run
DATABASE_OWNER_URL=<owner> npm run db:redact -- --email you@example.org --workspace <workspace id> --reason "..."
```
It asks for the name at a prompt (so it stays out of shell history). Backups taken before still
hold the name: delete or re-take them.

