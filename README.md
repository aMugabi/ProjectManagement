# Ledger

A personal work tracker for several streams of work at once. It opens on a cross-workspace view
of what needs attention today, and lets you drill into one project, product or partner when you
want to do focused work. Besides tasks it tracks risks, issues, decisions, milestones and change
requests; releases with their stage sign-offs; who you are waiting on; and it writes a weekly
report.

Built with React, TypeScript and Vite; on Vercel it syncs through serverless functions to
Postgres.

## What it does

- **Workspaces** keep separate streams of work apart (for example, one per employer or client).
  Inside a workspace, an item belongs to a plain **project**, a **product**, a **partner**, a
  product with a partner (a *pair*), or nothing. *Settings → Projects → Sort projects* turns
  existing projects into products and partners, with a dry run first.
- **Item types:** task, risk, issue, decision, milestone and change request, each with its own
  statuses and fields (a risk's likelihood and mitigation, a decision's outcome, and so on).
- **Dashboard:** a *Focus* layout (today, this week, project health, blocked work) and a
  *Portfolio* layout, switchable from the header. Snoozed items stay off it until their date.
- **All items:** a **List** grouped by where items belong, with inline editing, and a **Board**
  whose columns are phases, so every type sits in its place. Filter by type, product, partner or
  project.
- **Timeline:** a two-week view of upcoming due dates.
- **Waiting on** (`/waiting`): items waiting on someone, grouped by person, with a chase date;
  *Chased* sets the next chase three days on, *Got it* clears it.
- **Releases** (`/releases`): a release for a product with a partner moves through the
  workspace's stages (by default SIT, UAT, UVT, InfoSec, Go-live). Each sign-off records the
  outcome, approver and role, the time and an evidence link. Sign-offs are never edited or
  deleted: a mistake is fixed by a correction, and both stay in the history.
- **Weekly report** (`/report`): for a product, partner, project or everything: done, risks and
  issues that changed, decisions, sign-offs, waiting on, overdue and due next week. Copy it as
  email text or download it as CSV.
- A **detail drawer** for every item (move it, snooze it, set who it waits on), and a
  **composer** (press `n`; `/` focuses search).

## Getting started

```bash
npm install
npm run dev
```

| Script | What it does |
| --- | --- |
| `npm run dev`, `npm run build`, `npm run preview` | Vite: develop, build, preview the build |
| `npm run lint`, `npm test`, `npm run test:e2e` | oxlint; unit tests (vitest); browser tests (Playwright) |
| `npm run hash-password`, `npm run setup-mfa` | Make the sign-in values (see *Sign-in*) |
| `npm run backup` | Encrypted backups (see *Backups*) |
| `npm run db:migrate`, `npm run db:import`, `npm run db:redact` | The Postgres database (see `db/README.md`) |

## Installing as an app (PWA)

Ledger is a Progressive Web App (via `vite-plugin-pwa`): use the browser's **Install** button
(desktop Chrome or Edge) or **Share → Add to Home Screen** (iOS Safari) to run it in its own
window. A service worker precaches the app, so it opens offline; edits are saved in the browser
first and sync the next time it is online. The service worker never caches `/api/` calls. New
deploys are picked up on the next launch.

The service worker only runs in production builds: use `npm run build && npm run preview` to try
it locally. The PNG icons in `public/` are rendered from `public/favicon.svg`.

**Local-only mode.** Builds outside Vercel (the GitHub Pages deploy and plain `npm run dev`) have
no API: they skip sign-in, keep data in that browser only, and say "Local only · this browser" in
the sidebar. Use `vercel dev` to run the cloud build locally.

## The cloud (Vercel deploy)

### Where the data lives

Every edit is saved in the browser first and then synced to `/api/state`. Sync merges item by
item: the newest edit wins and deletions are remembered, so offline edits and edits on other
devices are both kept.

- **Postgres** when `DATABASE_URL` is set: one row per item, with each workspace walled off by
  row-level security, soft delete, and an append-only change log of every change. The app
  connects as its own limited role, never the owner. Schema, rules, tests and setup:
  `db/README.md`.
- **Upstash Redis** otherwise (the original store: one document per deploy). Remove
  `DATABASE_URL` and redeploy to go back to it.

The server code runs in Frankfurt (`regions` in `vercel.json`), beside the database.

### Sign-in

- **On Postgres:** email, password and a code from an authenticator app (or a one-time recovery
  code). Each user's authenticator key is stored encrypted with `MFA_ENCRYPTION_KEY`.
- **On Redis:** password, and a code once `AUTH_TOTP_SECRET` is set.
- **`AUTH_MFA=off`** (exactly that word) switches the code off on both stores, for everyone: the
  form stops asking for it. The keys and recovery codes stay stored, so removing the setting and
  redeploying turns it back on with the same codes. `/api/health` shows which it is.

Make the values in your own terminal, never through a chat or anything that records output:

```bash
npm run hash-password -- --save ~/.ledger-secrets   # the password's scrypt hash
npm run setup-mfa -- --save ~/.ledger-secrets       # scan the QR code it draws, type the code
```

With `--save DIR` each value goes to a file only you can read (never inside this repository,
which is public) instead of the screen; without it they are printed. Add them to the Vercel
project from the files, for example
`vercel env add AUTH_PASSWORD_HASH --environment production --sensitive < ~/.ledger-secrets/AUTH_PASSWORD_HASH`,
or carry them into Postgres with `npm run db:import`. Keep the ten recovery codes `setup-mfa`
shows in a password manager or on paper: each signs in once without the phone.

`/api/login` is rate-limited (5 attempts per 15 minutes per address, 50 an hour overall); a wrong
email, password or code all get the same answer, and each code works once. It returns a random
session token, the only thing the browser keeps. Sessions last 30 days from last use.

**Signing out** uploads unsynced edits, turns off push for that device, ends the session and
deletes Ledger's data from that browser (it stays in the cloud). If the edits can't be uploaded,
Ledger asks first. *All devices* also drops every push subscription; each other device deletes
its copy the next time it opens, unless it holds edits the cloud hasn't received.

### Server settings

Set these on the Vercel project (Production), then redeploy. Mark secrets *sensitive*.

| Setting | What it's for |
| --- | --- |
| `DATABASE_URL` | Postgres: the app role's connection string (see `db/README.md`). Without it, Redis is used. |
| `MFA_ENCRYPTION_KEY` | Postgres: 32 random bytes in base64 (`openssl rand -base64 32`); encrypts the authenticator keys. |
| `AUTH_PASSWORD_HASH`, `AUTH_TOTP_SECRET`, `AUTH_RECOVERY_CODES` | Redis sign-in (and what `db:import` carries into Postgres). |
| `AUTH_MFA` (optional) | `off` switches the sign-in code off (see *Sign-in*). |
| Upstash Redis store | The Redis store (Vercel *Storage → Upstash Redis* adds its settings). |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Push. Make the keys with `npx web-push generate-vapid-keys`; the subject is `mailto:` and a contact address. |
| `REMINDERS_SECRET` | A long random string; lets the timer call `/api/reminders`. |
| `RESEND_API_KEY`, `EMAIL_FROM` (optional) | The email digest, via [Resend](https://resend.com). Without a verified sender domain, Resend only delivers to its account owner. |
| `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY` (optional) | An Upstash QStash schedule as the timer (see below). |

## Backups

`npm run backup` signs in, downloads the whole cloud copy, saves it encrypted with gpg and signs
that session out; the unencrypted data never touches the disk. Backups go to `~/ledger-backups/`
(`LEDGER_BACKUP_DIR` changes it; never inside this repository). Keep a second copy elsewhere.

- **Encryption:** set `LEDGER_BACKUP_RECIPIENT` to a gpg key's email or id to encrypt to that key;
  without it, gpg asks for a passphrase (AES-256).
- **Check one:** `npm run backup -- --verify FILE` prints counts per workspace (projects, items
  and finished items, products, partners, releases, sign-offs), never the content. Clear gpg's
  memory first (`gpgconf --reload gpg-agent`) to prove the passphrase.
- **Restore:** `npm run backup -- --restore FILE` uploads it, merged with the cloud copy (newer
  edits there are kept; anything deleted since stays deleted), after you type `restore`.
- `LEDGER_URL` points the script at another deploy.

## Reminders and notifications

- **One daily digest** at a time you choose (*Settings → Reminders*): due today, overdue,
  coming up (each item's reminder window, by default one day before; change it per item under
  *Remind me*) and waiting-on items whose chase date has come. Snoozed items are left out.
- **In the app:** a pop-up with the digest (View · Snooze 1h · Dismiss), and a 🔔 in the header
  listing everything overdue, due, coming up and to chase across all workspaces.
- **System notifications** while Ledger is open in a background tab, once allowed.
- **Push notifications** that arrive even when Ledger is closed (*Settings → Notifications →
  Turn on*, then *Send test*). Each device turns push on once; if the server's push keys change,
  devices subscribe again by themselves the next time Ledger opens.
- **Email digest:** one email at the digest time (*Settings → Email me the daily digest*), once
  `RESEND_API_KEY` is set.
- **Private notifications** (on by default): push, email and system notifications show counts
  only, never item, project or workspace names. In-app pop-ups always show the full text.

On iPhone and iPad, push needs Ledger added to the Home Screen and opened from there (iOS 16.4+).
In Brave, turn on *Use Google services for push messaging* (`brave://settings/privacy`).

### The timer

Something has to call `POST /api/reminders` regularly; each day's digest is pushed and emailed at
most once, however often it is called. A digest no device received (none registered yet) is kept
for the next run. A run answers 502, so it fails and GitHub emails whoever last set the schedule,
when the email failed or every registered device refused the push; the next run retries.

- **GitHub Actions** (`.github/workflows/reminders.yml`, every 15 minutes) calls it with
  `Authorization: Bearer $REMINDERS_SECRET`. Add the same value as a repository secret
  **`REMINDERS_SECRET`**; without it the run fails. GitHub starts scheduled runs late, often by
  hours, so in practice a few times a day. *Actions → Send reminders → Run workflow* runs it by
  hand; a repository variable `LEDGER_URL` points it at another deploy.
- **For on-time reminders:** an Upstash QStash schedule calling `/api/reminders` with cron
  `*/15 * * * *` (it is checked with the QStash signing keys above), or a Vercel cron job on a
  paid Vercel plan.

## Health check and alert

`GET /api/health` is public and reads no one's data. It answers 200 when the deploy can serve,
503 otherwise, never cached, with no error details (those go to the function log):

```json
{ "ok": true, "store": "postgres", "database": "ok", "push": "ok", "email": "off", "mfa": "on" }
```

On Postgres, `database` is `ok` only if the app's own role answers and sees no workspace with no
one signed in (so the connection, the login, the migrations and the walls are all checked);
`push` is `invalid` when the push keys are unusable.

`.github/workflows/health.yml` calls it twice an hour (`scripts/health-check.sh`). The run fails,
and GitHub emails whoever last set its schedule, when Ledger isn't healthy twice in a row a minute
apart; each failure says what failed and how to confirm it. If the runner's own network is down,
it says so and passes. Each call wakes the database, so poll it every 30 minutes or less often.

## Tests

- `npm test`: unit tests. The database tests are skipped unless a served test database is given
  (see `db/README.md`, which also has the pgTAP tests and the deliberate breaks).
- `npm run test:e2e`: browser tests in six setups: the local build in Chromium, Firefox, WebKit
  and a phone-sized Chromium, and the cloud build in Chromium and Firefox, against an in-memory
  stand-in for the API (`e2e/fakeCloud.ts`).
- Every rule has a deliberate break that a test must catch: `db/breaks*.json` for the database,
  `db/code-breaks*.json` for the code.

## Stack

- **React Router**: screens and filters are linkable via the URL.
- **Zustand**: item data (persisted in the browser) and transient UI state live in separate
  stores.
- **@dnd-kit**: drag and drop on the board.
- **CSS Modules**, using the design tokens from the project's design spec.
- **Server:** Vercel functions in `api/` (Node), **pg** for Postgres, **Zod** for item checks on
  the server, **web-push**, and **uqr** for the setup QR code.

## Origin

This app recreates a high-fidelity HTML/CSS design prototype and handoff spec ("Ledger") in a
real, typed, componentized codebase. Notable decisions made while translating the prototype:

- Tasks carry a real `dueDate` instead of the prototype's `dueOffset` integer.
- Filter and view state (search, priority, hide-done, board/list, dashboard layout, filters) live
  in the URL query string, so views are shareable and linkable.
- The Focus dashboard layout is the default; Portfolio remains available via the header toggle.

The spec's open decisions have since been resolved:

- **Recurrence:** completing a recurring task rolls it to its next occurrence (due date advanced,
  subtasks reset, status back to "to do") instead of resting at "done"; each finished occurrence
  is remembered for the weekly report.
- **Blocked status is derived, not manual:** an item reads as Blocked whenever it has an
  unfinished dependency. Dependencies are editable from the drawer.
- **Manual board ordering:** the Board supports drag-to-reorder within a column, independent of
  the List's due-date sort. The Blocked column stays derived-only.
- **Responsive layout:** below about 860px the sidebar becomes an off-canvas menu, the
  dashboard's columns stack, the board becomes a swipeable carousel, and the drawer and composer
  go full-width.
